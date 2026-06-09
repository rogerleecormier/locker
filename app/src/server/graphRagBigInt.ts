/**
 * BigInt-safe GraphRAG artifact types and operations
 *
 * The Drizzle schema stores `createdAt` for graph nodes / edges as SQLite
 * INTEGER (epoch-ms).  When these values are read back through D1 they are
 * deserialised as JS Number, which silently truncates anything beyond 2^53-1.
 *
 * This module provides:
 *   1. `GraphRagNodeBig` / `GraphRagEdgeBig` — interfaces that hold epoch-ms
 *      timestamps as native BigInt instead of Number.
 *   2. `fetchGraphNodesBig` / `fetchGraphEdgesBig` — raw-D1 query helpers
 *      that use d1BigInt wrappers to materialise those BigInt values safely.
 *   3. Arithmetic helpers that operate on BigInt IDs so callers never
 *      accidentally widen back to Number.
 */

import type { D1Database } from "@cloudflare/workers-types";
import { d1All, d1First, parseBigIntFields, EPOCH_MS_COLUMNS } from "./d1BigInt";

// ---------------------------------------------------------------------------
// BigInt-safe interfaces
// ---------------------------------------------------------------------------

/**
 * A GraphRAG entity node with its timestamp field stored as BigInt.
 *
 * Mirrors `MemoryGraphNode` from schema.ts but replaces `createdAt: number`
 * with `createdAt: bigint` to prevent V8 52-bit truncation of epoch-ms values.
 */
export interface GraphRagNodeBig {
  /** Stable UUID for this entity (text PK — no truncation risk). */
  id: string;
  /** Owning user's UUID. */
  userId: string;
  /** Vault scope key; null for personal vault. */
  projectKey: string | null;
  /** Canonical entity name, e.g. "AuthService". */
  label: string;
  /** Entity kind, e.g. "service" | "file" | "concept" | "person". */
  type: string;
  /**
   * Creation epoch in milliseconds as BigInt.
   * Use `Number(node.createdAt)` only when passing to APIs that require Number
   * and you have verified the value fits within Number.MAX_SAFE_INTEGER.
   */
  createdAt: bigint;
}

/**
 * A GraphRAG relationship edge with its timestamp field stored as BigInt.
 *
 * Mirrors `MemoryGraphEdge` from schema.ts with `createdAt` as bigint.
 */
export interface GraphRagEdgeBig {
  /** Edge UUID. */
  id: string;
  /** FK → memories.id — the memory that introduced this relationship. */
  memoryId: string;
  /** FK → memory_graph_nodes.id — relationship origin. */
  sourceNodeId: string;
  /** FK → memory_graph_nodes.id — relationship target. */
  targetNodeId: string;
  /** Relationship verb, e.g. "calls" | "depends_on" | "implements". */
  relation: string;
  /** Creation epoch in milliseconds as BigInt. */
  createdAt: bigint;
}

/**
 * A self-contained GraphRAG artifact: one node with its outbound edges and
 * the set of memory IDs that contributed to this part of the graph.
 *
 * All numeric identifiers that could be int64 in SQLite are represented as
 * BigInt to prevent silent precision loss in the V8 runtime.
 */
export interface GraphRagArtifactNode {
  node: GraphRagNodeBig;
  /** Directed edges originating from this node. */
  outboundEdges: GraphRagEdgeBig[];
  /** Directed edges pointing to this node. */
  inboundEdges: GraphRagEdgeBig[];
  /** IDs of the memory records that reference this entity. */
  contributingMemoryIds: string[];
}

// ---------------------------------------------------------------------------
// Raw D1 column shape (TEXT-cast columns come back as strings)
// ---------------------------------------------------------------------------

// Index signature satisfies Record<string, unknown> while keeping named fields.
interface RawNodeRow extends Record<string, unknown> {
  id: string;
  userId: string;
  projectKey: string | null;
  label: string;
  type: string;
  createdAt: string; // CAST(createdAt AS TEXT)
}

interface RawEdgeRow extends Record<string, unknown> {
  id: string;
  memoryId: string;
  sourceNodeId: string;
  targetNodeId: string;
  relation: string;
  createdAt: string; // CAST(createdAt AS TEXT)
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

const NODE_INT64_COLS = ["createdAt"] as const satisfies ReadonlyArray<
  (typeof EPOCH_MS_COLUMNS)[number]
>;

const EDGE_INT64_COLS = ["createdAt"] as const satisfies ReadonlyArray<
  (typeof EPOCH_MS_COLUMNS)[number]
>;

/**
 * Fetches all graph nodes for a given user + vault scope.
 * Returns nodes with `createdAt` as BigInt.
 */
export async function fetchGraphNodesBig(
  db: D1Database,
  userId: string,
  projectKey: string | null,
): Promise<GraphRagNodeBig[]> {
  const [sql, bindings] =
    projectKey === null
      ? [
          `SELECT id, userId, projectKey, label, type, createdAt
           FROM memory_graph_nodes
           WHERE userId = ?1 AND projectKey IS NULL
           ORDER BY createdAt DESC`,
          [userId],
        ]
      : [
          `SELECT id, userId, projectKey, label, type, createdAt
           FROM memory_graph_nodes
           WHERE userId = ?1 AND projectKey = ?2
           ORDER BY createdAt DESC`,
          [userId, projectKey],
        ];

  const raw = await d1All<RawNodeRow>(db, sql, bindings, NODE_INT64_COLS);
  return raw.map((r) => parseBigIntFields(r, NODE_INT64_COLS) as unknown as GraphRagNodeBig);
}

/**
 * Fetches a single graph node by its UUID.
 * Returns `null` when not found.
 */
export async function fetchGraphNodeBig(
  db: D1Database,
  nodeId: string,
): Promise<GraphRagNodeBig | null> {
  const raw = await d1First<RawNodeRow>(
    db,
    `SELECT id, userId, projectKey, label, type, createdAt
     FROM memory_graph_nodes
     WHERE id = ?1`,
    [nodeId],
    NODE_INT64_COLS,
  );
  if (!raw) return null;
  return parseBigIntFields(raw, NODE_INT64_COLS) as unknown as GraphRagNodeBig;
}

/**
 * Fetches all edges where the given node IDs appear as source or target.
 * Returns edges with `createdAt` as BigInt.
 */
export async function fetchEdgesForNodesBig(
  db: D1Database,
  nodeIds: string[],
): Promise<GraphRagEdgeBig[]> {
  if (nodeIds.length === 0) return [];

  const placeholders = nodeIds.map((_, i) => `?${i + 1}`).join(", ");
  const sql = `
    SELECT id, memoryId, sourceNodeId, targetNodeId, relation, createdAt
    FROM memory_graph_edges
    WHERE sourceNodeId IN (${placeholders})
       OR targetNodeId IN (${placeholders})
  `;

  // D1 bind requires a flat list; duplicate nodeIds for the two IN clauses.
  const raw = await d1All<RawEdgeRow>(db, sql, [...nodeIds, ...nodeIds], EDGE_INT64_COLS);
  return raw.map((r) => parseBigIntFields(r, EDGE_INT64_COLS) as unknown as GraphRagEdgeBig);
}

/**
 * Builds a `GraphRagArtifactNode` for a single entity node UUID.
 *
 * Returns `null` when the node does not exist.
 */
export async function buildGraphRagArtifact(
  db: D1Database,
  nodeId: string,
): Promise<GraphRagArtifactNode | null> {
  const node = await fetchGraphNodeBig(db, nodeId);
  if (!node) return null;

  const allEdges = await fetchEdgesForNodesBig(db, [nodeId]);

  const outboundEdges = allEdges.filter((e) => e.sourceNodeId === nodeId);
  const inboundEdges = allEdges.filter((e) => e.targetNodeId === nodeId);

  const memoryIdSet = new Set<string>();
  for (const e of allEdges) memoryIdSet.add(e.memoryId);

  return {
    node,
    outboundEdges,
    inboundEdges,
    contributingMemoryIds: Array.from(memoryIdSet),
  };
}

// ---------------------------------------------------------------------------
// BigInt arithmetic helpers for graph IDs / timestamps
// ---------------------------------------------------------------------------

/**
 * Returns the node whose `createdAt` is the most recent among a list.
 * Operates entirely in BigInt to avoid any Number widening.
 */
export function newestNode(nodes: GraphRagNodeBig[]): GraphRagNodeBig | null {
  if (nodes.length === 0) return null;
  return nodes.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
}

/**
 * Filters nodes created after a given epoch-ms BigInt threshold.
 */
export function nodesCreatedAfter(
  nodes: GraphRagNodeBig[],
  thresholdMs: bigint,
): GraphRagNodeBig[] {
  return nodes.filter((n) => n.createdAt > thresholdMs);
}

/**
 * Returns the age of a node in milliseconds as BigInt.
 * `nowMs` defaults to BigInt(Date.now()); pass an explicit value in tests.
 */
export function nodeAgeMs(node: GraphRagNodeBig, nowMs: bigint = BigInt(Date.now())): bigint {
  return nowMs - node.createdAt;
}
