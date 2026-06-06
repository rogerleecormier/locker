import { drizzle } from "drizzle-orm/d1";
import { eq, inArray, sql } from "drizzle-orm";
import { memoryGraphNodes, memoryGraphEdges } from "~/db/schema";
import type { D1Database } from "@cloudflare/workers-types";

type ExtractedEntity = { label: string; type: string };
type ExtractedEdge = { source: string; target: string; relation: string };

type ExtractionResult = {
  entities: ExtractedEntity[];
  edges: ExtractedEdge[];
};

function extractText(result: unknown): string {
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

// Calls Workers AI to extract named entities and relationships from a single fact.
// Returns an empty result on any error — graph extraction is best-effort and must
// never block the critical addMemory / commit_memory write path.
export async function extractGraphEntities(ai: Ai, fact: string): Promise<ExtractionResult> {
  const systemPrompt =
    "You are an architectural knowledge-graph extractor. " +
    "Given a software engineering memory fact, extract named entities (services, files, concepts, libraries, people, APIs, databases, etc.) " +
    "and the directed relationships between them. " +
    "Reply with ONLY valid JSON matching this exact shape — no prose, no markdown fences:\n" +
    '{"entities":[{"label":"<name>","type":"<service|file|concept|library|person|api|database|config|other>"}],' +
    '"edges":[{"source":"<label>","target":"<label>","relation":"<calls|depends_on|implements|extends|reads|writes|configures|deployed_to|other>"}]}';

  try {
    const raw = await ai.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Memory fact: ${fact.slice(0, 2000)}` },
      ],
      max_tokens: 512,
    });

    // The llama chat endpoint returns { response: <string | object> }.
    // When the model outputs valid JSON, workerd may parse it automatically into an object.
    // Handle both cases: pre-parsed object and raw JSON string.
    const rawObj = raw as Record<string, unknown>;
    let parsed: Partial<ExtractionResult>;
    if (rawObj.response && typeof rawObj.response === "object") {
      parsed = rawObj.response as Partial<ExtractionResult>;
    } else {
      const text = extractText(raw).trim();
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start === -1 || end === -1) return { entities: [], edges: [] };
      parsed = JSON.parse(text.slice(start, end + 1)) as Partial<ExtractionResult>;
    }
    const entities = (parsed.entities ?? []).filter(
      (e): e is ExtractedEntity => typeof e?.label === "string" && typeof e?.type === "string"
    );
    const edges = (parsed.edges ?? []).filter(
      (e): e is ExtractedEdge =>
        typeof e?.source === "string" && typeof e?.target === "string" && typeof e?.relation === "string"
    );
    return { entities, edges };
  } catch {
    return { entities: [], edges: [] };
  }
}

// Persists extracted entities and edges, returning the IDs of all entity nodes
// created or matched for this fact.  Deduplicates nodes by (userId, projectKey, label)
// so repeated mentions of the same service accumulate edges without duplicating nodes.
export async function persistGraphData(
  d1: D1Database,
  memoryId: string,
  userId: string,
  projectKey: string | null,
  extraction: ExtractionResult
): Promise<string[]> {
  if (extraction.entities.length === 0) return [];

  const db = drizzle(d1);
  const now = Date.now();
  const labelToNodeId = new Map<string, string>();

  for (const entity of extraction.entities) {
    const normalLabel = entity.label.trim().slice(0, 128);
    if (!normalLabel) continue;

    // Check for an existing node with the same (userId, projectKey, label) tuple.
    const existing = await db
      .select({ id: memoryGraphNodes.id })
      .from(memoryGraphNodes)
      .where(
        sql`${memoryGraphNodes.userId} = ${userId}
          AND ${memoryGraphNodes.label} = ${normalLabel}
          AND (${memoryGraphNodes.projectKey} IS ${projectKey} OR ${memoryGraphNodes.projectKey} = ${projectKey ?? ""})`
      )
      .limit(1)
      .all();

    let nodeId: string;
    if (existing[0]) {
      nodeId = existing[0].id;
    } else {
      nodeId = crypto.randomUUID();
      await db.insert(memoryGraphNodes).values({
        id: nodeId,
        userId,
        projectKey: projectKey ?? null,
        label: normalLabel,
        type: entity.type.trim().slice(0, 64) || "other",
        createdAt: now,
      });
    }
    labelToNodeId.set(normalLabel, nodeId);
    // Also index by original label in case casing differs slightly.
    labelToNodeId.set(entity.label.trim(), nodeId);
  }

  const nodeIds = Array.from(new Set(labelToNodeId.values()));

  for (const edge of extraction.edges) {
    const sourceId = labelToNodeId.get(edge.source.trim());
    const targetId = labelToNodeId.get(edge.target.trim());
    if (!sourceId || !targetId || sourceId === targetId) continue;

    await db.insert(memoryGraphEdges).values({
      id: crypto.randomUUID(),
      memoryId,
      sourceNodeId: sourceId,
      targetNodeId: targetId,
      relation: edge.relation.trim().slice(0, 64) || "other",
      createdAt: now,
    });
  }

  return nodeIds;
}

// Given a set of entity IDs stored in Vectorize metadata, fetches all memory IDs
// that share at least one entity node — the "graph expansion" step.
// Returns the expanded set of memory IDs (including the originals).
export async function expandByEntityIds(
  d1: D1Database,
  entityIds: string[],
  originalMemoryIds: string[]
): Promise<string[]> {
  if (entityIds.length === 0) return originalMemoryIds;

  const db = drizzle(d1);

  // Collect all memory IDs linked to any of these entity nodes (via either endpoint of an edge).
  const [sourceRows, targetRows] = await Promise.all([
    db
      .select({ memoryId: memoryGraphEdges.memoryId })
      .from(memoryGraphEdges)
      .where(inArray(memoryGraphEdges.sourceNodeId, entityIds))
      .all(),
    db
      .select({ memoryId: memoryGraphEdges.memoryId })
      .from(memoryGraphEdges)
      .where(inArray(memoryGraphEdges.targetNodeId, entityIds))
      .all(),
  ]);

  const expanded = new Set(originalMemoryIds);
  for (const r of sourceRows) expanded.add(r.memoryId);
  for (const r of targetRows) expanded.add(r.memoryId);

  return Array.from(expanded);
}
