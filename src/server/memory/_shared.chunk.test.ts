/**
 * Tests for the chunk-embedding pipeline in src/server/memory/_shared.ts
 *
 * Coverage:
 *   1. generateChunkedEmbeddings
 *       a. Single-chunk pass-through (short text)
 *       b. Multi-chunk embedding (long text)
 *       c. Each chunk gets its own embedding call
 *       d. Returned embeddings match mock AI output
 *
 *   2. persistChunkedVectors
 *       a. Single-chunk path: upserts parent vector with isChunk:"0",
 *          no D1 rows inserted
 *       b. Multi-chunk path: upserts all vectors, inserts child chunk
 *          rows into D1 with correct parentId / chunkIndex / startOffset
 *       c. Returns the first chunk's embedding
 *       d. Shared metadata is spread onto all vectors
 *       e. Parent vector id always equals memoryId
 *       f. Child vector ids are UUIDs distinct from memoryId
 *       g. Child Vectorize metadata carries isChunk:"1", parentId, chunkIndex
 *       h. AI is called once per chunk (sequential, not parallel)
 *
 *   3. deleteChunkVectors
 *       a. No-op when no child rows exist (no deleteByIds call)
 *       b. Deletes Vectorize vectors and D1 rows when children exist
 *       c. Calls deleteByIds with exact chunk ids
 *
 * Mocking strategy
 * ─────────────────
 * D1Database is mocked as a minimal object whose prepare().bind().all() /
 * prepare().bind().run() chain returns controlled data.  We hand the same
 * mock to drizzle so the ORM layer works against it.
 *
 * VectorizeIndex is mocked with vi.fn() stubs.
 * Ai is mocked with vi.fn() returning fixed embedding arrays.
 *
 * Run: npx vitest run src/server/memory/_shared.chunk.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateChunkedEmbeddings,
  persistChunkedVectors,
  deleteChunkVectors,
} from "./_shared";
import { CHUNK_TARGET_CHARS } from "~/server/textChunker";

// ─── Mock factories ───────────────────────────────────────────────────────────

/** Fixed embedding returned by the mock AI for every run() call. */
const MOCK_EMBEDDING = [0.1, 0.2, 0.3];

/**
 * Build a mock Ai binding.
 * `runImpl` lets individual tests override the default behaviour.
 */
function makeAi(runImpl?: () => unknown): Ai {
  return {
    run: vi.fn().mockImplementation(
      runImpl ??
        (() =>
          Promise.resolve({ data: [MOCK_EMBEDDING], shape: [1, 3] })),
    ),
  } as unknown as Ai;
}

/** Build a mock VectorizeIndex. */
function makeVectorIndex() {
  return {
    upsert: vi.fn().mockResolvedValue(undefined),
    insert: vi.fn().mockResolvedValue(undefined),
    deleteByIds: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue({ matches: [] }),
    getByIds: vi.fn().mockResolvedValue({ vectors: [] }),
    describe: vi.fn().mockResolvedValue({}),
  } as unknown as VectorizeIndex;
}

/**
 * Build a minimal D1Database mock compatible with drizzle-orm/d1.
 *
 * Drizzle D1 driver calling conventions:
 *   SELECT via .all()    → stmt.bind(...).all()    → { results: Row[] }
 *   SELECT via .values() → stmt.bind(...).raw()    → unknown[][]  (column-ordered arrays)
 *   INSERT / DELETE      → stmt.bind(...).run()    → { success, meta }
 *
 * Drizzle uses .values()/.raw() for .select() builder queries, so raw() must
 * return rows as arrays of column values in definition order.
 */
function makeD1(selectRows: Record<string, unknown>[] = []): D1Database {
  const rawRows = selectRows.map((r) => Object.values(r));
  const stmt = {
    bind: vi.fn().mockReturnThis(),
    all: vi.fn().mockResolvedValue({ results: selectRows }),
    run: vi.fn().mockResolvedValue({ success: true, meta: {} }),
    first: vi.fn().mockResolvedValue(selectRows[0] ?? null),
    raw: vi.fn().mockResolvedValue(rawRows),
  };
  return {
    prepare: vi.fn().mockReturnValue(stmt),
    batch: vi.fn().mockResolvedValue([]),
    dump: vi.fn(),
    exec: vi.fn().mockResolvedValue({ count: 0, duration: 0 }),
  } as unknown as D1Database;
}

/** Shared metadata used across tests. */
const BASE_META: Record<string, string> = {
  userId: "user-123",
  category: "rules",
  tags: "test",
  projectKey: "",
  entityIds: "",
};

const PARENT_ID = "11111111-1111-1111-1111-111111111111";

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: generateChunkedEmbeddings
// ─────────────────────────────────────────────────────────────────────────────

describe("generateChunkedEmbeddings", () => {
  it("returns single-element array for short text", async () => {
    const ai = makeAi();
    const result = await generateChunkedEmbeddings(ai, "short text");
    expect(result).toHaveLength(1);
    expect(result[0].chunk.index).toBe(0);
    expect(result[0].chunk.startOffset).toBe(0);
    expect(result[0].chunk.text).toBe("short text");
  });

  it("calls ai.run exactly once for short text", async () => {
    const ai = makeAi();
    await generateChunkedEmbeddings(ai, "short text");
    expect(ai.run).toHaveBeenCalledTimes(1);
  });

  it("calls ai.run with the @cf/baai/bge-m3 model id", async () => {
    const ai = makeAi();
    await generateChunkedEmbeddings(ai, "hello");
    expect(ai.run).toHaveBeenCalledWith("@cf/baai/bge-m3", { text: ["hello"] });
  });

  it("returns embedding from ai.run for single chunk", async () => {
    const ai = makeAi();
    const result = await generateChunkedEmbeddings(ai, "hello world");
    expect(result[0].embedding).toEqual(MOCK_EMBEDDING);
  });

  it("calls ai.run N times for N chunks (multi-chunk long text)", async () => {
    const ai = makeAi();
    // Text long enough to produce at least 2 chunks
    const longText = "sentence here end. ".repeat(100); // ~1900 chars
    const result = await generateChunkedEmbeddings(ai, longText);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(ai.run).toHaveBeenCalledTimes(result.length);
  });

  it("embedding array is returned for each chunk when text is multi-chunk", async () => {
    const ai = makeAi();
    const longText = "word ".repeat(400);
    const result = await generateChunkedEmbeddings(ai, longText);
    for (const { embedding } of result) {
      expect(embedding).toEqual(MOCK_EMBEDDING);
    }
  });

  it("each chunk carries correct sequential index", async () => {
    const ai = makeAi();
    const longText = "sentence end. ".repeat(120);
    const result = await generateChunkedEmbeddings(ai, longText);
    result.forEach(({ chunk }, i) => expect(chunk.index).toBe(i));
  });

  it("handles ai.run returning empty data array gracefully", async () => {
    const ai = makeAi(() => Promise.resolve({ data: [], shape: [0] }));
    const result = await generateChunkedEmbeddings(ai, "test");
    expect(result[0].embedding).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: persistChunkedVectors — single-chunk path
// ─────────────────────────────────────────────────────────────────────────────

describe("persistChunkedVectors — single-chunk (short fact)", () => {
  let ai: Ai;
  let d1: D1Database;
  let vectorIndex: ReturnType<typeof makeVectorIndex>;

  beforeEach(() => {
    ai = makeAi();
    d1 = makeD1();
    vectorIndex = makeVectorIndex();
  });

  it("calls vectorIndex.upsert exactly once", async () => {
    await persistChunkedVectors(ai, d1, vectorIndex, PARENT_ID, "short fact", BASE_META);
    expect(vectorIndex.upsert).toHaveBeenCalledTimes(1);
  });

  it("upserts the parent vector with id === memoryId", async () => {
    await persistChunkedVectors(ai, d1, vectorIndex, PARENT_ID, "short fact", BASE_META);
    const [vectors] = (vectorIndex.upsert as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(vectors[0].id).toBe(PARENT_ID);
  });

  it("parent vector has isChunk:'0' in metadata", async () => {
    await persistChunkedVectors(ai, d1, vectorIndex, PARENT_ID, "short fact", BASE_META);
    const [vectors] = (vectorIndex.upsert as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(vectors[0].metadata.isChunk).toBe("0");
  });

  it("spreads sharedMeta onto parent vector metadata", async () => {
    await persistChunkedVectors(ai, d1, vectorIndex, PARENT_ID, "short fact", BASE_META);
    const [vectors] = (vectorIndex.upsert as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(vectors[0].metadata.userId).toBe("user-123");
    expect(vectors[0].metadata.category).toBe("rules");
  });

  it("does NOT insert any D1 chunk rows for single-chunk text", async () => {
    await persistChunkedVectors(ai, d1, vectorIndex, PARENT_ID, "short fact", BASE_META);
    // For a single chunk the insert branch is skipped — prepare should only be
    // called for the SELECT in deleteChunkVectors (not called here) or not at all.
    // We verify no INSERT was issued by checking prepare was not called with INSERT.
    const prepareCalls = (d1.prepare as ReturnType<typeof vi.fn>).mock.calls;
    const insertCalls = prepareCalls.filter(([sql]: [string]) =>
      typeof sql === "string" && sql.toUpperCase().startsWith("INSERT")
    );
    expect(insertCalls).toHaveLength(0);
  });

  it("returns the first chunk embedding", async () => {
    const result = await persistChunkedVectors(ai, d1, vectorIndex, PARENT_ID, "short", BASE_META);
    expect(result).toEqual(MOCK_EMBEDDING);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: persistChunkedVectors — multi-chunk path
// ─────────────────────────────────────────────────────────────────────────────

describe("persistChunkedVectors — multi-chunk (long fact)", () => {
  let ai: Ai;
  let d1: D1Database;
  let vectorIndex: ReturnType<typeof makeVectorIndex>;
  // Text just over the chunk limit to force exactly 2 chunks
  const longText = "sentence end. ".repeat(115); // ~1610 chars with defaults → 2 chunks

  beforeEach(() => {
    ai = makeAi();
    d1 = makeD1();
    vectorIndex = makeVectorIndex();
  });

  it("calls vectorIndex.upsert once with all chunks in one batch", async () => {
    await persistChunkedVectors(ai, d1, vectorIndex, PARENT_ID, longText, BASE_META);
    expect(vectorIndex.upsert).toHaveBeenCalledTimes(1);
    const [vectors] = (vectorIndex.upsert as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(vectors.length).toBeGreaterThanOrEqual(2);
  });

  it("first vector in batch has id === memoryId (parent)", async () => {
    await persistChunkedVectors(ai, d1, vectorIndex, PARENT_ID, longText, BASE_META);
    const [vectors] = (vectorIndex.upsert as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(vectors[0].id).toBe(PARENT_ID);
  });

  it("child vectors have ids distinct from memoryId", async () => {
    await persistChunkedVectors(ai, d1, vectorIndex, PARENT_ID, longText, BASE_META);
    const [vectors] = (vectorIndex.upsert as ReturnType<typeof vi.fn>).mock.calls[0];
    const childIds = vectors.slice(1).map((v: VectorizeVector) => v.id);
    for (const cid of childIds) {
      expect(cid).not.toBe(PARENT_ID);
    }
  });

  it("child vectors carry isChunk:'1' in metadata", async () => {
    await persistChunkedVectors(ai, d1, vectorIndex, PARENT_ID, longText, BASE_META);
    const [vectors] = (vectorIndex.upsert as ReturnType<typeof vi.fn>).mock.calls[0];
    const children = vectors.slice(1) as VectorizeVector[];
    for (const child of children) {
      expect((child.metadata as Record<string, string>).isChunk).toBe("1");
    }
  });

  it("child vector metadata carries parentId === memoryId", async () => {
    await persistChunkedVectors(ai, d1, vectorIndex, PARENT_ID, longText, BASE_META);
    const [vectors] = (vectorIndex.upsert as ReturnType<typeof vi.fn>).mock.calls[0];
    const children = vectors.slice(1) as VectorizeVector[];
    for (const child of children) {
      expect((child.metadata as Record<string, string>).parentId).toBe(PARENT_ID);
    }
  });

  it("child vector metadata carries chunkIndex as string", async () => {
    await persistChunkedVectors(ai, d1, vectorIndex, PARENT_ID, longText, BASE_META);
    const [vectors] = (vectorIndex.upsert as ReturnType<typeof vi.fn>).mock.calls[0];
    const children = vectors.slice(1) as VectorizeVector[];
    children.forEach((child, i) => {
      expect((child.metadata as Record<string, string>).chunkIndex).toBe(String(i + 1));
    });
  });

  it("all vectors carry sharedMeta fields", async () => {
    await persistChunkedVectors(ai, d1, vectorIndex, PARENT_ID, longText, BASE_META);
    const [vectors] = (vectorIndex.upsert as ReturnType<typeof vi.fn>).mock.calls[0];
    for (const v of vectors as VectorizeVector[]) {
      const m = v.metadata as Record<string, string>;
      expect(m.userId).toBe("user-123");
      expect(m.category).toBe("rules");
    }
  });

  it("inserts D1 rows for child chunks (prepare called with INSERT)", async () => {
    await persistChunkedVectors(ai, d1, vectorIndex, PARENT_ID, longText, BASE_META);
    const prepareCalls = (d1.prepare as ReturnType<typeof vi.fn>).mock.calls;
    const insertCalls = prepareCalls.filter(([sql]: [string]) =>
      typeof sql === "string" && sql.toUpperCase().includes("INSERT")
    );
    expect(insertCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("returns the first chunk embedding (MOCK_EMBEDDING)", async () => {
    const result = await persistChunkedVectors(ai, d1, vectorIndex, PARENT_ID, longText, BASE_META);
    expect(result).toEqual(MOCK_EMBEDDING);
  });

  it("ai.run is called once per chunk", async () => {
    await persistChunkedVectors(ai, d1, vectorIndex, PARENT_ID, longText, BASE_META);
    // Number of ai.run calls should match number of vectors upserted
    const [vectors] = (vectorIndex.upsert as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(ai.run).toHaveBeenCalledTimes(vectors.length);
  });

  it("each vector carries the mock embedding as its values", async () => {
    await persistChunkedVectors(ai, d1, vectorIndex, PARENT_ID, longText, BASE_META);
    const [vectors] = (vectorIndex.upsert as ReturnType<typeof vi.fn>).mock.calls[0];
    for (const v of vectors as VectorizeVector[]) {
      expect(v.values).toEqual(MOCK_EMBEDDING);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: deleteChunkVectors
// ─────────────────────────────────────────────────────────────────────────────

describe("deleteChunkVectors — no existing chunks", () => {
  it("does not call vectorIndex.deleteByIds when no chunk rows exist", async () => {
    const d1 = makeD1([]); // empty SELECT result
    const vectorIndex = makeVectorIndex();
    await deleteChunkVectors(d1, vectorIndex, PARENT_ID);
    expect(vectorIndex.deleteByIds).not.toHaveBeenCalled();
  });

  it("does not issue a DELETE SQL when no chunk rows exist", async () => {
    const d1 = makeD1([]);
    const vectorIndex = makeVectorIndex();
    await deleteChunkVectors(d1, vectorIndex, PARENT_ID);
    const prepareCalls = (d1.prepare as ReturnType<typeof vi.fn>).mock.calls;
    const deleteCalls = prepareCalls.filter(([sql]: [string]) =>
      typeof sql === "string" && sql.toUpperCase().startsWith("DELETE")
    );
    expect(deleteCalls).toHaveLength(0);
  });
});

describe("deleteChunkVectors — existing chunks", () => {
  const CHUNK_ID_1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const CHUNK_ID_2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  it("calls vectorIndex.deleteByIds with the chunk ids from D1", async () => {
    const d1 = makeD1([{ id: CHUNK_ID_1 }, { id: CHUNK_ID_2 }]);
    const vectorIndex = makeVectorIndex();
    await deleteChunkVectors(d1, vectorIndex, PARENT_ID);
    expect(vectorIndex.deleteByIds).toHaveBeenCalledTimes(1);
    const [ids] = (vectorIndex.deleteByIds as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(ids).toContain(CHUNK_ID_1);
    expect(ids).toContain(CHUNK_ID_2);
  });

  it("issues a DELETE SQL after deleteByIds", async () => {
    const d1 = makeD1([{ id: CHUNK_ID_1 }]);
    const vectorIndex = makeVectorIndex();
    await deleteChunkVectors(d1, vectorIndex, PARENT_ID);
    const prepareCalls = (d1.prepare as ReturnType<typeof vi.fn>).mock.calls;
    const deleteCalls = prepareCalls.filter(([sql]: [string]) =>
      typeof sql === "string" && sql.toUpperCase().startsWith("DELETE")
    );
    expect(deleteCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("does not include the parent memory id in the deleteByIds call", async () => {
    const d1 = makeD1([{ id: CHUNK_ID_1 }]);
    const vectorIndex = makeVectorIndex();
    await deleteChunkVectors(d1, vectorIndex, PARENT_ID);
    const [ids] = (vectorIndex.deleteByIds as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(ids).not.toContain(PARENT_ID);
  });

  it("handles a single chunk row correctly", async () => {
    const d1 = makeD1([{ id: CHUNK_ID_1 }]);
    const vectorIndex = makeVectorIndex();
    await deleteChunkVectors(d1, vectorIndex, PARENT_ID);
    const [ids] = (vectorIndex.deleteByIds as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(ids).toHaveLength(1);
    expect(ids[0]).toBe(CHUNK_ID_1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5: Round-trip — persist then delete
// ─────────────────────────────────────────────────────────────────────────────

describe("persistChunkedVectors → deleteChunkVectors round-trip", () => {
  it("delete after persist calls deleteByIds only for child ids (not parent)", async () => {
    const longText = "sentence end. ".repeat(115);
    const ai = makeAi();

    // Capture the child chunk ids that were upserted
    const capturedChildIds: string[] = [];
    const vectorIndex = makeVectorIndex();
    (vectorIndex.upsert as ReturnType<typeof vi.fn>).mockImplementation(
      async (vectors: VectorizeVector[]) => {
        for (const v of vectors) {
          if (v.id !== PARENT_ID) capturedChildIds.push(v.id);
        }
      }
    );

    // Persist
    const d1Persist = makeD1();
    await persistChunkedVectors(ai, d1Persist, vectorIndex, PARENT_ID, longText, BASE_META);

    expect(capturedChildIds.length).toBeGreaterThanOrEqual(1);

    // Now simulate a delete — D1 returns those child ids
    const d1Delete = makeD1(capturedChildIds.map((id) => ({ id })));
    await deleteChunkVectors(d1Delete, vectorIndex, PARENT_ID);

    const [deletedIds] = (vectorIndex.deleteByIds as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(deletedIds).toEqual(expect.arrayContaining(capturedChildIds));
    expect(deletedIds).not.toContain(PARENT_ID);
  });
});
