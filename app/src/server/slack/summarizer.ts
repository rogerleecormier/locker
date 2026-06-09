/**
 * Slack thread summarizer — Queue consumer for async memory ingestion.
 *
 * Processes Slack thread payloads asynchronously:
 *   1. Reconstructs thread conversation from message history.
 *   2. Invokes Workers AI to generate architecture decision summary (third-person declarative).
 *   3. Encrypts summary fact and commits to memory vault.
 *   4. Tags with #slack, #watercooler, and optional user-provided tag.
 */

import { drizzle } from "drizzle-orm/d1";
import { getOrCreateVaultKey, encrypt } from "~/server/crypto";
import type { CloudflareEnv } from "~/types/cloudflare";
import type { NewMemory } from "~/db/schema";
import { memories } from "~/db/schema";
import type { SlackThreadSummaryPayload } from "./webhook";

const AI_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8" as const;

const SLACK_SUMMARY_SYSTEM_PROMPT = `You are a senior software architect documenting architectural decisions from team discussions.
Given a Slack thread conversation, synthesize it into a single declarative memory fact (3-5 sentences, ≤ 150 words).
Use third-person passive voice. Focus on: the decision, why it matters, and any implementation notes.
Output format: "The team decided to [action]. This [reason]. Implementation: [details]."
Do NOT include greetings, names, timestamps, or markdown — plain prose only.`;

const MAX_THREAD_TEXT = 16_000; // Aggregate message limit

// ── Queue consumer ───────────────────────────────────────────────────────────

export async function handleSlackSummarizerQueue(
  payload: SlackThreadSummaryPayload,
  env: CloudflareEnv
): Promise<void> {
  const db = drizzle(env.DB);

  console.log(
    `[slack/summarizer] Processing thread ${payload.threadTs} for user ${payload.userId}`
  );

  // ── Step 1: Reconstruct thread conversation ──────────────────────────────
  const threadText = reconstructThreadConversation(payload.messages);
  if (!threadText.trim()) {
    console.warn(`[slack/summarizer] Thread has no text content: ${payload.threadTs}`);
    return;
  }

  // ── Step 2: Generate summary via Workers AI ─────────────────────────────
  const summary = await generateSlackSummary(env.AI, threadText);

  // ── Step 3: Encrypt and commit to memory vault ──────────────────────────
  const vaultId = payload.userId; // Personal vault for now
  const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);

  const factPlain = `[Slack Thread] ${summary}`;
  const encryptedFact = await encrypt(factPlain, vaultKey);

  const memoryId = crypto.randomUUID();
  const now = Date.now();

  // Build tags: always #slack, optionally #💾 if emoji trigger
  const tags = ["#slack", "#watercooler"];
  if (payload.triggerEmoji === "💾") {
    tags.push("#saved-decision");
  }

  const newMemory: NewMemory = {
    id: memoryId,
    userId: payload.userId,
    fact: encryptedFact,
    category: "projects",
    tags: tags.join(" "),
    timestamp: now,
    isActive: true,
    projectKey: null,
    scopeType: "personal",
    scopeId: null,
    isLocked: false,
    authorityType: "contributed",
    isQuarantined: false,
  };

  try {
    await db.insert(memories).values(newMemory);
    console.log(
      `[slack/summarizer] Committed memory ${memoryId} for thread ${payload.threadTs}`
    );
  } catch (err) {
    console.error(
      `[slack/summarizer] Failed to commit memory: ${String(err)}`
    );
    throw err;
  }
}

// ── Conversation reconstruction ──────────────────────────────────────────────

function reconstructThreadConversation(messages: Array<{ user?: string; text?: string }>): string {
  return messages
    .filter((m) => m.text)
    .map((m) => {
      const user = m.user || "anonymous";
      return `${user}: ${m.text}`;
    })
    .join("\n\n");
}

// ── AI summarization ─────────────────────────────────────────────────────────

async function generateSlackSummary(ai: Ai, threadText: string): Promise<string> {
  const truncatedText = threadText.slice(0, MAX_THREAD_TEXT);
  const userMessage = `Thread conversation:\n\n${truncatedText}`;

  try {
    const result = (await ai.run(AI_MODEL, {
      messages: [
        { role: "system", content: SLACK_SUMMARY_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      max_tokens: 300,
    })) as { response?: string } | ReadableStream;

    if (result instanceof ReadableStream) {
      const reader = result.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(
            value instanceof Uint8Array
              ? value
              : new TextEncoder().encode(String(value))
          );
        }
      }
      const text = new TextDecoder()
        .decode(concatUint8Arrays(chunks))
        .trim();
      return text || "Slack thread archived for future reference.";
    }

    return (
      (result as { response?: string }).response?.trim() ||
      "Slack thread archived for future reference."
    );
  } catch (err) {
    console.error("[slack/summarizer] AI summarization failed:", err);
    return "Slack thread archived for future reference.";
  }
}

// ── Utility functions ────────────────────────────────────────────────────────

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const totalLen = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}
