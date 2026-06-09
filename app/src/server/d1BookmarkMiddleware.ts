/**
 * D1 read-replica bookmark middleware.
 *
 * After any state-mutating D1 write, the bookmark (txnId) is stored in KV
 * under a per-user key so that subsequent reads can be routed to a replica
 * that has caught up to at least that point, maintaining read-after-write
 * consistency during GraphRAG indexation without forcing all reads to the
 * primary.
 *
 * Consistency model: "read-your-writes" within a user session.
 * All other reads are served from the nearest replica (eventual consistency).
 *
 * Requires wrangler.json bindings:
 *   - DB         — primary D1 (writes always land here)
 *   - DB_REPLICA — read replica D1 binding (optional; falls back to DB)
 *   - SESSION_KV — KVNamespace for bookmark storage
 */

import type { D1Database, KVNamespace } from "@cloudflare/workers-types";

// TTL for bookmarks in KV. Replication lag is typically <2s; 30s is a
// conservative window that covers any plausible lag before we stop caring.
const BOOKMARK_TTL_SECONDS = 30;

// Logarithmic backoff config for replica-lag fallback.
const FALLBACK_MAX_ATTEMPTS = 4;
const FALLBACK_BASE_MS = 50;

export type BookmarkEnv = {
  DB: D1Database;
  DB_REPLICA?: D1Database;
  SESSION_KV: KVNamespace;
};

function bookmarkKey(userId: string): string {
  return `d1_bookmark:${userId}`;
}

/**
 * Persist the D1 txnId bookmark after a successful write so that the next
 * read for this user can request a replica that has caught up to this point.
 */
export async function saveBookmark(
  env: BookmarkEnv,
  userId: string,
  txnId: string | undefined | null,
): Promise<void> {
  if (!txnId) return;
  await env.SESSION_KV.put(bookmarkKey(userId), txnId, {
    expirationTtl: BOOKMARK_TTL_SECONDS,
  });
}

/**
 * Retrieve the stored bookmark for a user, if any.
 */
export async function getBookmark(
  env: BookmarkEnv,
  userId: string,
): Promise<string | null> {
  return env.SESSION_KV.get(bookmarkKey(userId));
}

/**
 * Clear the bookmark once it is no longer needed (e.g. after a primary read).
 */
export async function clearBookmark(
  env: BookmarkEnv,
  userId: string,
): Promise<void> {
  await env.SESSION_KV.delete(bookmarkKey(userId));
}

/**
 * Execute a SELECT using a D1 session routed to the replica that has caught
 * up to the stored bookmark. Falls back to the primary with logarithmic
 * backoff if the replica cannot yet satisfy the bookmark.
 *
 * Usage:
 *   const results = await replicaRead(env, userId, (db) =>
 *     db.prepare("SELECT * FROM memories WHERE user_id = ?").bind(userId).all()
 *   );
 */
export async function replicaRead<T>(
  env: BookmarkEnv,
  userId: string,
  query: (db: D1Database) => Promise<T>,
): Promise<T> {
  const bookmark = await getBookmark(env, userId);
  const replica = env.DB_REPLICA ?? env.DB;

  if (!bookmark) {
    // No recent write from this user — serve from replica unconditionally.
    return query(replica);
  }

  // Open a session pinned to the bookmark so the replica must have replicated
  // at least up to this transaction before answering.
  // D1 Sessions API: withSession(bookmark) returns a D1DatabaseSession.
  for (let attempt = 0; attempt < FALLBACK_MAX_ATTEMPTS; attempt++) {
    try {
      const session = replica.withSession(bookmark);
      const result = await query(session as unknown as D1Database);
      // Success — the replica was ready.
      return result;
    } catch (err: unknown) {
      const isLagError =
        err instanceof Error &&
        // D1 throws when the replica hasn't caught up to the requested bookmark.
        (err.message.includes("bookmark") ||
          err.message.includes("replication") ||
          err.message.includes("consistency"));

      if (!isLagError || attempt === FALLBACK_MAX_ATTEMPTS - 1) {
        // Unknown error or exhausted retries — fall through to primary.
        break;
      }

      // Logarithmic backoff: 50ms, ~93ms, ~136ms (log base-2 scaled)
      const delayMs = Math.round(FALLBACK_BASE_MS * Math.log2(attempt + 2));
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  // Replica could not satisfy the bookmark within retry budget — use primary
  // and clear the stale bookmark so subsequent reads go back to replica.
  console.warn(
    `[d1bookmark] replica lag exceeded retry budget for user=${userId}; falling back to primary`,
  );
  await clearBookmark(env, userId);
  return query(env.DB);
}

/**
 * Execute a write against the primary and automatically capture + store the
 * resulting txnId bookmark so the next read is consistent.
 *
 * Usage:
 *   const result = await primaryWrite(env, userId, (db) =>
 *     db.prepare("INSERT INTO memories (id, user_id, fact) VALUES (?, ?, ?)")
 *       .bind(id, userId, fact).run()
 *   );
 */
export async function primaryWrite(
  env: BookmarkEnv,
  userId: string,
  write: (db: D1Database) => Promise<D1Result>,
): Promise<D1Result> {
  const result = await write(env.DB);
  // txnId is present on successful writes; undefined on dry runs / no-ops.
  const txnId = (result.meta as Record<string, unknown>)?.txnId as
    | string
    | undefined;
  await saveBookmark(env, userId, txnId);
  return result;
}
