import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "~/components/ui/toast";
import { getDbStats, getVectorizeDebug, clearDatabase, clearVectorizeIndex } from "~/routes/admin";
import { nukeEverything, scanDatabaseDuplicates, bulkDeleteMemories, migrateToV2, type MigrateV2Result, rebuildVectorizeIndex, type DuplicateGroup, repairMergeKeyMismatch, type RepairMergeKeysResult } from "~/server/memoryFunctions";
import { SiteAdminSection, AdminCard, StatBox } from "~/components/AdminSections";

export function AdminDbTools() {
  const toast = useToast();
  const qc = useQueryClient();

  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmClearVectorize, setConfirmClearVectorize] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [scanResults, setScanResults] = useState<DuplicateGroup[] | null>(null);
  const [retainSelections, setRetainSelections] = useState<Record<number, string>>({});
  const [migrateResult, setMigrateResult] = useState<MigrateV2Result | null>(null);
  const [repairMergeResult, setRepairMergeResult] = useState<RepairMergeKeysResult | null>(null);
  const [rebuildResult, setRebuildResult] = useState<{ processed: number; failed: number } | null>(null);

  const statsQuery = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => getDbStats(),
    refetchInterval: 5000,
  });

  const debugQuery = useQuery({
    queryKey: ["admin-debug"],
    queryFn: () => getVectorizeDebug(),
    refetchInterval: 10000,
  });

  const refetchAll = () => {
    qc.invalidateQueries({ queryKey: ["admin-stats"] });
    qc.invalidateQueries({ queryKey: ["admin-debug"] });
  };

  const clearDbMutation = useMutation({
    mutationFn: clearDatabase,
    onSuccess: () => { setConfirmClear(false); refetchAll(); },
  });

  const clearVectorizeMutation = useMutation({
    mutationFn: clearVectorizeIndex,
    onSuccess: () => { setConfirmClearVectorize(false); refetchAll(); },
  });

  const clearAllMutation = useMutation({
    mutationFn: nukeEverything,
    onSuccess: () => { setConfirmClearAll(false); refetchAll(); },
  });

  const rebuildMutation = useMutation({
    mutationFn: () => rebuildVectorizeIndex({}),
    onSuccess: (data) => { setRebuildResult(data); refetchAll(); },
  });

  const scanMutation = useMutation({
    mutationFn: scanDatabaseDuplicates,
    onSuccess: (data) => {
      setScanResults(data.groups);
      const defaults: Record<number, string> = {};
      data.groups.forEach((g, idx) => { defaults[idx] = g.primary.id; });
      setRetainSelections(defaults);
    },
  });

  const resolveMutation = useMutation({
    mutationFn: async () => {
      if (!scanResults) return;
      const idsToDelete: string[] = [];
      scanResults.forEach((group, idx) => {
        const retainedId = retainSelections[idx] || group.primary.id;
        [group.primary, ...group.duplicates].forEach((item) => {
          if (item.id !== retainedId) idsToDelete.push(item.id);
        });
      });
      if (idsToDelete.length > 0) await bulkDeleteMemories({ data: { ids: idsToDelete } });
    },
    onSuccess: () => {
      setScanResults(null);
      setRetainSelections({});
      refetchAll();
      toast.success("Successfully resolved duplicates!");
    },
  });

  const migrateMutation = useMutation({
    mutationFn: () => migrateToV2({}),
    onSuccess: (data) => setMigrateResult(data),
    onError: (err) => toast.error("Migration failed: " + String(err)),
  });

  const repairMergeMutation = useMutation({
    mutationFn: () => repairMergeKeyMismatch({}),
    onSuccess: (data) => { setRepairMergeResult(data); qc.invalidateQueries({ queryKey: ["memories"] }); },
    onError: (err) => toast.error("Repair failed: " + String(err)),
  });

  const anyDestructivePending = clearDbMutation.isPending || clearVectorizeMutation.isPending || clearAllMutation.isPending;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      <SiteAdminSection title="Database Stats" description="Real-time storage metrics" icon="📊">
        {statsQuery.isPending && <p>Loading...</p>}
        {statsQuery.isError && <p style={{ color: "var(--error)" }}>Failed to load stats: {String(statsQuery.error)}</p>}
        {statsQuery.data && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
            <StatBox label="D1 Memories" value={statsQuery.data.memoryCount} />
            <StatBox label="Vectorize Vectors" value={statsQuery.data.vectorCount} />
          </div>
        )}
      </SiteAdminSection>

      <SiteAdminSection title="Vector Index Health" description="Orphaned vector detection" icon="🔍">
        {debugQuery.data?.vectors?.length ? (
          <AdminCard status="error">
            <p style={{ color: "var(--error)", marginBottom: "10px" }}>
              Found {debugQuery.data.vectors.length} D1 records with no matching vector (first 100 checked):
            </p>
            <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "10px", fontFamily: "monospace", fontSize: "11px", maxHeight: "200px", overflowY: "auto" }}>
              {debugQuery.data.vectors.map((v) => (
                <div key={v.id} style={{ color: "var(--text-muted)", padding: "3px 0" }}>{v.id.slice(0, 8)}... (missing from Vectorize)</div>
              ))}
            </div>
          </AdminCard>
        ) : (
          <AdminCard status="success">
            <p style={{ margin: 0, fontWeight: 600, color: "var(--success)" }}>✓ No orphaned vectors detected</p>
          </AdminCard>
        )}
      </SiteAdminSection>

      <SiteAdminSection title="Database Deduplication Scanner" description="Find and resolve semantic duplicate memories" icon="🔎">
        <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "15px" }}>
          Scan all stored memories for semantic duplicates. Locker will identify identical facts with different phrasings and let you choose which to retain.
        </p>
        {!scanResults ? (
          <button onClick={() => scanMutation.mutate({})} disabled={scanMutation.isPending}
            style={{ padding: "10px 20px", background: "var(--accent)", color: "white", border: "none", borderRadius: "var(--radius)", fontWeight: "bold", cursor: "pointer" }}>
            {scanMutation.isPending ? "Scanning & Analyzing Database..." : "Scan for Duplicates"}
          </button>
        ) : (
          <div>
            <div style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
              <button onClick={() => scanMutation.mutate({})} disabled={scanMutation.isPending || resolveMutation.isPending}
                style={{ padding: "8px 16px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: "var(--radius)", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>
                {scanMutation.isPending ? "Scanning..." : "Rescan"}
              </button>
              <button onClick={() => setScanResults(null)} disabled={scanMutation.isPending || resolveMutation.isPending}
                style={{ padding: "8px 16px", background: "transparent", border: "1px solid transparent", color: "var(--text-muted)", borderRadius: "var(--radius)", fontSize: "13px", cursor: "pointer" }}>
                Clear Results
              </button>
            </div>
            {scanResults.length === 0 ? (
              <AdminCard status="success">
                <p style={{ margin: 0 }}>🎉 No duplicate memories found in your database!</p>
              </AdminCard>
            ) : (
              <div>
                <p style={{ marginBottom: "15px", fontSize: "13px", color: "var(--text-muted)" }}>
                  Found {scanResults.length} duplicate group{scanResults.length !== 1 ? "s" : ""}. Choose which memory to retain:
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                  {scanResults.map((group, groupIdx) => {
                    const allItems = [group.primary, ...group.duplicates];
                    const selectedId = retainSelections[groupIdx] || group.primary.id;
                    return (
                      <div key={groupIdx} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "15px" }}>
                        <div style={{ fontSize: "12px", fontWeight: "bold", color: "var(--accent)", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                          Group {groupIdx + 1}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                          {allItems.map((item) => (
                            <label key={item.id} style={{
                              display: "flex", alignItems: "start", gap: "10px", padding: "10px",
                              background: selectedId === item.id ? "rgba(168,85,247,0.06)" : "var(--surface)",
                              border: `1px solid ${selectedId === item.id ? "var(--accent)" : "var(--border)"}`,
                              borderRadius: "var(--radius)", cursor: "pointer", transition: "all 0.15s ease",
                            }}>
                              <input type="radio" name={`group-${groupIdx}`} checked={selectedId === item.id}
                                onChange={() => setRetainSelections((prev) => ({ ...prev, [groupIdx]: item.id }))}
                                style={{ marginTop: "3px", accentColor: "var(--accent)" }} />
                              <div style={{ flex: 1, fontSize: "13px", lineHeight: "1.5" }}>
                                <p style={{ margin: 0, color: "var(--text)" }}>{item.fact}</p>
                                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "6px" }}>
                                  <span style={{ fontSize: "10px", background: "var(--surface2)", color: "var(--text-muted)", padding: "2px 6px", borderRadius: "4px", textTransform: "uppercase" }}>
                                    {item.category}
                                  </span>
                                  <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                                    Added {new Date(item.timestamp).toLocaleDateString()}
                                  </span>
                                </div>
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ marginTop: "20px" }}>
                  <button onClick={() => resolveMutation.mutate()} disabled={resolveMutation.isPending}
                    style={{ padding: "10px 24px", background: "var(--error)", color: "white", border: "none", borderRadius: "var(--radius)", fontWeight: "bold", cursor: "pointer", boxShadow: "0 4px 12px rgba(239,68,68,0.2)" }}>
                    {resolveMutation.isPending ? "Resolving Duplicates..." : "Resolve & Delete Duplicates"}
                  </button>
                  {resolveMutation.isError && <p style={{ color: "var(--error)", fontSize: "13px", marginTop: "8px" }}>Failed to resolve duplicates. Please try again.</p>}
                </div>
              </div>
            )}
          </div>
        )}
      </SiteAdminSection>

      <SiteAdminSection title="Vector Index Management" description="Rebuild Vectorize from D1" icon="⚡">
        <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "15px" }}>
          Rebuild the Vectorize index by generating embeddings for all database memories. Use this if the Vectorize index was migrated or is out of sync with D1.
        </p>
        {rebuildResult && (
          <AdminCard status="success">
            <p style={{ margin: 0 }}>Done — processed {rebuildResult.processed} memories{rebuildResult.failed > 0 ? `, ${rebuildResult.failed} failed` : ""}.</p>
          </AdminCard>
        )}
        <button onClick={() => { setRebuildResult(null); rebuildMutation.mutate(); }} disabled={rebuildMutation.isPending}
          style={{ padding: "9px 20px", background: "var(--accent)", color: "white", border: "none", borderRadius: "var(--radius)", fontWeight: "bold", cursor: "pointer", marginTop: rebuildResult ? "12px" : 0 }}>
          {rebuildMutation.isPending ? "Rebuilding Index…" : "Rebuild Vector Index"}
        </button>
        {rebuildMutation.isError && <p style={{ color: "var(--error)", fontSize: "13px", marginTop: "8px" }}>Index rebuild failed. Check logs.</p>}
      </SiteAdminSection>

      <SiteAdminSection title="Security Architecture Migration" description="Migrate all data to v2 envelope encryption and PBKDF2 token hashing" icon="🔒">
        <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "8px" }}>
          Migrates all vault data to the v2 security architecture in one pass:
        </p>
        <ul style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "15px", paddingLeft: "18px", lineHeight: "1.8" }}>
          <li><strong>Memories</strong> — re-encrypts any data still under the legacy HKDF-derived key to the per-vault DEK.</li>
          <li><strong>TOTP secrets</strong> — re-encrypts under the per-user DEK.</li>
          <li><strong>Credentials</strong> — re-encrypts under the per-vault DEK.</li>
          <li><strong>API tokens</strong> — invalidates any tokens still hashed with SHA-256. Affected users must regenerate their tokens.</li>
        </ul>
        <div style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: "8px", padding: "10px 14px", marginBottom: "15px", fontSize: "12px", color: "#f59e0b" }}>
          ⚠️ Run this once after deploying the v2 update to production. Safe to re-run — already-migrated records are skipped. Legacy API tokens will be deleted and cannot be recovered.
        </div>
        {migrateResult && (
          <AdminCard status={migrateResult.memories.failed > 0 || migrateResult.totp.failed > 0 || migrateResult.credentials.failed > 0 ? "warning" : "success"}>
            <p style={{ margin: "0 0 6px 0", fontWeight: 600 }}>Migration complete</p>
            <ul style={{ margin: 0, paddingLeft: "16px", fontSize: "12px", lineHeight: "1.8" }}>
              <li>Memories: {migrateResult.memories.migrated} migrated, {migrateResult.memories.skipped} already up to date{migrateResult.memories.failed > 0 ? `, ${migrateResult.memories.failed} failed` : ""}</li>
              <li>TOTP secrets: {migrateResult.totp.migrated} migrated, {migrateResult.totp.skipped} already up to date{migrateResult.totp.failed > 0 ? `, ${migrateResult.totp.failed} failed` : ""}</li>
              <li>Credentials: {migrateResult.credentials.migrated} migrated, {migrateResult.credentials.skipped} already up to date{migrateResult.credentials.failed > 0 ? `, ${migrateResult.credentials.failed} failed` : ""}</li>
              <li>Legacy API tokens invalidated: {migrateResult.tokens.invalidated}</li>
            </ul>
          </AdminCard>
        )}
        <button onClick={() => { setMigrateResult(null); migrateMutation.mutate(); }} disabled={migrateMutation.isPending}
          style={{ padding: "9px 20px", background: "var(--accent)", color: "white", border: "none", borderRadius: "var(--radius)", fontWeight: "bold", cursor: "pointer", marginTop: migrateResult ? "12px" : 0 }}>
          {migrateMutation.isPending ? "Migrating…" : "Run v2 Security Migration"}
        </button>
        {migrateMutation.isError && <p style={{ color: "var(--error)", fontSize: "13px", marginTop: "8px" }}>Migration failed. Check server logs for details.</p>}
      </SiteAdminSection>

      <SiteAdminSection title="Merge Encryption Key Repair" description="Fix memories merged under a mis-keyed vault DEK" icon="🩹">
        <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "8px" }}>
          The merge-duplicates action previously encrypted merged memories under an incorrectly
          keyed vault DEK, making them undecryptable through normal reads. This scans every
          memory, finds any encrypted under the wrong key, and re-encrypts them under the
          correct one.
        </p>
        <div style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: "8px", padding: "10px 14px", marginBottom: "15px", fontSize: "12px", color: "#f59e0b" }}>
          ⚠️ Safe to re-run — already-correct records are skipped. Run this once after deploying the mergeMemories fix.
        </div>
        {repairMergeResult && (
          <AdminCard status={repairMergeResult.failed > 0 ? "warning" : "success"}>
            <p style={{ margin: "0 0 6px 0", fontWeight: 600 }}>Repair complete</p>
            <ul style={{ margin: 0, paddingLeft: "16px", fontSize: "12px", lineHeight: "1.8" }}>
              <li>Repaired: {repairMergeResult.repaired}</li>
              <li>Already correct / unencrypted: {repairMergeResult.skipped}</li>
              {repairMergeResult.failed > 0 && <li>Failed: {repairMergeResult.failed}</li>}
            </ul>
          </AdminCard>
        )}
        <button onClick={() => { setRepairMergeResult(null); repairMergeMutation.mutate(); }} disabled={repairMergeMutation.isPending}
          style={{ padding: "9px 20px", background: "var(--accent)", color: "white", border: "none", borderRadius: "var(--radius)", fontWeight: "bold", cursor: "pointer", marginTop: repairMergeResult ? "12px" : 0 }}>
          {repairMergeMutation.isPending ? "Repairing…" : "Run Merge Key Repair"}
        </button>
        {repairMergeMutation.isError && <p style={{ color: "var(--error)", fontSize: "13px", marginTop: "8px" }}>Repair failed. Check server logs for details.</p>}
      </SiteAdminSection>

      <SiteAdminSection title="Destructive Operations" description="Irreversible data deletion" icon="⚠️">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "15px" }}>
          <div>
            <button onClick={() => setConfirmClearVectorize(true)} disabled={clearVectorizeMutation.isPending}
              style={{ width: "100%", padding: "10px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "var(--error)", borderRadius: "var(--radius)", fontWeight: "bold", cursor: "pointer" }}>
              Clear Vectorize Only
            </button>
            {confirmClearVectorize && (
              <AdminCard status="warning">
                <p style={{ fontSize: "12px", marginBottom: "8px" }}>This will delete all vectors from Vectorize but keep D1 data.</p>
                <div style={{ display: "flex", gap: "5px" }}>
                  <button onClick={() => clearVectorizeMutation.mutate({})} style={{ flex: 1, padding: "6px", background: "var(--error)", color: "white" }}>Confirm</button>
                  <button onClick={() => setConfirmClearVectorize(false)} style={{ flex: 1, padding: "6px", background: "var(--surface2)", border: "1px solid var(--border)" }}>Cancel</button>
                </div>
              </AdminCard>
            )}
          </div>
          <div>
            <button onClick={() => setConfirmClear(true)} disabled={clearDbMutation.isPending}
              style={{ width: "100%", padding: "10px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "var(--error)", borderRadius: "var(--radius)", fontWeight: "bold", cursor: "pointer" }}>
              Clear Database Only
            </button>
            {confirmClear && (
              <AdminCard status="warning">
                <p style={{ fontSize: "12px", marginBottom: "8px" }}>This will delete all memories from D1 and Vectorize.</p>
                <div style={{ display: "flex", gap: "5px" }}>
                  <button onClick={() => clearDbMutation.mutate({})} style={{ flex: 1, padding: "6px", background: "var(--error)", color: "white" }}>Confirm</button>
                  <button onClick={() => setConfirmClear(false)} style={{ flex: 1, padding: "6px", background: "var(--surface2)", border: "1px solid var(--border)" }}>Cancel</button>
                </div>
              </AdminCard>
            )}
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <button onClick={() => setConfirmClearAll(true)} disabled={clearAllMutation.isPending}
              style={{ width: "100%", padding: "10px", background: "rgba(239,68,68,0.15)", border: "2px solid rgba(239,68,68,0.5)", color: "var(--error)", borderRadius: "var(--radius)", fontWeight: "bold", fontSize: "14px", cursor: "pointer" }}>
              🔥 NUKE: Clear Everything
            </button>
            {confirmClearAll && (
              <AdminCard status="error">
                <p style={{ fontSize: "13px", marginBottom: "8px", fontWeight: "bold" }}>This will delete ALL memories from both D1 and Vectorize. This cannot be undone!</p>
                <div style={{ display: "flex", gap: "5px" }}>
                  <button onClick={() => clearAllMutation.mutate({})} style={{ flex: 1, padding: "8px", background: "var(--error)", color: "white", fontWeight: "bold" }}>NUKE IT</button>
                  <button onClick={() => setConfirmClearAll(false)} style={{ flex: 1, padding: "8px", background: "var(--surface2)", border: "1px solid var(--border)" }}>Cancel</button>
                </div>
              </AdminCard>
            )}
          </div>
        </div>
        <div style={{ marginTop: "16px", padding: "10px 14px", background: "rgba(168,85,247,0.08)", border: "1px solid var(--border)", borderRadius: "var(--radius)" }}>
          <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0 }}>
            <strong>Status:</strong> {anyDestructivePending ? "Operating..." : "Ready"}
          </p>
        </div>
      </SiteAdminSection>

    </div>
  );
}
