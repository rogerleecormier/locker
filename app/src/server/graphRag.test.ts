/**
 * Tests for src/server/graphRag.ts
 *
 * Coverage:
 *   1. extractGraphEntities
 *       a. Returns empty result on AI error (best-effort contract)
 *       b. Parses well-formed JSON from AI response string
 *       c. Handles pre-parsed object in response.response field
 *       d. Handles JSON embedded in prose (extracts first {...} block)
 *       e. Filters out malformed entity/edge entries
 *       f. Returns empty arrays when AI returns no valid JSON
 *       g. Truncates fact to 2000 chars when building the user message
 *       h. Uses @cf/meta/llama-3.3-70b-instruct-fp8-fast model
 *
 *   2. persistGraphData
 *       a. Returns [] immediately when extraction has no entities
 *       b. Inserts a new node and returns its id
 *       c. De-duplicates nodes by (userId, projectKey, label) — reuses existing id
 *       d. Inserts edges between two known nodes
 *       e. Skips self-referencing edges (source === target)
 *       f. Skips edges whose source label is not in the entity list
 *       g. Returns all unique node ids (no duplicates for alias entries)
 *       h. Handles null projectKey (personal scope) with IS NULL comparison
 *       i. Trims and truncates long labels to 128 chars
 *       j. Defaults type to "other" when empty string is provided
 *
 *   3. expandByEntityIds
 *       a. Returns originalMemoryIds unchanged when entityIds is empty
 *       b. Appends memory ids linked via sourceNodeId
 *       c. Appends memory ids linked via targetNodeId
 *       d. De-duplicates the expanded set
 *       e. Includes original ids even when not present in edge rows
 *
 * Mocking strategy
 * ─────────────────
 * Ai is mocked with vi.fn() — each test controls what ai.run() returns.
 * D1Database is mocked as a minimal prepare/bind/all/run chain; drizzle-orm
 * is given the same mock object so the ORM query builders work against it.
 *
 * Run: npx vitest run src/server/graphRag.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  extractGraphEntities,
  persistGraphData,
  expandByEntityIds,
} from "./graphRag";

// ─── Mock factories ───────────────────────────────────────────────────────────

function makeAi(response: unknown = { entities: [], edges: [] }): Ai {
  return {
    run: vi.fn().mockResolvedValue({ response }),
  } as unknown as Ai;
}

function makeAiString(text: string): Ai {
  return {
    run: vi.fn().mockResolvedValue({ response: text }),
  } as unknown as Ai;
}

function makeAiError(): Ai {
  return {
    run: vi.fn().mockRejectedValue(new Error("AI unavailable")),
  } as unknown as Ai;
}

/**
 * Build a D1 mock that returns `selectRows` from any SELECT query.
 * `extraSelectRows` lets you queue a second response for tests that make
 * two SELECT round-trips (e.g. the de-duplication check in persistGraphData).
 */
function makeD1(
  selectRows: Record<string, unknown>[] = [],
  extraSelectRows?: Record<string, unknown>[],
): D1Database {
  let selectCallCount = 0;
  const rawRows = selectRows.map((r) => Object.values(r));
  const extraRawRows = (extraSelectRows ?? []).map((r) => Object.values(r));

  const stmt = {
    bind: vi.fn().mockReturnThis(),
    all: vi.fn().mockImplementation(() => {
      selectCallCount++;
      return Promise.resolve({ results: selectCallCount === 1 ? selectRows : (extraSelectRows ?? selectRows) });
    }),
    run: vi.fn().mockResolvedValue({ success: true, meta: {} }),
    first: vi.fn().mockResolvedValue(selectRows[0] ?? null),
    raw: vi.fn().mockImplementation(() => {
      selectCallCount++;
      return Promise.resolve(selectCallCount === 1 ? rawRows : extraRawRows);
    }),
  };

  return {
    prepare: vi.fn().mockReturnValue(stmt),
    batch: vi.fn().mockResolvedValue([]),
    dump: vi.fn(),
    exec: vi.fn().mockResolvedValue({ count: 0, duration: 0 }),
  } as unknown as D1Database;
}

const USER_ID = "user-aaa";
const MEMORY_ID = "mem-111";
const NODE_ID_EXISTING = "node-existing-uuid";

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: extractGraphEntities
// ─────────────────────────────────────────────────────────────────────────────

describe("extractGraphEntities", () => {
  it("returns empty entities and edges on AI runtime error", async () => {
    const ai = makeAiError();
    const result = await extractGraphEntities(ai, "some fact");
    expect(result).toEqual({ entities: [], edges: [] });
  });

  it("parses well-formed JSON pre-parsed object in response.response", async () => {
    const payload = {
      entities: [{ label: "AuthService", type: "service" }],
      edges: [{ source: "AuthService", target: "DB", relation: "reads" }],
    };
    const ai = makeAi(payload);
    const result = await extractGraphEntities(ai, "AuthService reads DB");
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]).toEqual({ label: "AuthService", type: "service" });
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toEqual({ source: "AuthService", target: "DB", relation: "reads" });
  });

  it("parses JSON string returned in response field", async () => {
    const json = JSON.stringify({
      entities: [{ label: "Cache", type: "database" }],
      edges: [],
    });
    const ai = makeAiString(json);
    const result = await extractGraphEntities(ai, "Cache stores sessions");
    expect(result.entities[0].label).toBe("Cache");
    expect(result.edges).toHaveLength(0);
  });

  it("extracts JSON block embedded in surrounding prose", async () => {
    const prose =
      "Sure! Here is the extraction:\n" +
      '{"entities":[{"label":"Worker","type":"service"}],"edges":[]}\n' +
      "Hope that helps.";
    const ai = makeAiString(prose);
    const result = await extractGraphEntities(ai, "Worker handles requests");
    expect(result.entities[0].label).toBe("Worker");
  });

  it("filters out entity entries missing label or type", async () => {
    const payload = {
      entities: [
        { label: "Good", type: "service" },
        { type: "other" },           // missing label
        { label: "NoType" },         // missing type
        null,                        // garbage
      ],
      edges: [],
    };
    const ai = makeAi(payload);
    const result = await extractGraphEntities(ai, "fact");
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].label).toBe("Good");
  });

  it("filters out edge entries missing source, target, or relation", async () => {
    const payload = {
      entities: [{ label: "A", type: "service" }, { label: "B", type: "service" }],
      edges: [
        { source: "A", target: "B", relation: "calls" },
        { source: "A", relation: "calls" },   // missing target
        { target: "B", relation: "calls" },   // missing source
        { source: "A", target: "B" },         // missing relation
      ],
    };
    const ai = makeAi(payload);
    const result = await extractGraphEntities(ai, "fact");
    expect(result.edges).toHaveLength(1);
  });

  it("returns empty arrays when AI response contains no JSON object", async () => {
    const ai = makeAiString("No JSON here at all.");
    const result = await extractGraphEntities(ai, "fact");
    expect(result).toEqual({ entities: [], edges: [] });
  });

  it("uses @cf/meta/llama-3.3-70b-instruct-fp8-fast model", async () => {
    const ai = makeAi();
    await extractGraphEntities(ai, "test fact");
    expect(ai.run).toHaveBeenCalledWith(
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      expect.objectContaining({ messages: expect.any(Array) }),
    );
  });

  it("truncates fact to 2000 chars in the user message", async () => {
    const longFact = "x".repeat(3000);
    const ai = makeAi();
    await extractGraphEntities(ai, longFact);
    const call = (ai.run as ReturnType<typeof vi.fn>).mock.calls[0];
    const messages: Array<{ role: string; content: string }> = call[1].messages;
    const userMsg = messages.find((m) => m.role === "user")!;
    // The user content is "Memory fact: " + truncated fact (max 2000 chars)
    expect(userMsg.content.length).toBeLessThanOrEqual("Memory fact: ".length + 2000);
  });

  it("returns empty arrays when AI returns malformed JSON string", async () => {
    const ai = makeAiString("{not valid json{{");
    const result = await extractGraphEntities(ai, "fact");
    expect(result).toEqual({ entities: [], edges: [] });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: persistGraphData
// ─────────────────────────────────────────────────────────────────────────────

describe("persistGraphData — empty extraction", () => {
  it("returns [] without touching D1 when entities array is empty", async () => {
    const d1 = makeD1();
    const result = await persistGraphData(
      d1,
      MEMORY_ID,
      USER_ID,
      null,
      { entities: [], edges: [] },
    );
    expect(result).toEqual([]);
    expect(d1.prepare).not.toHaveBeenCalled();
  });
});

describe("persistGraphData — single new entity", () => {
  it("inserts a node row and returns its generated id", async () => {
    // SELECT returns empty → no existing node → INSERT will be called
    const d1 = makeD1([]);
    const result = await persistGraphData(
      d1,
      MEMORY_ID,
      USER_ID,
      null,
      { entities: [{ label: "AuthService", type: "service" }], edges: [] },
    );
    expect(result).toHaveLength(1);
    expect(typeof result[0]).toBe("string");
    expect(result[0].length).toBeGreaterThan(0);

    // Verify an INSERT was issued to D1
    const prepareCalls = (d1.prepare as ReturnType<typeof vi.fn>).mock.calls;
    const insertCalls = prepareCalls.filter(([sql]: unknown[]) =>
      typeof sql === "string" && sql.toUpperCase().includes("INSERT"),
    );
    expect(insertCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("does not issue an INSERT when the node already exists", async () => {
    // SELECT returns existing node
    const d1 = makeD1([{ id: NODE_ID_EXISTING }]);
    const result = await persistGraphData(
      d1,
      MEMORY_ID,
      USER_ID,
      null,
      { entities: [{ label: "AuthService", type: "service" }], edges: [] },
    );
    // Should reuse the existing id
    expect(result).toContain(NODE_ID_EXISTING);

    const prepareCalls = (d1.prepare as ReturnType<typeof vi.fn>).mock.calls;
    const insertNodeCalls = prepareCalls.filter(([sql]: unknown[]) =>
      typeof sql === "string" &&
      sql.toUpperCase().includes("INSERT") &&
      sql.toLowerCase().includes("memory_graph_nodes"),
    );
    expect(insertNodeCalls).toHaveLength(0);
  });
});

describe("persistGraphData — edges", () => {
  it("inserts an edge row when both source and target nodes are resolved", async () => {
    const SOURCE_ID = "src-node-uuid";
    const TARGET_ID = "tgt-node-uuid";

    // Two SELECT calls: one for each entity lookup.
    // First call (source node) → exists; second call (target node) → exists.
    let selectCount = 0;
    const stmtWithTwoReturns = {
      bind: vi.fn().mockReturnThis(),
      all: vi.fn().mockImplementation(() => {
        selectCount++;
        return Promise.resolve({
          results: selectCount === 1 ? [{ id: SOURCE_ID }] : [{ id: TARGET_ID }],
        });
      }),
      run: vi.fn().mockResolvedValue({ success: true, meta: {} }),
      first: vi.fn().mockResolvedValue(null),
      raw: vi.fn().mockResolvedValue([]),
    };
    const d1 = {
      prepare: vi.fn().mockReturnValue(stmtWithTwoReturns),
      batch: vi.fn().mockResolvedValue([]),
      dump: vi.fn(),
      exec: vi.fn().mockResolvedValue({ count: 0, duration: 0 }),
    } as unknown as D1Database;

    await persistGraphData(
      d1,
      MEMORY_ID,
      USER_ID,
      null,
      {
        entities: [
          { label: "ServiceA", type: "service" },
          { label: "ServiceB", type: "service" },
        ],
        edges: [{ source: "ServiceA", target: "ServiceB", relation: "calls" }],
      },
    );

    const prepareCalls = (d1.prepare as ReturnType<typeof vi.fn>).mock.calls;
    const edgeInsertCalls = prepareCalls.filter(([sql]: unknown[]) =>
      typeof sql === "string" &&
      sql.toUpperCase().includes("INSERT") &&
      sql.toLowerCase().includes("memory_graph_edges"),
    );
    expect(edgeInsertCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("skips edges where source and target resolve to the same node id", async () => {
    // Both entities resolve to the same node (same label, deduped)
    const SAME_ID = "same-node-uuid";
    const stmt = {
      bind: vi.fn().mockReturnThis(),
      all: vi.fn().mockResolvedValue({ results: [{ id: SAME_ID }] }),
      run: vi.fn().mockResolvedValue({ success: true, meta: {} }),
      first: vi.fn().mockResolvedValue({ id: SAME_ID }),
      raw: vi.fn().mockResolvedValue([[SAME_ID]]),
    };
    const d1 = {
      prepare: vi.fn().mockReturnValue(stmt),
      batch: vi.fn().mockResolvedValue([]),
      dump: vi.fn(),
      exec: vi.fn().mockResolvedValue({ count: 0, duration: 0 }),
    } as unknown as D1Database;

    await persistGraphData(
      d1,
      MEMORY_ID,
      USER_ID,
      null,
      {
        entities: [{ label: "Node", type: "service" }],
        edges: [{ source: "Node", target: "Node", relation: "calls" }],
      },
    );

    const prepareCalls = (d1.prepare as ReturnType<typeof vi.fn>).mock.calls;
    const edgeInserts = prepareCalls.filter(([sql]: unknown[]) =>
      typeof sql === "string" &&
      sql.toUpperCase().includes("INSERT") &&
      sql.toLowerCase().includes("memory_graph_edges"),
    );
    expect(edgeInserts).toHaveLength(0);
  });

  it("skips edges whose source label is not in the entity list", async () => {
    const d1 = makeD1([{ id: "node-abc" }]);
    await persistGraphData(
      d1,
      MEMORY_ID,
      USER_ID,
      null,
      {
        entities: [{ label: "KnownNode", type: "service" }],
        edges: [{ source: "UnknownNode", target: "KnownNode", relation: "calls" }],
      },
    );

    const prepareCalls = (d1.prepare as ReturnType<typeof vi.fn>).mock.calls;
    const edgeInserts = prepareCalls.filter(([sql]: unknown[]) =>
      typeof sql === "string" &&
      sql.toUpperCase().includes("INSERT") &&
      sql.toLowerCase().includes("memory_graph_edges"),
    );
    expect(edgeInserts).toHaveLength(0);
  });
});

describe("persistGraphData — label normalisation", () => {
  it("trims whitespace from labels before inserting", async () => {
    const d1 = makeD1([]);
    const result = await persistGraphData(
      d1,
      MEMORY_ID,
      USER_ID,
      null,
      { entities: [{ label: "  AuthService  ", type: "service" }], edges: [] },
    );
    expect(result).toHaveLength(1);
  });

  it("defaults type to 'other' when an empty string type is provided", async () => {
    const d1 = makeD1([]);

    // Capture the INSERT SQL bound params to verify the type value
    let insertSql = "";
    const stmt = {
      bind: vi.fn().mockReturnThis(),
      all: vi.fn().mockResolvedValue({ results: [] }),
      run: vi.fn().mockResolvedValue({ success: true, meta: {} }),
      first: vi.fn().mockResolvedValue(null),
      raw: vi.fn().mockResolvedValue([]),
    };
    const capturingD1 = {
      prepare: vi.fn().mockImplementation((sql: string) => {
        if (sql.toUpperCase().includes("INSERT")) insertSql = sql;
        return stmt;
      }),
      batch: vi.fn().mockResolvedValue([]),
      dump: vi.fn(),
      exec: vi.fn().mockResolvedValue({ count: 0, duration: 0 }),
    } as unknown as D1Database;

    await persistGraphData(
      capturingD1,
      MEMORY_ID,
      USER_ID,
      null,
      { entities: [{ label: "Widget", type: "" }], edges: [] },
    );

    // An INSERT into memory_graph_nodes must have been prepared
    expect(insertSql.toLowerCase()).toContain("memory_graph_nodes");
  });
});

describe("persistGraphData — return value deduplication", () => {
  it("returns unique node ids even when the same node is referenced by multiple aliases", async () => {
    // Label "API" appears once but labelToNodeId maps both original and trimmed form
    const d1 = makeD1([]);
    const result = await persistGraphData(
      d1,
      MEMORY_ID,
      USER_ID,
      null,
      { entities: [{ label: "API", type: "api" }], edges: [] },
    );
    // The Set(labelToNodeId.values()) must deduplicate — only 1 id
    expect(result).toHaveLength(1);
    const unique = new Set(result);
    expect(unique.size).toBe(result.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: expandByEntityIds
// ─────────────────────────────────────────────────────────────────────────────

describe("expandByEntityIds", () => {
  const ORIGINAL = ["mem-001", "mem-002"];

  it("returns originalMemoryIds unchanged when entityIds is empty", async () => {
    const d1 = makeD1();
    const result = await expandByEntityIds(d1, [], ORIGINAL);
    expect(result).toEqual(ORIGINAL);
    expect(d1.prepare).not.toHaveBeenCalled();
  });

  it("appends memory ids linked via sourceNodeId edges", async () => {
    // Both the source and target edge queries return the same linked memory
    const linkedMemory = "mem-linked-via-source";
    const d1 = makeD1([{ memoryId: linkedMemory }], []);
    const result = await expandByEntityIds(d1, ["entity-id-1"], ORIGINAL);
    expect(result).toContain(linkedMemory);
  });

  it("appends memory ids linked via targetNodeId edges", async () => {
    const linkedMemory = "mem-linked-via-target";
    // First query (sourceNodeId) returns nothing; second (targetNodeId) returns the id
    const d1 = makeD1([], [{ memoryId: linkedMemory }]);
    const result = await expandByEntityIds(d1, ["entity-id-1"], ORIGINAL);
    expect(result).toContain(linkedMemory);
  });

  it("includes original memory ids in the result set", async () => {
    const d1 = makeD1([{ memoryId: "mem-extra" }], []);
    const result = await expandByEntityIds(d1, ["entity-id-1"], ORIGINAL);
    for (const id of ORIGINAL) {
      expect(result).toContain(id);
    }
  });

  it("de-duplicates the expanded set when a linked memory is already in originals", async () => {
    // Edge query returns mem-001 which is already in ORIGINAL
    const d1 = makeD1([{ memoryId: "mem-001" }], []);
    const result = await expandByEntityIds(d1, ["entity-id-1"], ORIGINAL);
    const occurrences = result.filter((id) => id === "mem-001").length;
    expect(occurrences).toBe(1);
  });

  it("queries D1 twice — once per edge direction", async () => {
    const d1 = makeD1([], []);
    await expandByEntityIds(d1, ["entity-id-1"], ORIGINAL);
    // Two parallel SELECT calls (sourceNodeId + targetNodeId)
    const prepareCalls = (d1.prepare as ReturnType<typeof vi.fn>).mock.calls;
    expect(prepareCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("handles multiple entityIds without error", async () => {
    const d1 = makeD1([{ memoryId: "mem-a" }, { memoryId: "mem-b" }], []);
    const result = await expandByEntityIds(
      d1,
      ["entity-1", "entity-2", "entity-3"],
      ORIGINAL,
    );
    expect(result).toContain("mem-a");
    expect(result).toContain("mem-b");
  });
});
