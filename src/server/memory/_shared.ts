// Shared utilities re-exported across all memory domain modules.
// Nothing in this file calls createServerFn — it's pure helpers + types.

import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import {
  memories,
  apiTokens,
  userPlans,
  organizationMembers,
  orgQuotas,
  users,
  type Memory,
} from "~/db/schema";
import type { CloudflareEnv } from "~/types/cloudflare";
import { decrypt, isEncrypted, getOrCreateVaultKey, decryptEphemeral, type EphemeralPlaintext } from "~/server/crypto";

export type CFContext = { cloudflare: { env: CloudflareEnv; ctx: ExecutionContext } };

export function getDb(env: CloudflareEnv) {
  return drizzle(env.DB, { schema: { memories, apiTokens, userPlans, organizationMembers, orgQuotas, users } });
}

export function normalizeCategory(raw: string | undefined): "rules" | "projects" | "references" {
  if (raw === "rules" || raw === "projects" || raw === "references") return raw;
  return "references";
}

export function extractText(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (typeof r.response === "string") return r.response;
    if (typeof r.text === "string") return r.text;
    if (typeof r.result === "string") return r.result;
    if (Array.isArray(r.choices) && r.choices[0]) {
      const c = r.choices[0] as Record<string, unknown>;
      if (typeof c.text === "string") return c.text;
      if (c.message && typeof (c.message as Record<string, unknown>).content === "string")
        return (c.message as Record<string, unknown>).content as string;
    }
  }
  return "";
}

export async function generateEmbedding(ai: Ai, text: string): Promise<number[]> {
  const result = await ai.run("@cf/baai/bge-m3", { text: [text] });
  const r = result as { data?: number[][]; shape?: number[] };
  return r.data?.[0] ?? [];
}

export async function encryptFact(fact: string, encKey: string | CryptoKey): Promise<string> {
  const { encrypt } = await import("~/server/crypto");
  return encrypt(fact, encKey);
}

export async function decryptFact(stored: string, encKey: string | CryptoKey): Promise<string> {
  if (!isEncrypted(stored)) return stored;
  return decrypt(stored, encKey);
}

export async function decryptMemories(rows: Memory[], db: D1Database, masterKey: string): Promise<Memory[]> {
  const ephemerals: EphemeralPlaintext[] = [];
  try {
    return await Promise.all(
      rows.map(async (r) => {
        const vaultId = (r.projectKey && (r.projectKey.startsWith("team:") || r.projectKey.startsWith("org:"))) ? r.projectKey : r.userId;
        const vaultKey = await getOrCreateVaultKey(db, masterKey, vaultId);
        if (isEncrypted(r.fact)) {
          const eph = await decryptEphemeral(r.fact, vaultKey);
          ephemerals.push(eph);
          return { ...r, fact: eph.get() };
        }
        return { ...r };
      })
    );
  } finally {
    for (const eph of ephemerals) {
      eph.drop();
    }
  }
}

export async function classifyMemories(
  ai: Ai,
  facts: string[]
): Promise<Array<"rules" | "projects" | "references">> {
  if (facts.length === 0) return [];

  const CLASSIFY_BATCH = 20;
  const results: Array<"rules" | "projects" | "references"> = [];

  for (let i = 0; i < facts.length; i += CLASSIFY_BATCH) {
    const batch = facts.slice(i, i + CLASSIFY_BATCH);
    const numbered = batch.map((f, j) => `${j + 1}. ${f}`).join("\n");

    const prompt = `Classify each memory into exactly one category: rules, projects, or references.

RULES = behavioral directives, communication preferences, instructions for how AI should respond, things I always/never want done, tone/format requirements, academic standards I follow, constraints on AI behavior.
Examples: "Tell it like it is; don't sugar-coat responses", "Use a formal professional tone", "Challenge my thinking", "AI must not invent skills I don't possess", "APA 7th edition compliance required"

PROJECTS = active or recent work, specific tasks in progress, features being built, bugs being fixed, purchases being researched, ongoing personal initiatives with concrete next steps.
Examples: "Building a weekly status update automation in Claude", "Troubleshooting STATUS_ACCESS_VIOLATION crashes on Sager laptop", "Purchasing a 2018 Ford Explorer from Carvana", "Creating Student Learning Plans for homeschool scholarship"

REFERENCES = background facts about who I am: identity, location, family, career history, education, certifications, employers, interests, health, financial context, tools used, skills possessed.
Examples: "Lives in Auburndale Florida", "Works as a Technical Program Manager at Vertex Education", "Has five dependent children", "Holds CompTIA Network+ certification", "Weighs 355 lbs"

Respond with ONLY a JSON array of strings, one per numbered item, in order. No explanation.
Example for 3 items: ["rules","projects","references"]

Memories:
${numbered}`;

    const result = await ai.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
      prompt,
      max_tokens: Math.max(64, batch.length * 16),
    });

    const text = extractText(result).trim();
    const match = text.match(/\[[\s\S]*?\]/);

    if (!match) {
      results.push(...batch.map(() => "references" as const));
      continue;
    }

    try {
      const parsed: unknown[] = JSON.parse(match[0]);
      results.push(...batch.map((_, j) => normalizeCategory(parsed[j] as string | undefined)));
    } catch {
      results.push(...batch.map(() => "references" as const));
    }
  }

  return results;
}

export function getVectorFilter(userId: string, projectKey: string | undefined): Record<string, any> {
  const filter: Record<string, any> = {};
  if (projectKey && (projectKey.startsWith("team:") || projectKey.startsWith("org:"))) {
    filter.projectKey = projectKey;
  } else {
    filter.userId = userId;
  }
  return filter;
}

export async function getUserName(db: ReturnType<typeof getDb>, userId: string, env: CloudflareEnv): Promise<string> {
  try {
    const userRow = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).get();
    if (userRow?.name) {
      return userRow.name;
    }
    const rows = await db.select().from(memories).where(eq(memories.userId, userId)).all();
    const nameRow = rows.find((r) =>
      r.tags.split(",").map((t) => t.trim()).includes("profile-name")
    );
    if (nameRow) {
      const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, userId);
      const fact = await decryptFact(nameRow.fact, vaultKey);
      return fact.replace(/^Name is\s+/i, "").trim();
    }
  } catch (err) {
    console.error("[getUserName] failed to fetch name:", err);
  }
  return "The user";
}

export function parseFactsFromText(raw: string): Array<{ fact: string }> {
  const noisePatterns = [
    /^=+$/,
    /^-{3,}$/,
    /^#{1,3}\s/,
    /^evidence:/i,
    /^imported from:/i,
    /^generated:/i,
    /^memory export$/i,
    /^end of export$/i,
    /^\d+\.\s+[A-Z\s]+$/,
    /^[-=*]{4,}/,
    /^[A-Z\s]+ — MEMORY EXPORT/,
  ];

  return raw
    .split("\n")
    .map((line) => {
      let f = line
        .trim()
        .replace(/^\s*[-*•]\s+/, "")
        .replace(/^\[\d{4}-\d{2}-\d{2}\]\s*-?\s*/, "")
        .replace(/^\[unknown\]\s*-?\s*/i, "")
        .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
        .replace(/^Name:\s*/i, "")
        .replace(/^Location:\s*/i, "")
        .trim();
      return f;
    })
    .filter((f) => {
      if (f.length < 8) return false;
      if (noisePatterns.some((p) => p.test(f))) return false;
      return true;
    })
    .map((f) => ({ fact: f }));
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let mA = 0;
  let mB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    mA += a[i] * a[i];
    mB += b[i] * b[i];
  }
  if (mA === 0 || mB === 0) return 0;
  return dotProduct / (Math.sqrt(mA) * Math.sqrt(mB));
}

// projectKey must be empty/null (personal), "org:<uuid>", or "team:<uuid>"
export const zProjectKeyFn = (z: any) =>
  z
    .string()
    .max(128)
    .refine(
      (v: string) => v === "" || v === "personal" || /^org:[0-9a-f-]{36}$/.test(v) || /^team:[0-9a-f-]{36}$/.test(v),
      { message: "projectKey must be empty, 'personal', 'org:<uuid>', or 'team:<uuid>'" }
    )
    .optional();
