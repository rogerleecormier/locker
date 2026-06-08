import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { drizzle } from "drizzle-orm/d1";
import { desc, eq } from "drizzle-orm";
import {
  memories,
  memoryVersions,
  apiTokens,
  auditLogs,
  totpSecrets,
  credentials,
  userPlans,
  organizationMembers,
  orgQuotas,
  users,
} from "~/db/schema";
import type { CloudflareEnv } from "~/types/cloudflare";
import { encrypt, decrypt, isEncrypted, getOrCreateVaultKey, deriveUserKey } from "~/server/crypto";
import { requireSession, requireAdmin } from "~/server/session";
import { verifyVaultAccess, checkQuota, logTokenUsage, logAudit } from "~/server/enterprise";
import { estimateEmbeddingTokens } from "~/server/enterprise";

type CFContext = { cloudflare: { env: CloudflareEnv; ctx: ExecutionContext } };

function getDb(env: CloudflareEnv) {
  return drizzle(env.DB, { schema: { memories, apiTokens, userPlans, organizationMembers, orgQuotas, users } });
}

async function generateEmbedding(ai: Ai, text: string): Promise<number[]> {
  const result = await ai.run("@cf/baai/bge-m3", { text: [text] });
  const r = result as { data?: number[][]; shape?: number[] };
  return r.data?.[0] ?? [];
}

async function decryptFact(stored: string, encKey: string | CryptoKey): Promise<string> {
  if (!isEncrypted(stored)) return stored;
  return decrypt(stored, encKey);
}

// ── Memory Timeline ───────────────────────────────────────────────────────────

const MemoryIdSchema = z.object({ memoryId: z.string().uuid("memoryId must be a valid UUID") }).strict();

export const getMemoryTimeline = createServerFn({ method: "POST" })
  .inputValidator((data) => MemoryIdSchema.parse(data))
  .handler(async ({ data, context }): Promise<any[]> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    const memRows = await db.select().from(memories).where(eq(memories.id, data.memoryId)).all();
    if (memRows.length === 0) throw new Error("Memory not found or unauthorized");
    const mem = memRows[0];

    const { allowed } = await verifyVaultAccess(db, user.id, mem.projectKey);
    if (!allowed) throw new Error("Forbidden: no access to vault scope");

    if ((!mem.projectKey || mem.projectKey === "personal") && mem.userId !== user.id) {
      throw new Error("Unauthorized");
    }

    const versions = await db
      .select()
      .from(memoryVersions)
      .where(eq(memoryVersions.memoryId, data.memoryId))
      .orderBy(desc(memoryVersions.timestamp))
      .all();

    const vaultId = (mem.projectKey && (mem.projectKey.startsWith("team:") || mem.projectKey.startsWith("org:"))) ? mem.projectKey : user.id;
    const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);

    return Promise.all(
      versions.map(async (v: any) => ({
        ...v,
        fact: await decryptFact(v.fact, vaultKey),
      }))
    );
  });

// ── Revert Memory Version ─────────────────────────────────────────────────────

const VersionIdSchema = z.object({ versionId: z.string().uuid("versionId must be a valid UUID") }).strict();

export const revertMemoryVersion = createServerFn({ method: "POST" })
  .inputValidator((data) => VersionIdSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ success: boolean }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    const versionRows = await db.select().from(memoryVersions).where(eq(memoryVersions.id, data.versionId)).all();
    if (versionRows.length === 0) throw new Error("Version not found");
    const ver = versionRows[0];

    const memRows = await db.select().from(memories).where(eq(memories.id, ver.memoryId)).all();
    if (memRows.length === 0) throw new Error("Memory not found or unauthorized");
    const mem = memRows[0];

    const { allowed, orgId } = await verifyVaultAccess(db, user.id, mem.projectKey);
    if (!allowed) throw new Error("Forbidden");

    if ((!mem.projectKey || mem.projectKey === "personal") && mem.userId !== user.id) {
      throw new Error("Unauthorized");
    }

    const quotaCheck = await checkQuota(db, user.id, "session", "commit", orgId);
    if (!quotaCheck.allowed) throw new Error(`Quota Exceeded: ${quotaCheck.reason}`);

    const vaultId = (mem.projectKey && (mem.projectKey.startsWith("team:") || mem.projectKey.startsWith("org:"))) ? mem.projectKey : user.id;
    const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);
    const decryptedFact = await decryptFact(ver.fact, vaultKey);

    const embedding = await generateEmbedding(env.AI, decryptedFact);
    const tokensConsumed = estimateEmbeddingTokens(decryptedFact);

    await db.update(memories)
      .set({ fact: ver.fact, category: ver.category, tags: ver.tags, isActive: true })
      .where(eq(memories.id, mem.id));

    await db.insert(memoryVersions).values({
      id: crypto.randomUUID(),
      memoryId: mem.id,
      fact: ver.fact,
      category: ver.category,
      tags: ver.tags,
      changedBy: user.id,
      changeReason: `reverted to version from ${new Date(ver.timestamp).toLocaleString()}`,
      timestamp: Date.now(),
    });

    await env.VECTOR_INDEX.upsert([{
      id: mem.id,
      values: embedding,
      metadata: { userId: user.id, category: ver.category, tags: ver.tags, projectKey: mem.projectKey ?? "" } as Record<string, VectorizeVectorMetadata>,
    }]);

    await logAudit(db, { orgId, userId: user.id, tokenId: "session", action: "revert_version", memoryId: mem.id, metadata: { versionId: data.versionId } });
    await logTokenUsage(db, "session", "commit", tokensConsumed);

    return { success: true };
  });

// ── Get Audit Logs (admin only) ───────────────────────────────────────────────

export const getAuditLogs = createServerFn({ method: "GET" })
  .handler(async ({ context }): Promise<any[]> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    await requireAdmin(env);
    const db = getDb(env);
    return db.select().from(auditLogs).orderBy(desc(auditLogs.timestamp)).limit(100).all();
  });

// ── Migrate to V2 ─────────────────────────────────────────────────────────────

export type MigrateV2Result = {
  memories: { migrated: number; skipped: number; failed: number };
  totp: { migrated: number; skipped: number; failed: number };
  credentials: { migrated: number; skipped: number; failed: number };
  tokens: { invalidated: number };
};

export const migrateToV2 = createServerFn({ method: "POST" }).handler(
  async ({ context }): Promise<MigrateV2Result> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    await requireAdmin(env);
    const db = getDb(env);

    const result: MigrateV2Result = {
      memories:    { migrated: 0, skipped: 0, failed: 0 },
      totp:        { migrated: 0, skipped: 0, failed: 0 },
      credentials: { migrated: 0, skipped: 0, failed: 0 },
      tokens:      { invalidated: 0 },
    };

    const CHUNK = 20;

    // ── 1. Memories ──────────────────────────────────────────────────────────
    const memRows = await db.select({ id: memories.id, fact: memories.fact, userId: memories.userId, projectKey: memories.projectKey }).from(memories).all();
    for (let i = 0; i < memRows.length; i += CHUNK) {
      await Promise.all(memRows.slice(i, i + CHUNK).map(async (row) => {
        try {
          const vaultId = (row.projectKey && (row.projectKey.startsWith("team:") || row.projectKey.startsWith("org:"))) ? row.projectKey : row.userId;
          const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);
          const legacyKey = await deriveUserKey(env.ENCRYPTION_KEY, vaultId);

          if (isEncrypted(row.fact)) {
            try {
              await decrypt(row.fact, vaultKey);
              result.memories.skipped++;
            } catch {
              let plaintext: string;
              try {
                plaintext = await decrypt(row.fact, legacyKey);
              } catch {
                plaintext = await decrypt(row.fact, env.ENCRYPTION_KEY);
              }
              await db.update(memories).set({ fact: await encrypt(plaintext, vaultKey) }).where(eq(memories.id, row.id));
              result.memories.migrated++;
            }
          } else {
            await db.update(memories).set({ fact: await encrypt(row.fact, vaultKey) }).where(eq(memories.id, row.id));
            result.memories.migrated++;
          }
        } catch (err) {
          console.error(`[migrateToV2] memory ${row.id} failed:`, err);
          result.memories.failed++;
        }
      }));
    }

    // ── 2. TOTP secrets ──────────────────────────────────────────────────────
    const totpRows = await db.select({ id: totpSecrets.id, userId: totpSecrets.userId, secret: totpSecrets.secret }).from(totpSecrets).all();
    for (let i = 0; i < totpRows.length; i += CHUNK) {
      await Promise.all(totpRows.slice(i, i + CHUNK).map(async (row) => {
        try {
          const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, row.userId);
          const legacyKey = await deriveUserKey(env.ENCRYPTION_KEY, row.userId);

          if (isEncrypted(row.secret)) {
            try {
              await decrypt(row.secret, vaultKey);
              result.totp.skipped++;
            } catch {
              const plaintext = await decrypt(row.secret, legacyKey);
              await db.update(totpSecrets).set({ secret: await encrypt(plaintext, vaultKey) }).where(eq(totpSecrets.id, row.id));
              result.totp.migrated++;
            }
          } else {
            await db.update(totpSecrets).set({ secret: await encrypt(row.secret, vaultKey) }).where(eq(totpSecrets.id, row.id));
            result.totp.migrated++;
          }
        } catch (err) {
          console.error(`[migrateToV2] totp ${row.id} failed:`, err);
          result.totp.failed++;
        }
      }));
    }

    // ── 3. Credentials ───────────────────────────────────────────────────────
    const credRows = await db.select({ id: credentials.id, userId: credentials.userId, encryptedValue: credentials.encryptedValue }).from(credentials).all();
    for (let i = 0; i < credRows.length; i += CHUNK) {
      await Promise.all(credRows.slice(i, i + CHUNK).map(async (row) => {
        try {
          const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, row.userId);
          const legacyKey = await deriveUserKey(env.ENCRYPTION_KEY, row.userId);

          if (isEncrypted(row.encryptedValue)) {
            try {
              await decrypt(row.encryptedValue, vaultKey);
              result.credentials.skipped++;
            } catch {
              const plaintext = await decrypt(row.encryptedValue, legacyKey);
              await db.update(credentials).set({ encryptedValue: await encrypt(plaintext, vaultKey) }).where(eq(credentials.id, row.id));
              result.credentials.migrated++;
            }
          } else {
            await db.update(credentials).set({ encryptedValue: await encrypt(row.encryptedValue, vaultKey) }).where(eq(credentials.id, row.id));
            result.credentials.migrated++;
          }
        } catch (err) {
          console.error(`[migrateToV2] credential ${row.id} failed:`, err);
          result.credentials.failed++;
        }
      }));
    }

    // ── 4. API tokens — invalidate SHA-256 hashed tokens ─────────────────────
    const legacyTokenRows = await db.select({ id: apiTokens.id, tokenHash: apiTokens.tokenHash }).from(apiTokens).all();
    const legacyIds = legacyTokenRows.filter(t => !t.tokenHash.startsWith("pbkdf2$")).map(t => t.id);
    for (const id of legacyIds) {
      await db.delete(apiTokens).where(eq(apiTokens.id, id));
      result.tokens.invalidated++;
    }

    return result;
  }
);

// ── Rebuild Vectorize Index ───────────────────────────────────────────────────

export const rebuildVectorizeIndex = createServerFn({ method: "POST" }).handler(
  async ({ context }): Promise<{ processed: number; failed: number }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    await requireAdmin(env);
    const db = getDb(env);

    const allMemories = await db.select().from(memories).all();
    let processed = 0;
    let failed = 0;

    const CHUNK_SIZE = 10;
    for (let i = 0; i < allMemories.length; i += CHUNK_SIZE) {
      const chunk = allMemories.slice(i, i + CHUNK_SIZE);
      try {
        const decryptedFacts = await Promise.all(
          chunk.map(async (row) => {
            const vaultId = (row.projectKey && (row.projectKey.startsWith("team:") || row.projectKey.startsWith("org:"))) ? row.projectKey : row.userId;
            const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);
            return decryptFact(row.fact, vaultKey);
          })
        );

        const embeddings = await Promise.all(decryptedFacts.map(async (fact) => generateEmbedding(env.AI, fact)));

        const vectors: VectorizeVector[] = chunk.map((row, idx) => {
          if (!row.userId) throw new Error(`Memory row ${row.id} does not have a userId`);
          return {
            id: row.id,
            values: embeddings[idx],
            metadata: { userId: row.userId, category: row.category, tags: row.tags ?? "", projectKey: row.projectKey ?? "" } as Record<string, VectorizeVectorMetadata>,
          };
        });

        await env.VECTOR_INDEX.upsert(vectors);
        processed += chunk.length;
      } catch (err) {
        console.error(`[rebuildVectorizeIndex] failed chunk starting at index ${i}:`, err);
        failed += chunk.length;
      }
    }

    return { processed, failed };
  }
);
