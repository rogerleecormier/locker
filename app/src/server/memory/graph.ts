import { drizzle } from "drizzle-orm/d1";
import { eq, inArray, isNull } from "drizzle-orm";
import { memoryGraphNodes, memoryGraphEdges } from "~/db/schema";
import type { D1Database } from "@cloudflare/workers-types";

export type GraphNode = {
  id: string;
  label: string;
  type: "service" | "file" | "concept" | "library" | "person" | "api" | "database" | "config" | "other";
  value: number;
};

export type GraphEdge = {
  source: string;
  target: string;
  relation: string;
};

export type MemoryGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  nodeMemories: Record<string, string[]>;
};

export async function getMemoryGraph(
  d1: D1Database,
  userId: string,
  projectKey?: string
): Promise<MemoryGraph> {
  const db = drizzle(d1);
  const pkFilter = projectKey === undefined || projectKey === "personal" ? null : projectKey;

  const nodes = await db
    .select()
    .from(memoryGraphNodes)
    .where(
      pkFilter === null
        ? isNull(memoryGraphNodes.projectKey)
        : eq(memoryGraphNodes.projectKey, pkFilter)
    )
    .all();

  // secondary filter: must also match userId
  const userNodes = nodes.filter((n) => n.userId === userId);

  if (userNodes.length === 0) {
    return { nodes: [], edges: [], nodeMemories: {} };
  }

  const nodeIds = userNodes.map((n) => n.id);

  const edges = await db
    .select()
    .from(memoryGraphEdges)
    .where(inArray(memoryGraphEdges.sourceNodeId, nodeIds))
    .all();

  const nodeMemoriesMap: Record<string, Set<string>> = {};
  for (const n of userNodes) nodeMemoriesMap[n.id] = new Set();

  for (const e of edges) {
    nodeMemoriesMap[e.sourceNodeId]?.add(e.memoryId);
    if (nodeMemoriesMap[e.targetNodeId]) nodeMemoriesMap[e.targetNodeId].add(e.memoryId);
  }

  const nodeMemories: Record<string, string[]> = {};
  for (const [id, set] of Object.entries(nodeMemoriesMap)) {
    nodeMemories[id] = Array.from(set);
  }

  return {
    nodes: userNodes.map((n) => ({
      id: n.id,
      label: n.label,
      type: (n.type as GraphNode["type"]) || "other",
      value: (nodeMemories[n.id]?.length ?? 0) + 1,
    })),
    edges: edges.map((e) => ({
      source: e.sourceNodeId,
      target: e.targetNodeId,
      relation: e.relation,
    })),
    nodeMemories,
  };
}
