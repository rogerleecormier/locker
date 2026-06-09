/**
 * Drizzle-layer Row-Level Security (RLS) equivalent for multi-tenant isolation.
 *
 * Design:
 *   Cloudflare D1 has no native RLS. We enforce tenant isolation at the ORM layer
 *   by wrapping every query that touches `memories` (and other tenant-owned tables)
 *   with an orgId predicate. This module provides:
 *
 *   - `resolveOrgContext(db, userId)` — finds the caller's org (if any) and returns
 *     a typed OrgContext object.
 *   - `scopedMemoriesQuery(db, ctx)` — returns a Drizzle query builder pre-filtered
 *     to the caller's orgId (or their userId for personal-scope memories).
 *   - `assertMemoryBelongsToOrg(memory, ctx)` — throws 403 immediately when a fetched
 *     memory does not belong to the current tenant. Use as a defence-in-depth guard
 *     after any raw query that bypasses the scoped builder.
 *
 * All server functions that read or write `memories` MUST use one of these helpers
 * rather than querying the table directly.
 */

import { drizzle } from "drizzle-orm/d1";
import { eq, and, isNull, type SQL } from "drizzle-orm";
import {
  memories,
  organizationMembers,
  organizations,
  type Memory,
} from "~/db/schema";
import type { CloudflareEnv } from "~/types/cloudflare";

// ── Types ─────────────────────────────────────────────────────────────────────

export type OrgContext =
  | { type: "personal"; userId: string; orgId: null }
  | { type: "org"; userId: string; orgId: string; role: "owner" | "admin" | "member" };

// ── Context resolution ────────────────────────────────────────────────────────

/**
 * Resolves the org context for a given authenticated user.
 * Returns "personal" when the user has no org membership.
 * Returns "org" with the user's primary org and role when they belong to one.
 *
 * When a user belongs to multiple orgs the one where they hold the highest
 * privilege (owner > admin > member) is returned. For truly multi-org
 * scenarios the caller should pass `explicitOrgId` to pin the context.
 */
export async function resolveOrgContext(
  env: CloudflareEnv,
  userId: string,
  explicitOrgId?: string,
): Promise<OrgContext> {
  const db = drizzle(env.DB);

  if (explicitOrgId) {
    const rows = await db
      .select({ role: organizationMembers.role })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.orgId, explicitOrgId),
          eq(organizationMembers.userId, userId),
        ),
      )
      .limit(1)
      .all();

    if (rows.length === 0) {
      // User is not a member of the requested org — hard 403, not a soft fallback.
      throw new Response(
        JSON.stringify({ error: "Forbidden: not a member of the requested organization" }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }

    return { type: "org", userId, orgId: explicitOrgId, role: rows[0].role };
  }

  // No explicit org — find the user's primary org by highest role.
  const ROLE_RANK: Record<string, number> = { owner: 3, admin: 2, member: 1 };
  const memberships = await db
    .select({ orgId: organizationMembers.orgId, role: organizationMembers.role })
    .from(organizationMembers)
    .where(eq(organizationMembers.userId, userId))
    .all();

  if (memberships.length === 0) {
    return { type: "personal", userId, orgId: null };
  }

  let best = memberships[0];
  for (const m of memberships.slice(1)) {
    if ((ROLE_RANK[m.role] ?? 0) > (ROLE_RANK[best.role] ?? 0)) best = m;
  }

  return { type: "org", userId, orgId: best.orgId, role: best.role };
}

// ── Query scoping ─────────────────────────────────────────────────────────────

/**
 * Returns the Drizzle WHERE predicate that restricts a memories query to the
 * current tenant context. Combine with any additional predicates using `and()`.
 *
 * Personal context  → memories.userId = :userId AND memories.orgId IS NULL
 * Org context       → memories.orgId  = :orgId
 *
 * The orgId constraint is the primary isolation fence; the userId constraint
 * prevents cross-user access within the same personal namespace.
 */
export function tenantMemoryFilter(ctx: OrgContext): SQL {
  if (ctx.type === "org") {
    return eq(memories.orgId, ctx.orgId);
  }
  return and(eq(memories.userId, ctx.userId), isNull(memories.orgId)) as SQL;
}

/**
 * Defence-in-depth check called after any query that may not have gone through
 * tenantMemoryFilter (e.g. a lookup by primary key). Throws a 403 Response
 * immediately if the returned memory does not belong to the current tenant.
 *
 * Use pattern:
 *   const mem = await db.select().from(memories).where(eq(memories.id, id)).get();
 *   assertMemoryTenant(mem, ctx);
 */
export function assertMemoryTenant(memory: Memory | null | undefined, ctx: OrgContext): asserts memory is Memory {
  if (!memory) {
    throw new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const belongsToTenant =
    ctx.type === "org"
      ? memory.orgId === ctx.orgId
      : memory.userId === ctx.userId && memory.orgId === null;

  if (!belongsToTenant) {
    throw new Response(
      JSON.stringify({ error: "Forbidden: memory does not belong to your organization" }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }
}

// ── Org membership helpers ─────────────────────────────────────────────────────

/** Returns true only when the context user is an owner or admin of their org. */
export function isOrgAdmin(ctx: OrgContext): boolean {
  return ctx.type === "org" && (ctx.role === "owner" || ctx.role === "admin");
}

/** Throws 403 if the caller is not an org admin. */
export function requireOrgAdmin(ctx: OrgContext): void {
  if (!isOrgAdmin(ctx)) {
    throw new Response(
      JSON.stringify({ error: "Forbidden: organization admin role required" }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }
}

/** Verify that an org exists; returns the org row or throws 404. */
export async function requireOrg(env: CloudflareEnv, orgId: string) {
  const db = drizzle(env.DB);
  const rows = await db
    .select({ id: organizations.id, name: organizations.name, plan: organizations.plan })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1)
    .all();

  if (rows.length === 0) {
    throw new Response(JSON.stringify({ error: "Organization not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return rows[0];
}
