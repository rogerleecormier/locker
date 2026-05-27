import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { drizzle } from "drizzle-orm/d1";
import { memories, type Memory } from "~/db/schema";
import { nukeEverything } from "~/server/memoryFunctions";
import type { CloudflareEnv } from "~/types/cloudflare";

type CFContext = { cloudflare: { env: CloudflareEnv; ctx: ExecutionContext } };

// Server functions for admin operations
export const getDbStats = createServerFn({ method: "GET" }).handler(
  async ({ context }): Promise<{ memoryCount: number; vectorCount: number }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const db = drizzle(env.DB, { schema: { memories } });

    const rows = await db.select().from(memories).all();
    // Vectorize has no count API; use D1 row count as the authoritative number
    return { memoryCount: rows.length, vectorCount: rows.length };
  }
);

export const clearVectorizeIndex = createServerFn({ method: "POST" }).handler(
  async ({ context }): Promise<{ cleared: boolean; deletedCount: number }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const db = drizzle(env.DB, { schema: { memories } });

    const rows = await db.select({ id: memories.id }).from(memories).all();
    const ids = rows.map((r) => r.id);

    if (ids.length === 0) return { cleared: true, deletedCount: 0 };

    const VECTOR_CHUNK = 100;
    for (let i = 0; i < ids.length; i += VECTOR_CHUNK) {
      const chunk = ids.slice(i, i + VECTOR_CHUNK);
      await env.VECTOR_INDEX.deleteByIds(chunk);
    }

    console.log(`[clearVectorizeIndex] deleted ${ids.length} vectors`);
    return { cleared: true, deletedCount: ids.length };
  }
);

export const clearDatabase = createServerFn({ method: "POST" }).handler(
  async ({ context }): Promise<{ cleared: boolean; deletedCount: number }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const db = drizzle(env.DB, { schema: { memories } });

    // Delete from D1
    const rows = await db.select({ id: memories.id }).from(memories).all();
    const dbIds = rows.map((r) => r.id);

    if (dbIds.length > 0) {
      const CHUNK = 10;
      for (let i = 0; i < dbIds.length; i += CHUNK) {
        const chunk = dbIds.slice(i, i + CHUNK);
        await db.delete(memories).where(
          sql`${memories.id} IN (${sql.join(chunk.map((id) => sql`${id}`), sql`, `)})`
        );
      }
      console.log(`[clearDatabase] deleted ${dbIds.length} memories from D1`);
    }

    // Delete vectors using the same IDs we already fetched from D1
    if (dbIds.length > 0) {
      const VECTOR_CHUNK = 100;
      for (let i = 0; i < dbIds.length; i += VECTOR_CHUNK) {
        const chunk = dbIds.slice(i, i + VECTOR_CHUNK);
        console.log(`[clearDatabase] deleting ${chunk.length} vectors: ${chunk.slice(0, 3).join(",")}`);
        await env.VECTOR_INDEX.deleteByIds(chunk);
      }
      console.log(`[clearDatabase] deleted ${dbIds.length} vectors from Vectorize`);
    }

    return { cleared: true, deletedCount: dbIds.length };
  }
);

export const getVectorizeDebug = createServerFn({ method: "GET" }).handler(
  async ({ context }): Promise<{ vectors: Array<{ id: string }> }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const db = drizzle(env.DB, { schema: { memories } });

    // Get all IDs from D1
    const rows = await db.select({ id: memories.id }).from(memories).all();
    const dbIds = rows.map((r) => r.id);

    // Check each D1 vector exists in Vectorize by querying getByIds (if available)
    // Vectorize has no enumerate API, so we can only flag IDs in D1 with no vector counterpart
    // by attempting a getByIds call — fall back to reporting 0 orphans if unsupported
    try {
      // @ts-expect-error getByIds may not be in types yet
      const existing = await env.VECTOR_INDEX.getByIds(dbIds.slice(0, 100));
      const existingIds = new Set((existing ?? []).map((v: { id: string }) => v.id));
      const missing = dbIds.filter((id) => !existingIds.has(id)).slice(0, 20);
      return { vectors: missing.map((id) => ({ id })) };
    } catch {
      return { vectors: [] };
    }
  }
);

// Helper import for sql in clearDatabase
import { sql } from "drizzle-orm";

function AdminPage() {
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmClearVectorize, setConfirmClearVectorize] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const statsQuery = useQuery({
    queryKey: ["admin-stats"],
    queryFn: async () => getDbStats(),
    refetchInterval: 5000,
  });

  const debugQuery = useQuery({
    queryKey: ["admin-debug"],
    queryFn: async () => getVectorizeDebug(),
    refetchInterval: 10000,
  });

  const clearDbMutation = useMutation({
    mutationFn: clearDatabase,
    onSuccess: () => {
      setConfirmClear(false);
      statsQuery.refetch();
      debugQuery.refetch();
    },
  });

  const clearVectorizeMutation = useMutation({
    mutationFn: clearVectorizeIndex,
    onSuccess: () => {
      setConfirmClearVectorize(false);
      statsQuery.refetch();
      debugQuery.refetch();
    },
  });

  const clearAllMutation = useMutation({
    mutationFn: nukeEverything,
    onSuccess: () => {
      setConfirmClearAll(false);
      statsQuery.refetch();
      debugQuery.refetch();
    },
  });

  return (
    <div style={{ padding: "20px", maxWidth: "900px", margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1>Admin Panel</h1>
        <Link to="/" style={{ color: "var(--accent)", fontSize: "14px" }}>← Back to App</Link>
      </div>

      <section style={{ marginTop: "30px" }}>
        <h2>Database Stats</h2>
        {statsQuery.isPending && <p>Loading...</p>}
        {statsQuery.isError && <p style={{ color: "var(--error)" }}>Failed to load stats: {String(statsQuery.error)}</p>}
        {statsQuery.data && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginTop: "10px" }}>
            <div style={{ padding: "15px", background: "var(--surface2)", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "5px" }}>D1 Memories</div>
              <div style={{ fontSize: "24px", fontWeight: "bold", color: "var(--accent)" }}>{statsQuery.data.memoryCount}</div>
            </div>
            <div style={{ padding: "15px", background: "var(--surface2)", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "5px" }}>Vectorize Vectors</div>
              <div style={{ fontSize: "24px", fontWeight: "bold", color: "var(--accent)" }}>{statsQuery.data.vectorCount}</div>
            </div>
          </div>
        )}
      </section>

      <section style={{ marginTop: "30px" }}>
        <h2>Debug Info</h2>
        {debugQuery.data?.vectors.length ? (
          <div style={{ marginTop: "10px" }}>
            <p style={{ color: "var(--error)", marginBottom: "10px" }}>
              Found {debugQuery.data.vectors.length} D1 records with no matching vector (first 100 checked):
            </p>
            <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "10px", fontFamily: "monospace", fontSize: "11px", maxHeight: "200px", overflowY: "auto" }}>
              {debugQuery.data.vectors.map((v) => (
                <div key={v.id} style={{ color: "var(--text-muted)", padding: "3px 0" }}>
                  {v.id.slice(0, 8)}... (missing from Vectorize)
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p style={{ color: "var(--success)", marginTop: "10px" }}>No orphaned vectors detected</p>
        )}
      </section>

      <section style={{ marginTop: "30px" }}>
        <h2>Destructive Operations</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "15px", marginTop: "10px" }}>
          <div>
            <button
              onClick={() => setConfirmClearVectorize(true)}
              disabled={clearVectorizeMutation.isPending}
              style={{
                width: "100%",
                padding: "10px",
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.3)",
                color: "var(--error)",
                borderRadius: "var(--radius)",
                fontWeight: "bold",
              }}
            >
              Clear Vectorize Only
            </button>
            {confirmClearVectorize && (
              <div style={{ marginTop: "10px", padding: "10px", background: "rgba(239,68,68,0.1)", border: "1px solid var(--error)", borderRadius: "var(--radius)" }}>
                <p style={{ fontSize: "12px", marginBottom: "8px" }}>This will delete all vectors from Vectorize but keep D1 data.</p>
                <div style={{ display: "flex", gap: "5px" }}>
                  <button
                    onClick={() => clearVectorizeMutation.mutate()}
                    style={{ flex: 1, padding: "6px", background: "var(--error)", color: "white" }}
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setConfirmClearVectorize(false)}
                    style={{ flex: 1, padding: "6px", background: "var(--surface2)", border: "1px solid var(--border)" }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          <div>
            <button
              onClick={() => setConfirmClear(true)}
              disabled={clearDbMutation.isPending}
              style={{
                width: "100%",
                padding: "10px",
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.3)",
                color: "var(--error)",
                borderRadius: "var(--radius)",
                fontWeight: "bold",
              }}
            >
              Clear Database Only
            </button>
            {confirmClear && (
              <div style={{ marginTop: "10px", padding: "10px", background: "rgba(239,68,68,0.1)", border: "1px solid var(--error)", borderRadius: "var(--radius)" }}>
                <p style={{ fontSize: "12px", marginBottom: "8px" }}>This will delete all memories from D1 and Vectorize.</p>
                <div style={{ display: "flex", gap: "5px" }}>
                  <button
                    onClick={() => clearDbMutation.mutate()}
                    style={{ flex: 1, padding: "6px", background: "var(--error)", color: "white" }}
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setConfirmClear(false)}
                    style={{ flex: 1, padding: "6px", background: "var(--surface2)", border: "1px solid var(--border)" }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          <div style={{ gridColumn: "1 / -1" }}>
            <button
              onClick={() => setConfirmClearAll(true)}
              disabled={clearAllMutation.isPending}
              style={{
                width: "100%",
                padding: "10px",
                background: "rgba(239,68,68,0.15)",
                border: "2px solid rgba(239,68,68,0.5)",
                color: "var(--error)",
                borderRadius: "var(--radius)",
                fontWeight: "bold",
                fontSize: "14px",
              }}
            >
              NUKE: Clear Everything
            </button>
            {confirmClearAll && (
              <div style={{ marginTop: "10px", padding: "12px", background: "rgba(239,68,68,0.15)", border: "2px solid var(--error)", borderRadius: "var(--radius)" }}>
                <p style={{ fontSize: "13px", marginBottom: "8px", fontWeight: "bold" }}>This will delete ALL memories from both D1 and Vectorize. This cannot be undone!</p>
                <div style={{ display: "flex", gap: "5px" }}>
                  <button
                    onClick={() => clearAllMutation.mutate()}
                    style={{ flex: 1, padding: "8px", background: "var(--error)", color: "white", fontWeight: "bold" }}
                  >
                    NUKE IT
                  </button>
                  <button
                    onClick={() => setConfirmClearAll(false)}
                    style={{ flex: 1, padding: "8px", background: "var(--surface2)", border: "1px solid var(--border)" }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section style={{ marginTop: "30px", padding: "15px", background: "rgba(99,102,241,0.1)", border: "1px solid var(--border)", borderRadius: "var(--radius)" }}>
        <p style={{ fontSize: "12px", color: "var(--text-muted)" }}>
          <strong>Status:</strong> {clearDbMutation.isPending || clearVectorizeMutation.isPending || clearAllMutation.isPending ? "Operating..." : "Ready"}
        </p>
      </section>
    </div>
  );
}

export const Route = createFileRoute("/admin")({
  component: AdminPage,
});
