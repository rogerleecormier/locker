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
  memoryGraphNodes,
  memoryGraphEdges,
} from "~/db/schema";
import { persistChunkedVectors, deleteChunkVectors } from "~/server/memory/_shared";
import type { CloudflareEnv } from "~/types/cloudflare";
import { encrypt, decrypt, isEncrypted, getOrCreateVaultKey, deriveUserKey } from "~/server/crypto";
import { requireSession, requireAdmin } from "~/server/session";
import { verifyVaultAccess, checkQuota, logTokenUsage, logAudit } from "~/server/enterprise";
import { estimateEmbeddingTokens } from "~/server/enterprise";

type CFContext = { cloudflare: { env: CloudflareEnv; ctx: ExecutionContext } };

function getDb(env: CloudflareEnv) {
  return drizzle(env.DB, { schema: { memories, apiTokens, userPlans, organizationMembers, orgQuotas, users, memoryGraphNodes, memoryGraphEdges } });
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

    await deleteChunkVectors(env.DB, env.VECTOR_INDEX, mem.id);
    await persistChunkedVectors(
      env.AI,
      env.DB,
      env.VECTOR_INDEX,
      mem.id,
      decryptedFact,
      { userId: user.id, category: ver.category, tags: ver.tags, projectKey: mem.projectKey ?? "", entityIds: "" } as Record<string, VectorizeVectorMetadata>,
    );

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

// ── Repair merge-key mismatch (mergeMemories vaultId bug) ─────────────────────
//
// mergeMemories previously computed vaultId as `personal:${userId}` / `${scopeType}:${scopeId}`
// (scopeType being "organization", not "org") instead of the convention used everywhere
// else (bare userId / "org:xxx" / "team:xxx"). This caused merged memories to be encrypted
// under a DEK stored under the wrong vault_keys row, which every other read path can't find —
// so those rows fail to decrypt under the correct vault key. Fixed at the call site; this
// repairs any memories already encrypted under the wrong key before the fix.

export type RepairMergeKeysResult = { repaired: number; skipped: number; failed: number };

export const repairMergeKeyMismatch = createServerFn({ method: "POST" }).handler(
  async ({ context }): Promise<RepairMergeKeysResult> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    await requireAdmin(env);
    const db = getDb(env);

    const result: RepairMergeKeysResult = { repaired: 0, skipped: 0, failed: 0 };

    const rows = await db
      .select({ id: memories.id, fact: memories.fact, userId: memories.userId, projectKey: memories.projectKey })
      .from(memories)
      .all();

    for (const row of rows) {
      if (!isEncrypted(row.fact)) {
        result.skipped++;
        continue;
      }

      const correctVaultId =
        row.projectKey && (row.projectKey.startsWith("team:") || row.projectKey.startsWith("org:"))
          ? row.projectKey
          : row.userId;

      try {
        const correctKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, correctVaultId);
        await decrypt(row.fact, correctKey);
        // Decrypts fine under the correct key — not affected by the bug.
        result.skipped++;
      } catch {
        // Try the mis-keyed vault IDs the old mergeMemories code could have produced.
        const wrongVaultIds = correctVaultId === row.userId
          ? [`personal:${row.userId}`]
          : [`organization:${correctVaultId.slice(4)}`, `team:${correctVaultId.slice(5)}`];

        let repaired = false;
        for (const wrongVaultId of wrongVaultIds) {
          try {
            const wrongKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, wrongVaultId);
            const plaintext = await decrypt(row.fact, wrongKey);
            const correctKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, correctVaultId);
            await db.update(memories).set({ fact: await encrypt(plaintext, correctKey) }).where(eq(memories.id, row.id));
            result.repaired++;
            repaired = true;
            break;
          } catch {
            // Not encrypted under this candidate key either — try the next one.
          }
        }
        if (!repaired) {
          console.error(`[repairMergeKeyMismatch] memory ${row.id} could not be decrypted under any known key`);
          result.failed++;
        }
      }
    }

    return result;
  }
);

// ── Backfill orphaned knowledge-graph nodes ────────────────────────────────────
//
// Each memory's entities/edges are extracted by an LLM call scoped to that single
// fact. The model sometimes extracts an entity without including it in its own
// edges list, leaving that node permanently disconnected in the graph even though
// it co-occurred with other entities in the same fact. persistGraphData now
// auto-links any such entity to the fact's primary entity going forward — this
// re-runs extraction across existing memories so already-orphaned nodes pick up
// that same fallback linking. Nodes are deduped by (userId, projectKey, label),
// so this only adds missing edges; it never creates duplicate nodes.

export type BackfillGraphResult = { processed: number; linked: number; failed: number };

export const backfillGraphLinks = createServerFn({ method: "POST" }).handler(
  async ({ context }): Promise<BackfillGraphResult> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    await requireAdmin(env);
    const db = getDb(env);

    const { extractGraphEntities, persistGraphData } = await import("~/server/graphRag");

    const allMemories = await db
      .select({ id: memories.id, fact: memories.fact, userId: memories.userId, projectKey: memories.projectKey, isActive: memories.isActive })
      .from(memories)
      .where(eq(memories.isActive, true))
      .all();

    const result: BackfillGraphResult = { processed: 0, linked: 0, failed: 0 };

    const CHUNK_SIZE = 5;
    for (let i = 0; i < allMemories.length; i += CHUNK_SIZE) {
      const chunk = allMemories.slice(i, i + CHUNK_SIZE);
      await Promise.all(chunk.map(async (row) => {
        try {
          const vaultId = (row.projectKey && (row.projectKey.startsWith("team:") || row.projectKey.startsWith("org:"))) ? row.projectKey : row.userId;
          const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);
          const fact = await decryptFact(row.fact, vaultKey);

          const extraction = await extractGraphEntities(env.AI, fact);
          if (extraction.entities.length > 1) {
            await persistGraphData(env.DB, row.id, row.userId, row.projectKey ?? null, extraction);
            result.linked++;
          }
          result.processed++;
        } catch (err) {
          console.error(`[backfillGraphLinks] memory ${row.id} failed:`, err);
          result.failed++;
        }
      }));
    }

    return result;
  }
);

// ── Merge near-duplicate knowledge-graph nodes ─────────────────────────────────
//
// The AI produces slightly different casing/spacing for the same real-world entity
// across separate extraction calls ("Age-Rating" vs "age-rating", "Azure Blob
// Storage" vs "Azure Blob storage"). persistGraphData now matches labels
// case/whitespace-insensitively going forward, but nodes created before that fix
// are still fragmented. This finds nodes that share the same (userId, projectKey,
// normalized label), keeps the oldest as canonical, repoints every edge from the
// duplicates onto it, and deletes the duplicate nodes. Does NOT attempt fuzzy/
// similarity matching across genuinely different labels — only exact matches once
// case and surrounding whitespace are ignored, to avoid merging distinct entities.

export type MergeGraphNodesResult = { groupsFound: number; nodesMerged: number; edgesRepointed: number };

export const mergeDuplicateGraphNodes = createServerFn({ method: "POST" }).handler(
  async ({ context }): Promise<MergeGraphNodesResult> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    await requireAdmin(env);
    const db = getDb(env);

    const allNodes = await db
      .select({ id: memoryGraphNodes.id, userId: memoryGraphNodes.userId, projectKey: memoryGraphNodes.projectKey, label: memoryGraphNodes.label, createdAt: memoryGraphNodes.createdAt })
      .from(memoryGraphNodes)
      .all();

    const groups = new Map<string, typeof allNodes>();
    for (const node of allNodes) {
      const key = `${node.userId} ${node.projectKey ?? ""} ${node.label.trim().toLowerCase().replace(/\s+/g, " ")}`;
      const list = groups.get(key);
      if (list) list.push(node);
      else groups.set(key, [node]);
    }

    const result: MergeGraphNodesResult = { groupsFound: 0, nodesMerged: 0, edgesRepointed: 0 };

    for (const group of groups.values()) {
      if (group.length < 2) continue;
      result.groupsFound++;

      // Keep the oldest node as canonical so its id (already referenced elsewhere,
      // e.g. cached client state) stays stable.
      const [canonical, ...duplicates] = [...group].sort((a, b) => a.createdAt - b.createdAt);
      const duplicateIds = duplicates.map((d) => d.id);

      for (const dupId of duplicateIds) {
        const sourceEdges = await db.select().from(memoryGraphEdges).where(eq(memoryGraphEdges.sourceNodeId, dupId)).all();
        for (const edge of sourceEdges) {
          if (edge.targetNodeId === canonical.id) {
            await db.delete(memoryGraphEdges).where(eq(memoryGraphEdges.id, edge.id));
          } else {
            await db.update(memoryGraphEdges).set({ sourceNodeId: canonical.id }).where(eq(memoryGraphEdges.id, edge.id));
            result.edgesRepointed++;
          }
        }

        const targetEdges = await db.select().from(memoryGraphEdges).where(eq(memoryGraphEdges.targetNodeId, dupId)).all();
        for (const edge of targetEdges) {
          if (edge.sourceNodeId === canonical.id) {
            await db.delete(memoryGraphEdges).where(eq(memoryGraphEdges.id, edge.id));
          } else {
            await db.update(memoryGraphEdges).set({ targetNodeId: canonical.id }).where(eq(memoryGraphEdges.id, edge.id));
            result.edgesRepointed++;
          }
        }

        await db.delete(memoryGraphNodes).where(eq(memoryGraphNodes.id, dupId));
        result.nodesMerged++;
      }
    }

    return result;
  }
);

// ── Prune stale, tiny knowledge-graph islands ──────────────────────────────────
//
// The AI's per-fact extraction produces different entity labels across separate
// calls for the SAME fact (e.g. "household"/"benefits-rating" one run, "ACA"/
// "Age-rated plans" the next) — re-running the backfill can never reconcile these,
// since the labels never match, so it just grows a second cluster alongside the
// stale one instead of replacing it. Since the backfill regenerates every active
// memory's entities fresh on each run, deleting a small stale island isn't data
// loss — the next backfill recreates it (likely under better labels, given prompt
// improvements). This targets only small connected components (≤3 nodes) that
// contain no "person" node, so it never touches the main hub or a real person.

export type PruneGraphIslandsResult = { islandsFound: number; nodesDeleted: number };

const MAX_ISLAND_SIZE = 3;

export const pruneStaleGraphIslands = createServerFn({ method: "POST" }).handler(
  async ({ context }): Promise<PruneGraphIslandsResult> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    await requireAdmin(env);
    const db = getDb(env);

    const allNodes = await db
      .select({ id: memoryGraphNodes.id, userId: memoryGraphNodes.userId, projectKey: memoryGraphNodes.projectKey, type: memoryGraphNodes.type })
      .from(memoryGraphNodes)
      .all();
    const allEdges = await db
      .select({ sourceNodeId: memoryGraphEdges.sourceNodeId, targetNodeId: memoryGraphEdges.targetNodeId })
      .from(memoryGraphEdges)
      .all();

    // Union-find over (userId, projectKey) scoped node sets — two nodes from
    // different scopes must never merge, matching how the graph is queried/rendered.
    const parent = new Map<string, string>();
    for (const n of allNodes) parent.set(n.id, n.id);
    function find(id: string): string {
      let root = id;
      while (parent.get(root) !== root) root = parent.get(root)!;
      let cur = id;
      while (parent.get(cur) !== root) {
        const next = parent.get(cur)!;
        parent.set(cur, root);
        cur = next;
      }
      return root;
    }
    function union(a: string, b: string) {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    }
    for (const e of allEdges) {
      if (e.sourceNodeId === e.targetNodeId) continue; // self-loops don't merge anything
      if (parent.has(e.sourceNodeId) && parent.has(e.targetNodeId)) union(e.sourceNodeId, e.targetNodeId);
    }

    const components = new Map<string, typeof allNodes>();
    for (const n of allNodes) {
      const root = find(n.id);
      const list = components.get(root);
      if (list) list.push(n);
      else components.set(root, [n]);
    }

    const result: PruneGraphIslandsResult = { islandsFound: 0, nodesDeleted: 0 };

    for (const component of components.values()) {
      if (component.length > MAX_ISLAND_SIZE) continue;
      if (component.some((n) => n.type === "person")) continue;

      result.islandsFound++;
      for (const node of component) {
        await db.delete(memoryGraphNodes).where(eq(memoryGraphNodes.id, node.id));
        result.nodesDeleted++;
      }
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

        // Re-chunk and upsert each memory sequentially to avoid rate-limit bursts.
        for (let j = 0; j < chunk.length; j++) {
          const row = chunk[j];
          const fact = decryptedFacts[j];
          if (!row.userId) throw new Error(`Memory row ${row.id} does not have a userId`);
          await deleteChunkVectors(env.DB, env.VECTOR_INDEX, row.id);
          await persistChunkedVectors(
            env.AI,
            env.DB,
            env.VECTOR_INDEX,
            row.id,
            fact,
            { userId: row.userId, category: row.category, tags: row.tags ?? "", projectKey: row.projectKey ?? "", entityIds: "" } as Record<string, VectorizeVectorMetadata>,
          );
        }
        processed += chunk.length;
      } catch (err) {
        console.error(`[rebuildVectorizeIndex] failed chunk starting at index ${i}:`, err);
        failed += chunk.length;
      }
    }

    return { processed, failed };
  }
);
