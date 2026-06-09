import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { drizzle } from "drizzle-orm/d1";
import { eq, and } from "drizzle-orm";
import { memoryConflicts, memories, userPlans, type MemoryConflict } from "~/db/schema";
import type { CloudflareEnv } from "~/types/cloudflare";
import { requireSession } from "~/server/session";
import { verifyVaultAccess, parseScope } from "~/server/enterprise";

type CFContext = { cloudflare: { env: CloudflareEnv; ctx: ExecutionContext } };

function getDb(env: CloudflareEnv) {
  return drizzle(env.DB, { schema: { memoryConflicts, memories, userPlans } });
}

// ── Fingerprint helpers ────────────────────────────────────────────────────────

// Stable fingerprint for a duplicate cluster: sorted memory IDs joined with "|"
export function clusterFingerprint(memoryIds: string[]): string {
  return [...memoryIds].sort().join("|");
}

// Fingerprint for a single-memory conflict (stale / quarantined)
export function singleFingerprint(memoryId: string, type: "stale" | "quarantined"): string {
  return `${type}:${memoryId}`;
}

// ── Schemas ────────────────────────────────────────────────────────────────────

const ScopeSchema = z.object({
  projectKey: z.string().max(128).optional(),
});

const ResolveSchema = z.object({
  conflictId: z.string().uuid(),
});

const SnoozeSchema = z.object({
  conflictId: z.string().uuid(),
  days: z.number().int().min(1).max(90).default(30),
});

const SyncStaleSchema = z.object({
  projectKey: z.string().max(128).optional(),
  staleMemories: z.array(z.object({
    id: z.string().uuid(),
    fact: z.string(),
    lastAccessedAt: z.number().nullable(),
  })),
});

// ── List conflicts ─────────────────────────────────────────────────────────────

export const listConflicts = createServerFn({ method: "POST" })
  .inputValidator((data) => ScopeSchema.parse(data))
  .handler(async ({ data, context }): Promise<MemoryConflict[]> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    const { scopeType, scopeId } = parseScope(data?.projectKey);
    const { allowed } = await verifyVaultAccess(db, user.id, scopeType, scopeId);
    if (!allowed) throw new Error("Forbidden");

    const now = Date.now();

    // Return open conflicts + snoozed ones whose snooze has expired
    const rows = await db
      .select()
      .from(memoryConflicts)
      .where(
        and(
          eq(memoryConflicts.userId, user.id),
          eq(memoryConflicts.scopeType, scopeType),
          scopeId ? eq(memoryConflicts.scopeId, scopeId) : eq(memoryConflicts.scopeId, "")
        )
      )
      .all();

    return rows.filter((r) => {
      if (r.status === "resolved") return false;
      if (r.status === "snoozed" && r.snoozeUntil && r.snoozeUntil > now) return false;
      return true;
    });
  });

// ── Resolve a conflict ─────────────────────────────────────────────────────────

export const resolveConflict = createServerFn({ method: "POST" })
  .inputValidator((data) => ResolveSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    await db
      .update(memoryConflicts)
      .set({ status: "resolved", resolvedAt: Date.now() })
      .where(and(eq(memoryConflicts.id, data.conflictId), eq(memoryConflicts.userId, user.id)))
      .run();

    return { ok: true };
  });

// ── Snooze a conflict ──────────────────────────────────────────────────────────

export const snoozeConflict = createServerFn({ method: "POST" })
  .inputValidator((data) => SnoozeSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ ok: boolean; snoozeUntil: number }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    const snoozeUntil = Date.now() + data.days * 24 * 60 * 60 * 1000;

    await db
      .update(memoryConflicts)
      .set({ status: "snoozed", snoozeUntil })
      .where(and(eq(memoryConflicts.id, data.conflictId), eq(memoryConflicts.userId, user.id)))
      .run();

    return { ok: true, snoozeUntil };
  });

// ── Auto-resolve conflicts for a set of memory IDs ────────────────────────────
// Called internally after merge / archive / delete so stale DB rows are cleaned up.
// Accepts a D1Database directly so it can create its own correctly-scoped Drizzle instance.

export async function autoResolveConflictsForMemories(
  d1: D1Database,
  userId: string,
  resolvedMemoryIds: string[]
): Promise<void> {
  if (!resolvedMemoryIds.length) return;

  const db = getDb({ DB: d1 } as any);

  const open = await db
    .select()
    .from(memoryConflicts)
    .where(and(eq(memoryConflicts.userId, userId)))
    .all();

  const now = Date.now();
  const toResolve: string[] = [];

  for (const conflict of open) {
    if (conflict.status === "resolved") continue;
    const ids: string[] = JSON.parse(conflict.memoryIds);
    if (ids.every((id) => resolvedMemoryIds.includes(id))) {
      toResolve.push(conflict.id);
    }
  }

  if (toResolve.length) {
    for (const id of toResolve) {
      await db
        .update(memoryConflicts)
        .set({ status: "resolved", resolvedAt: now })
        .where(eq(memoryConflicts.id, id))
        .run();
    }
  }
}

// ── Upsert conflicts from a health check run ───────────────────────────────────
// Used internally by runMemoryHealthCheck. Not exposed as a server fn.

export type ConflictUpsertInput = {
  fingerprint: string;
  conflictType: "duplicate" | "stale" | "quarantined";
  label: string;
  reason?: string;
  memoryIds: string[];
  memoryDetails?: Array<{ id: string; fact: string; category: string }>;
  suggestedAction?: "merge" | "review" | "delete";
};

export async function upsertConflicts(
  d1: D1Database,
  userId: string,
  scopeType: string,
  scopeId: string | null,
  inputs: ConflictUpsertInput[]
): Promise<void> {
  if (!inputs.length) return;

  const db = getDb({ DB: d1 } as any);
  const now = Date.now();

  // Fetch existing rows for these fingerprints
  const existing = await db
    .select()
    .from(memoryConflicts)
    .where(eq(memoryConflicts.userId, userId))
    .all();

  const existingByFp = new Map(existing.map((r) => [r.fingerprint, r]));

  for (const input of inputs) {
    const existing = existingByFp.get(input.fingerprint);

    if (existing) {
      // Already known — just bump lastSeenAt and re-open if it was snoozed/resolved
      const updates: Partial<MemoryConflict> = { lastSeenAt: now };
      if (existing.status === "resolved") {
        updates.status = "open";
        updates.resolvedAt = null as any;
      }
      await db
        .update(memoryConflicts)
        .set(updates)
        .where(eq(memoryConflicts.id, existing.id))
        .run();
    } else {
      // New conflict — insert
      await db.insert(memoryConflicts).values({
        id: crypto.randomUUID(),
        userId,
        scopeType,
        scopeId: scopeId ?? "",
        conflictType: input.conflictType,
        fingerprint: input.fingerprint,
        label: input.label,
        reason: input.reason ?? null,
        memoryIds: JSON.stringify(input.memoryIds),
        memoryDetails: input.memoryDetails ? JSON.stringify(input.memoryDetails) : null,
        suggestedAction: input.suggestedAction ?? null,
        status: "open",
        snoozeUntil: null,
        detectedAt: now,
        lastSeenAt: now,
        resolvedAt: null,
      }).run();
    }
  }
}

// ── Sync stale conflicts from client-detected stale memories ──────────────────
// Called when entering the vault-health tab. No AI required — purely timestamp-based.

export const syncStaleConflicts = createServerFn({ method: "POST" })
  .inputValidator((data) => SyncStaleSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ synced: number }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);

    const { scopeType, scopeId } = parseScope(data?.projectKey);
    const now = Date.now();

    const inputs: ConflictUpsertInput[] = data.staleMemories.map((m) => {
      const daysSince = m.lastAccessedAt != null
        ? Math.floor((now - m.lastAccessedAt) / (1000 * 60 * 60 * 24))
        : null;
      return {
        fingerprint: singleFingerprint(m.id, "stale"),
        conflictType: "stale" as const,
        label: m.fact.slice(0, 80) + (m.fact.length > 80 ? "…" : ""),
        reason: daysSince != null ? `Not accessed in ${daysSince} days` : "Never recalled",
        memoryIds: [m.id],
        suggestedAction: "review" as const,
      };
    });

    await upsertConflicts(env.DB, user.id, scopeType, scopeId, inputs);
    return { synced: inputs.length };
  });
