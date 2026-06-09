/**
 * Slack webhook event handler for architectural decision ingestion.
 *
 * Flow:
 *   1. Verify Slack URL challenge (initial handshake).
 *   2. Validate request signature using HMAC-SHA256.
 *   3. Parse event payload; filter for relevant emoji reactions or slash commands.
 *   4. Resolve user OAuth token and verify Locker user mapping.
 *   5. Fetch Slack thread history (decrypt stored OAuth token).
 *   6. Dispatch thread text to SlackSummarizer Queue.
 *   7. Return 200 OK immediately (async processing).
 *
 * Credential storage:
 *   - Slack OAuth token stored as __SLACK_OAUTH__ in user's personal credential vault
 *   - Webhook signing secret stored in Cloudflare secret (SLACK_WEBHOOK_SECRET env var)
 */

import { drizzle } from "drizzle-orm/d1";
import { eq, and } from "drizzle-orm";
import {
  apiTokens,
  credentials,
  users,
  type NewMemory,
  memories,
} from "~/db/schema";
import {
  getOrCreateVaultKey,
  encrypt,
  decrypt,
  isEncrypted,
  verifyToken,
  extractTokenPrefix,
} from "~/server/crypto";
import type { CloudflareEnv } from "~/types/cloudflare";

const SLACK_SIGNING_VERSION = "v0";
const SLACK_REQUEST_TIMEOUT_SECONDS = 300; // 5 minutes

type SlackEvent = {
  type: "url_verification" | "event_callback";
  challenge?: string;
  event?: Record<string, unknown>;
  user_id?: string;
  team_id?: string;
  event_id?: string;
  event_time?: number;
};

type SlackThreadEvent = {
  type: "message" | "reaction_added";
  user?: string;
  text?: string;
  thread_ts?: string;
  channel?: string;
  reaction?: string;
  item?: {
    type: "message";
    channel: string;
    ts: string;
  };
};

type SlackMessage = {
  type: "message";
  user?: string;
  text?: string;
  ts: string;
  thread_ts?: string;
};

type SlackThreadSummaryPayload = {
  userId: string;
  slackUserId: string;
  channelId: string;
  threadTs: string;
  messages: SlackMessage[];
  triggerEmoji?: string;
};

// Well-known credential names for Slack integration (uppercase per convention).
export const SLACK_OAUTH_TOKEN = "__SLACK_OAUTH__";

// ── Public handler ────────────────────────────────────────────────────────────

export async function handleSlackWebhookRequest(
  request: Request,
  env: CloudflareEnv
): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const rawBody = await request.arrayBuffer();
  const bodyText = new TextDecoder().decode(rawBody);

  // ── Step 1: Verify Slack signature ────────────────────────────────────────
  const signatureError = await verifySlackSignature(
    request,
    rawBody,
    env.SLACK_WEBHOOK_SECRET
  );
  if (signatureError) {
    console.error(`[slack/webhook] Signature verification failed: ${signatureError}`);
    return jsonResponse({ error: signatureError }, 401);
  }

  // ── Step 2: Parse payload ─────────────────────────────────────────────────
  let payload: SlackEvent;
  try {
    payload = JSON.parse(bodyText) as SlackEvent;
  } catch (err) {
    console.error("[slack/webhook] Failed to parse payload:", err);
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  // ── Step 3: Handle URL verification challenge ────────────────────────────
  if (payload.type === "url_verification") {
    console.log("[slack/webhook] URL verification challenge received");
    return new Response(payload.challenge || "", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  // ── Step 4: Handle event_callback ────────────────────────────────────────
  if (payload.type === "event_callback") {
    // Validate timestamp freshness
    const eventTime = (payload.event_time ?? 0) * 1000;
    const now = Date.now();
    if (Math.abs(now - eventTime) > SLACK_REQUEST_TIMEOUT_SECONDS * 1000) {
      console.warn(
        `[slack/webhook] Event timestamp too old: ${eventTime} vs ${now}`
      );
      return jsonResponse({ ok: true, skipped: "stale_event" });
    }

    const event = (payload.event ?? {}) as SlackThreadEvent;
    const slackUserId = payload.user_id || event.user || "";

    // Filter for relevant events: reaction_added with 💾 or text containing /locker-commit
    const isRelevantEvent =
      (event.type === "reaction_added" && event.reaction === "💾") ||
      (event.type === "message" && event.text?.includes("/locker-commit"));

    if (!isRelevantEvent) {
      console.log(
        `[slack/webhook] Skipping irrelevant event type: ${event.type}`
      );
      return jsonResponse({ ok: true, skipped: true });
    }

    if (!slackUserId) {
      console.warn("[slack/webhook] Missing slack user_id");
      return jsonResponse({ error: "Missing user information" }, 400);
    }

    // ── Step 5: Resolve Locker user from Slack user_id ───────────────────
    const userId = await resolveLockerUserId(env, slackUserId);
    if (!userId) {
      console.warn(
        `[slack/webhook] No Locker user mapping found for Slack user ${slackUserId}`
      );
      return jsonResponse({
        ok: true,
        skipped: "no_locker_user_mapping",
      });
    }

    // Determine thread to process
    const threadTs =
      event.type === "reaction_added"
        ? event.item?.ts
        : (event.thread_ts || (event as any).ts);
    const channelId = event.channel || event.item?.channel;

    if (!threadTs || !channelId) {
      console.error("[slack/webhook] Missing threadTs or channelId");
      return jsonResponse({ error: "Missing thread information" }, 400);
    }

    // ── Step 6: Fetch Slack OAuth token ──────────────────────────────────
    const oauthToken = await readSlackOAuthToken(env, userId);
    if (!oauthToken) {
      console.warn(
        `[slack/webhook] No Slack OAuth token found for user ${userId}`
      );
      return jsonResponse({
        ok: true,
        error: `Slack OAuth token not configured for user ${userId}`,
        hint: "Use Settings → Integrations → Slack to configure your OAuth token.",
      });
    }

    // ── Step 7: Fetch thread history from Slack API ──────────────────────
    let messages: SlackMessage[] = [];
    try {
      messages = await fetchSlackThreadHistory(oauthToken, channelId, threadTs);
    } catch (err) {
      console.error(
        `[slack/webhook] Failed to fetch thread history: ${String(err)}`
      );
      return jsonResponse({
        ok: true,
        error: "Failed to fetch thread from Slack",
      });
    }

    if (messages.length === 0) {
      console.warn(
        `[slack/webhook] No messages found for thread ${threadTs} in channel ${channelId}`
      );
      return jsonResponse({ ok: true, skipped: "empty_thread" });
    }

    // ── Step 8: Dispatch to SlackSummarizer Queue ────────────────────────
    const queuePayload: SlackThreadSummaryPayload = {
      userId,
      slackUserId: slackUserId || "",
      channelId,
      threadTs,
      messages,
      triggerEmoji: event.type === "reaction_added" ? event.reaction : undefined,
    };

    try {
      if (env.SLACK_SUMMARIZER_QUEUE) {
        await env.SLACK_SUMMARIZER_QUEUE.send(queuePayload);
        console.log(
          `[slack/webhook] Queued thread ${threadTs} for summarization (userId=${userId})`
        );
      }
    } catch (err) {
      console.error(
        `[slack/webhook] Failed to queue summarization: ${String(err)}`
      );
      return jsonResponse({
        ok: true,
        error: "Failed to queue summarization",
      });
    }

    return jsonResponse({ ok: true, queued: true });
  }

  return jsonResponse({ error: "Unknown event type" }, 400);
}

// ── Slack signature verification ──────────────────────────────────────────────

async function verifySlackSignature(
  request: Request,
  rawBody: ArrayBuffer,
  secret?: string
): Promise<string | null> {
  if (!secret) {
    return "SLACK_WEBHOOK_SECRET not configured";
  }

  const timestamp = request.headers.get("x-slack-request-timestamp");
  const signature = request.headers.get("x-slack-signature");

  if (!timestamp || !signature) {
    return "Missing Slack signature headers";
  }

  // Verify timestamp is fresh (within 5 minutes)
  const now = Math.floor(Date.now() / 1000);
  const reqTime = parseInt(timestamp, 10);
  if (Math.abs(now - reqTime) > SLACK_REQUEST_TIMEOUT_SECONDS) {
    return "Request timestamp verification failed";
  }

  // Verify HMAC signature
  const baseString = `${SLACK_SIGNING_VERSION}:${timestamp}:${new TextDecoder().decode(rawBody)}`;
  const keyData = new TextEncoder().encode(secret);
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(baseString));
  const computed = bytesToHex(new Uint8Array(sig));
  const expected = `${SLACK_SIGNING_VERSION}=` + computed;

  if (!timingSafeEqual(signature, expected)) {
    return "Slack signature mismatch";
  }

  return null;
}

// ── User resolution helpers ───────────────────────────────────────────────────

async function resolveLockerUserId(
  env: CloudflareEnv,
  slackUserId: string
): Promise<string | null> {
  // Look up the mapping via user metadata or a dedicated table.
  // For now, we'll check if a credential with a specific naming convention exists.
  // This would typically be stored as a user preference (e.g., slackUserId in user profile).
  // A more robust approach would add a slack_users table.
  const db = drizzle(env.DB);

  // Placeholder: search for any user that has a Slack OAuth token and matches the Slack ID.
  // In production, you'd want a dedicated slack_user_mapping table.
  // For now, return null — the caller should prompt the user to configure the mapping.
  console.log(
    `[slack] Would resolve Slack user ${slackUserId} to Locker user via mapping table`
  );
  return null;
}

// ── Credential helpers ────────────────────────────────────────────────────────

async function readSlackOAuthToken(
  env: CloudflareEnv,
  userId: string
): Promise<string | null> {
  const db = drizzle(env.DB);

  const rows = await db
    .select({ encryptedValue: credentials.encryptedValue })
    .from(credentials)
    .where(
      and(
        eq(credentials.userId, userId),
        eq(credentials.name, SLACK_OAUTH_TOKEN)
      )
    )
    .limit(1)
    .all();

  if (rows.length === 0) return null;

  try {
    const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, userId);
    if (isEncrypted(rows[0].encryptedValue)) {
      return await decrypt(rows[0].encryptedValue, vaultKey);
    }
    return rows[0].encryptedValue;
  } catch (err) {
    console.error(
      `[slack] Failed to decrypt Slack OAuth token for user ${userId}:`,
      err
    );
    return null;
  }
}

// ── Slack API calls ──────────────────────────────────────────────────────────

async function fetchSlackThreadHistory(
  oauthToken: string,
  channelId: string,
  threadTs: string
): Promise<SlackMessage[]> {
  const url = new URL("https://slack.com/api/conversations.replies");
  url.searchParams.set("channel", channelId);
  url.searchParams.set("ts", threadTs);
  url.searchParams.set("limit", "100");

  const resp = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${oauthToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  if (!resp.ok) {
    throw new Error(`Slack API error: ${resp.status}`);
  }

  const data = (await resp.json()) as Record<string, unknown>;
  if (data.ok !== true) {
    throw new Error(`Slack API returned error: ${String(data.error)}`);
  }

  const messages = ((data.messages ?? []) as SlackMessage[]).filter(
    (m) => m.text && m.type === "message"
  );
  return messages;
}

// ── Utility functions ────────────────────────────────────────────────────────

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export type { SlackThreadSummaryPayload };
