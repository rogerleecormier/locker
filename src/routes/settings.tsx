import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  listApiTokens,
  createApiToken,
  revokeApiToken,
  updateApiTokenPermissions,
  type ApiTokenPublic,
} from "~/server/memoryFunctions";
import { MCP_PERM_RECALL, MCP_PERM_COMMIT } from "~/db/schema";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

const TOOL_DEFS = [
  { bit: MCP_PERM_RECALL, label: "recall_context", desc: "Semantic search — lets AI read your memories" },
  { bit: MCP_PERM_COMMIT, label: "commit_memory", desc: "Write access — lets AI store new memories" },
];

function permLabel(perms: number): string {
  const labels = TOOL_DEFS.filter((t) => perms & t.bit).map((t) => t.label);
  if (labels.length === 0) return "No permissions";
  return labels.join(", ");
}

function formatDate(ts: number | null): string {
  if (!ts) return "Never";
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function TokenRow({
  token,
  onRevoke,
  onUpdatePerms,
}: {
  token: ApiTokenPublic;
  onRevoke: (id: string) => void;
  onUpdatePerms: (id: string, perms: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [perms, setPerms] = useState(token.permissions);

  function toggleBit(bit: number) {
    const next = perms ^ bit;
    setPerms(next);
    onUpdatePerms(token.id, next);
  }

  return (
    <div style={styles.tokenCard}>
      <div style={styles.tokenHeader}>
        <div style={styles.tokenMeta}>
          <span style={styles.tokenName}>{token.name}</span>
          <span style={styles.tokenPerms}>{permLabel(token.permissions)}</span>
        </div>
        <div style={styles.tokenDates}>
          <span style={styles.dateLabel}>Created {formatDate(token.createdAt)}</span>
          {token.lastUsedAt && (
            <span style={styles.dateLabel}>· Last used {formatDate(token.lastUsedAt)}</span>
          )}
        </div>
        <div style={styles.tokenActions}>
          <button
            style={styles.btnGhost}
            onClick={() => setExpanded((x) => !x)}
          >
            {expanded ? "Collapse" : "Permissions"}
          </button>
          <button
            style={{ ...styles.btnGhost, color: "var(--error)", borderColor: "rgba(239,68,68,0.3)" }}
            onClick={() => onRevoke(token.id)}
          >
            Revoke
          </button>
        </div>
      </div>

      {expanded && (
        <div style={styles.permGrid}>
          {TOOL_DEFS.map((tool) => {
            const enabled = !!(perms & tool.bit);
            return (
              <label key={tool.bit} style={styles.permRow}>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={() => toggleBit(tool.bit)}
                  style={{ accentColor: "var(--accent)", width: 14, height: 14 }}
                />
                <div>
                  <div style={styles.permToolName}>{tool.label}</div>
                  <div style={styles.permToolDesc}>{tool.desc}</div>
                </div>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NewTokenModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, permissions: number) => Promise<string>;
}) {
  const [name, setName] = useState("");
  const [perms, setPerms] = useState(MCP_PERM_RECALL | MCP_PERM_COMMIT);
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function toggleBit(bit: number) {
    setPerms((p) => p ^ bit);
  }

  async function handleCreate() {
    if (!name.trim()) return;
    setLoading(true);
    try {
      const raw = await onCreate(name.trim(), perms);
      setToken(raw);
    } finally {
      setLoading(false);
    }
  }

  async function copyToken() {
    if (!token) return;
    await navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        {!token ? (
          <>
            <h2 style={styles.modalTitle}>New API Token</h2>
            <p style={styles.modalSubtitle}>
              Tokens are used to authenticate MCP requests. You can restrict which tools each token can use.
            </p>

            <div style={styles.field}>
              <label style={styles.label}>Token Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Claude Desktop"
                style={{ ...styles.input, width: "100%" }}
                autoFocus
              />
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Permissions</label>
              <div style={styles.permGrid}>
                {TOOL_DEFS.map((tool) => (
                  <label key={tool.bit} style={styles.permRow}>
                    <input
                      type="checkbox"
                      checked={!!(perms & tool.bit)}
                      onChange={() => toggleBit(tool.bit)}
                      style={{ accentColor: "var(--accent)", width: 14, height: 14 }}
                    />
                    <div>
                      <div style={styles.permToolName}>{tool.label}</div>
                      <div style={styles.permToolDesc}>{tool.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div style={styles.modalFooter}>
              <button style={styles.btnGhost} onClick={onClose}>Cancel</button>
              <button
                style={styles.btnPrimary}
                onClick={handleCreate}
                disabled={loading || !name.trim()}
              >
                {loading ? "Generating…" : "Generate token"}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 style={styles.modalTitle}>Token created</h2>
            <p style={styles.modalSubtitle}>
              Copy your token now — it won't be shown again.
            </p>

            <div style={styles.tokenReveal}>
              <code style={styles.tokenCode}>{token}</code>
              <button style={styles.copyBtn} onClick={copyToken}>
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>

            <div style={styles.tokenNote}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              Add this token to your MCP client's configuration as a Bearer token in the Authorization header.
            </div>

            <div style={styles.modalFooter}>
              <button style={styles.btnPrimary} onClick={onClose}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SettingsPage() {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [newTokenValue, setNewTokenValue] = useState<string | null>(null);

  const { data: tokens = [], isLoading } = useQuery({
    queryKey: ["api-tokens"],
    queryFn: () => listApiTokens(),
  });

  const createMut = useMutation({
    mutationFn: ({ name, permissions }: { name: string; permissions: number }) =>
      createApiToken({ data: { name, permissions } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-tokens"] }),
  });

  const revokeMut = useMutation({
    mutationFn: (id: string) => revokeApiToken({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-tokens"] }),
  });

  const permsMut = useMutation({
    mutationFn: ({ id, permissions }: { id: string; permissions: number }) =>
      updateApiTokenPermissions({ data: { id, permissions } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-tokens"] }),
  });

  async function handleCreate(name: string, permissions: number): Promise<string> {
    const result = await createMut.mutateAsync({ name, permissions });
    return result.token;
  }

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.headerRow}>
          <div>
            <h1 style={styles.title}>Settings</h1>
            <p style={styles.subtitle}>Manage API tokens for MCP access</p>
          </div>
          <button style={styles.btnPrimary} onClick={() => setShowModal(true)}>
            + New Token
          </button>
        </div>

        <section style={styles.section}>
          <div style={styles.sectionHeader}>
            <h2 style={styles.sectionTitle}>API Tokens</h2>
            <span style={styles.badge}>{tokens.length}</span>
          </div>

          <div style={styles.infoBox}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, marginTop: 1 }}>
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span>
              Use tokens to authenticate MCP calls from AI clients. Set{" "}
              <code style={styles.code}>Authorization: Bearer &lt;token&gt;</code>{" "}
              in your MCP client's headers.
            </span>
          </div>

          {isLoading ? (
            <p style={styles.empty}>Loading…</p>
          ) : tokens.length === 0 ? (
            <div style={styles.emptyState}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--border)" strokeWidth="1.5">
                <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              <p>No API tokens yet. Create one to connect your AI clients.</p>
            </div>
          ) : (
            <div style={styles.tokenList}>
              {tokens.map((t) => (
                <TokenRow
                  key={t.id}
                  token={t}
                  onRevoke={(id) => revokeMut.mutate(id)}
                  onUpdatePerms={(id, permissions) => permsMut.mutate({ id, permissions })}
                />
              ))}
            </div>
          )}
        </section>

        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>MCP Endpoint</h2>
          <p style={styles.sectionDesc}>
            Point your AI client's MCP configuration at:
          </p>
          <div style={styles.endpointBox}>
            <code style={styles.endpointCode}>{typeof window !== "undefined" ? window.location.origin : ""}/api/mcp</code>
          </div>
          <p style={{ ...styles.sectionDesc, marginTop: 8 }}>
            Authentication: <code style={styles.code}>Authorization: Bearer lkr_&lt;your-token&gt;</code>
          </p>
        </section>
      </div>

      {showModal && (
        <NewTokenModal
          onClose={() => { setShowModal(false); setNewTokenValue(null); }}
          onCreate={handleCreate}
        />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: "32px 24px", minHeight: "100vh" },
  container: { maxWidth: 720, margin: "0 auto" },
  headerRow: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 32 },
  title: { fontSize: 22, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.02em" },
  subtitle: { fontSize: 13, color: "var(--text-muted)", marginTop: 4 },

  section: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: "20px 22px",
    marginBottom: 20,
  },
  sectionHeader: { display: "flex", alignItems: "center", gap: 8, marginBottom: 14 },
  sectionTitle: { fontSize: 15, fontWeight: 600, color: "var(--text)" },
  sectionDesc: { fontSize: 13, color: "var(--text-muted)", marginBottom: 10 },
  badge: {
    fontSize: 11,
    fontWeight: 600,
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    borderRadius: 20,
    padding: "1px 8px",
    color: "var(--text-muted)",
  },

  infoBox: {
    display: "flex",
    gap: 8,
    alignItems: "flex-start",
    background: "rgba(99,102,241,0.07)",
    border: "1px solid rgba(99,102,241,0.2)",
    borderRadius: 7,
    padding: "9px 12px",
    fontSize: 12,
    color: "var(--text-muted)",
    marginBottom: 16,
  },
  code: {
    fontFamily: "monospace",
    fontSize: 11,
    background: "var(--surface2)",
    padding: "1px 5px",
    borderRadius: 4,
    color: "var(--accent)",
  },
  empty: { color: "var(--text-muted)", fontSize: 13 },
  emptyState: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 10,
    padding: "32px 0",
    color: "var(--text-muted)",
    fontSize: 13,
  },
  tokenList: { display: "flex", flexDirection: "column", gap: 8 },

  tokenCard: {
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "12px 14px",
  },
  tokenHeader: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  tokenMeta: { flex: 1, display: "flex", flexDirection: "column", gap: 2 },
  tokenName: { fontSize: 14, fontWeight: 600, color: "var(--text)" },
  tokenPerms: { fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" },
  tokenDates: { fontSize: 11, color: "var(--text-muted)" },
  dateLabel: { fontSize: 11, color: "var(--text-muted)" },
  tokenActions: { display: "flex", gap: 6 },

  permGrid: {
    marginTop: 12,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    paddingTop: 12,
    borderTop: "1px solid var(--border)",
  },
  permRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    cursor: "pointer",
  },
  permToolName: { fontSize: 12, fontWeight: 600, color: "var(--text)", fontFamily: "monospace" },
  permToolDesc: { fontSize: 11, color: "var(--text-muted)", marginTop: 1 },

  endpointBox: {
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    borderRadius: 7,
    padding: "10px 14px",
    fontFamily: "monospace",
    fontSize: 13,
    color: "var(--text)",
    marginBottom: 8,
  },
  endpointCode: { color: "var(--accent)" },

  btnPrimary: {
    padding: "8px 16px",
    background: "var(--accent)",
    color: "#fff",
    fontWeight: 600,
    fontSize: 13,
    borderRadius: 7,
    border: "none",
    cursor: "pointer",
  },
  btnGhost: {
    padding: "5px 10px",
    background: "transparent",
    border: "1px solid var(--border)",
    color: "var(--text-muted)",
    borderRadius: 6,
    fontSize: 12,
    cursor: "pointer",
  },

  // Modal
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    padding: 24,
  },
  modal: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 12,
    padding: "28px 28px 22px",
    width: "100%",
    maxWidth: 440,
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.02em" },
  modalSubtitle: { fontSize: 13, color: "var(--text-muted)", marginTop: -8 },
  modalFooter: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 },

  field: { display: "flex", flexDirection: "column", gap: 6 },
  label: { fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" },
  input: { padding: "8px 11px", borderRadius: 7 },

  tokenReveal: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "10px 12px",
  },
  tokenCode: {
    flex: 1,
    fontFamily: "monospace",
    fontSize: 12,
    color: "var(--accent)",
    wordBreak: "break-all",
  },
  copyBtn: {
    padding: "4px 10px",
    background: "var(--accent)",
    color: "#fff",
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 5,
    flexShrink: 0,
  },
  tokenNote: {
    display: "flex",
    gap: 8,
    alignItems: "flex-start",
    fontSize: 12,
    color: "var(--text-muted)",
    background: "rgba(99,102,241,0.07)",
    border: "1px solid rgba(99,102,241,0.2)",
    borderRadius: 7,
    padding: "9px 12px",
  },
};
