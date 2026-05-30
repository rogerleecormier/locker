import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import {
  listApiTokens,
  createApiToken,
  revokeApiToken,
  updateApiTokenPermissions,
  getProfile,
  saveProfile,
  getUserWorkspaces,
  type ApiTokenPublic,
} from "~/server/memoryFunctions";
import { MCP_PERM_RECALL, MCP_PERM_COMMIT, MCP_PERM_UPDATE, MCP_PERM_DELETE } from "~/db/schema";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

// ── constants ──────────────────────────────────────────────────────────────

export const TOOL_DEFS = [
  { bit: MCP_PERM_RECALL,  label: "recall_context", desc: "Semantic search — lets AI read your memories" },
  { bit: MCP_PERM_COMMIT,  label: "commit_memory",  desc: "Write access — lets AI store new memories" },
  { bit: MCP_PERM_UPDATE,  label: "update_memory",  desc: "Edit access — lets AI update existing memories" },
  { bit: MCP_PERM_DELETE,  label: "delete_memory",  desc: "Delete access — lets AI delete memories" },
];

function permLabel(perms: number): string {
  const labels = TOOL_DEFS.filter((t) => perms & t.bit).map((t) => t.label);
  return labels.length === 0 ? "No permissions" : labels.join(", ");
}

function formatDate(ts: number | null): string {
  if (!ts) return "Never";
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ── shared sub-components ──────────────────────────────────────────────────

function TokenRow({
  token,
  workspaces,
  onRevoke,
  onUpdatePerms,
}: {
  token: ApiTokenPublic;
  workspaces: any[];
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

  const scopeKey = token.scopeType === "personal" ? "personal" : `${token.scopeType === "organization" ? "org" : "team"}:${token.scopeId}`;
  const workspace = workspaces.find((w) => w.key === scopeKey);
  const scopeLabel = workspace ? workspace.label : (token.scopeType === "personal" ? "Personal" : `${token.scopeType} (${token.scopeId})`);

  return (
    <div style={s.tokenCard}>
      <div style={s.tokenHeader}>
        <div style={s.tokenMeta}>
          <span style={s.tokenName}>
            {token.name}
            <span style={{ fontSize: 10, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 6px", color: "var(--text-muted)", marginLeft: 8, fontWeight: 500, display: "inline-block", verticalAlign: "middle" }}>
              {scopeLabel}
            </span>
          </span>
          <span style={s.tokenPerms}>{permLabel(token.permissions)}</span>
        </div>
        <div style={s.tokenDates}>
          <span>Created {formatDate(token.createdAt)}</span>
          {token.lastUsedAt && <span> · Last used {formatDate(token.lastUsedAt)}</span>}
        </div>
        <div style={s.tokenActions}>
          <button style={s.btnGhost} onClick={() => setExpanded((x) => !x)}>
            {expanded ? "Collapse" : "Permissions"}
          </button>
          <button style={{ ...s.btnGhost, color: "var(--error)", borderColor: "rgba(239,68,68,0.3)" }} onClick={() => onRevoke(token.id)}>
            Revoke
          </button>
        </div>
      </div>
      {expanded && (
        <div style={s.permGrid}>
          {TOOL_DEFS.map((tool) => (
            <label key={tool.bit} style={s.permRow}>
              <input type="checkbox" checked={!!(perms & tool.bit)} onChange={() => toggleBit(tool.bit)} style={{ accentColor: "var(--accent)", width: 14, height: 14 }} />
              <div>
                <div style={s.permToolName}>{tool.label}</div>
                <div style={s.permToolDesc}>{tool.desc}</div>
              </div>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function NewTokenModal({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (name: string, permissions: number, scopeType: "personal" | "organization" | "team", scopeId?: string) => Promise<string>;
}) {
  const [name, setName] = useState("");
  const [perms, setPerms] = useState(MCP_PERM_RECALL | MCP_PERM_COMMIT | MCP_PERM_UPDATE | MCP_PERM_DELETE);
  const [scopeKey, setScopeKey] = useState("personal");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: workspaces = [] } = useQuery({ queryKey: ["workspaces"], queryFn: () => getUserWorkspaces() });

  async function handleCreate() {
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    const [scopeType, scopeId] = scopeKey === "personal"
      ? ["personal" as const, undefined]
      : scopeKey.split(":") as ["organization" | "team", string];
    try {
      setToken(await onCreate(name.trim(), perms, scopeType, scopeId));
    } catch (err: any) {
      setError(err.message || "Failed to generate token.");
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
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        {!token ? (
          <>
            <h2 style={s.modalTitle}>New API Token</h2>
            <p style={s.modalSubtitle}>Tokens authenticate MCP requests. Restrict which tools each token can call.</p>
            <div style={s.field}>
              <label style={s.label}>Token Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Claude Desktop" style={{ ...s.input, width: "100%" }} autoFocus />
            </div>
            <div style={s.field}>
              <label style={s.label}>Scope Constraint</label>
              <select value={scopeKey} onChange={(e) => setScopeKey(e.target.value)} style={s.input}>
                {workspaces.map((w: any) => <option key={w.key} value={w.key}>{w.label}</option>)}
              </select>
            </div>
            <div style={s.field}>
              <label style={s.label}>Permissions</label>
              <div style={s.permGrid}>
                {TOOL_DEFS.map((tool) => (
                  <label key={tool.bit} style={s.permRow}>
                    <input type="checkbox" checked={!!(perms & tool.bit)} onChange={() => setPerms((p) => p ^ tool.bit)} style={{ accentColor: "var(--accent)", width: 14, height: 14 }} />
                    <div>
                      <div style={s.permToolName}>{tool.label}</div>
                      <div style={s.permToolDesc}>{tool.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
            {error && <div style={{ color: "var(--error)", fontSize: 12, background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.2)", padding: "8px 10px", borderRadius: 6 }}>{error}</div>}
            <div style={s.modalFooter}>
              <button style={s.btnGhost} onClick={onClose}>Cancel</button>
              <button style={s.btnPrimary} onClick={handleCreate} disabled={loading || !name.trim()}>{loading ? "Generating…" : "Generate token"}</button>
            </div>
          </>
        ) : (
          <>
            <h2 style={s.modalTitle}>Token created</h2>
            <p style={s.modalSubtitle}>Copy your token now — it won't be shown again.</p>
            <div style={s.tokenReveal}>
              <code style={s.tokenCode}>{token}</code>
              <button style={s.copyBtn} onClick={copyToken}>{copied ? "Copied!" : "Copy"}</button>
            </div>
            <div style={s.tokenNote}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              Add this token to your MCP client as a Bearer token in the Authorization header.
            </div>
            <div style={s.modalFooter}>
              <button style={s.btnPrimary} onClick={onClose}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── exported section components ────────────────────────────────────────────

export function ProfileSection() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [savedMessage, setSavedMessage] = useState(false);

  const profileQuery = useQuery({ queryKey: ["profile"], queryFn: () => getProfile() });

  useEffect(() => {
    if (profileQuery.data) {
      setName(profileQuery.data.name);
      setLocation(profileQuery.data.location);
    }
  }, [profileQuery.data]);

  const saveMutation = useMutation({
    mutationFn: saveProfile,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profile"] });
      setSavedMessage(true);
      setTimeout(() => setSavedMessage(false), 5000);
    },
  });

  return (
    <div style={s.card}>
      <h2 style={s.cardTitle}>Profile</h2>
      <p style={s.cardDesc}>Used to personalise how memories are phrased during import.</p>
      {profileQuery.isPending ? (
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading…</p>
      ) : profileQuery.isError ? (
        <p style={{ color: "var(--error)", fontSize: 13 }}>Failed to load profile.</p>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); saveMutation.mutate({ data: { name, location } }); }} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div style={s.field}>
              <label style={s.label}>Preferred Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Roger" style={s.input} />
            </div>
            <div style={s.field}>
              <label style={s.label}>Location</label>
              <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Florida" style={s.input} />
            </div>
          </div>
          {savedMessage && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: "var(--radius)", color: "var(--success)", fontSize: 13 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
              Profile saved.
            </div>
          )}
          {saveMutation.isError && <p style={{ color: "var(--error)", fontSize: 13 }}>Failed to save: {(saveMutation.error as Error).message}</p>}
          <div>
            <button type="submit" disabled={saveMutation.isPending} style={s.btnPrimary}>{saveMutation.isPending ? "Saving…" : "Save Profile"}</button>
          </div>
        </form>
      )}
    </div>
  );
}

export function ApiTokensSection() {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);

  const { data: tokens = [], isLoading } = useQuery({ queryKey: ["api-tokens"], queryFn: () => listApiTokens() });
  const { data: workspaces = [] } = useQuery({ queryKey: ["workspaces"], queryFn: () => getUserWorkspaces() });

  const createMut = useMutation({
    mutationFn: ({ name, permissions, scopeType, scopeId }: { name: string; permissions: number; scopeType: "personal" | "organization" | "team"; scopeId?: string }) =>
      createApiToken({ data: { name, permissions, scopeType, scopeId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-tokens"] }),
  });
  const revokeMut = useMutation({
    mutationFn: (id: string) => revokeApiToken({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-tokens"] }),
  });
  const permsMut = useMutation({
    mutationFn: ({ id, permissions }: { id: string; permissions: number }) => updateApiTokenPermissions({ data: { id, permissions } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-tokens"] }),
  });

  async function handleCreate(name: string, permissions: number, scopeType: "personal" | "organization" | "team", scopeId?: string): Promise<string> {
    const result = await createMut.mutateAsync({ name, permissions, scopeType, scopeId });
    return result.token;
  }

  return (
    <>
      <div style={s.card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <h2 style={{ ...s.cardTitle, margin: 0 }}>API Tokens</h2>
            <span style={s.badge}>{tokens.length}</span>
          </div>
          <button style={s.btnPrimary} onClick={() => setShowModal(true)}>+ New Token</button>
        </div>
        <p style={s.cardDesc}>Authenticate MCP calls from AI clients using Bearer tokens.</p>

        <div style={s.infoBox}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span>Set <code style={s.code}>Authorization: Bearer &lt;token&gt;</code> in your client's headers.</span>
        </div>

        {isLoading ? (
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading…</p>
        ) : tokens.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "28px 0", color: "var(--text-muted)", fontSize: 13 }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--border)" strokeWidth="1.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            <p style={{ margin: 0 }}>No API tokens yet. Create one to connect your AI clients.</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
            {tokens.map((t) => (
              <TokenRow key={t.id} token={t} workspaces={workspaces} onRevoke={(id) => revokeMut.mutate(id)} onUpdatePerms={(id, permissions) => permsMut.mutate({ id, permissions })} />
            ))}
          </div>
        )}
      </div>

      {showModal && <NewTokenModal onClose={() => setShowModal(false)} onCreate={handleCreate} />}
    </>
  );
}

export function McpEndpointSection() {
  return (
    <div style={s.card}>
      <h2 style={s.cardTitle}>MCP Endpoint</h2>
      <p style={s.cardDesc}>Point your AI client's MCP configuration at:</p>
      <div style={s.endpointBox}>
        <code style={s.endpointCode}>{typeof window !== "undefined" ? window.location.origin : ""}/api/mcp</code>
      </div>
      <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 8 }}>
        Authentication: <code style={s.code}>Authorization: Bearer lkr_&lt;your-token&gt;</code>
      </p>
    </div>
  );
}

// ── standalone /settings page ──────────────────────────────────────────────

function SettingsPage() {
  const [tab, setTab] = useState<"profile" | "tokens" | "mcp">("profile");

  const tabs = [
    { id: "profile" as const, label: "Profile" },
    { id: "tokens" as const, label: "API Tokens" },
    { id: "mcp" as const, label: "MCP Endpoint" },
  ];

  return (
    <div>
      <div style={{ background: "var(--surface2)", borderBottom: "1px solid var(--border)", padding: "20px 24px" }}>
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.02em", margin: 0 }}>Settings</h1>
          </div>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>Profile, API tokens, and MCP endpoint</p>
        </div>
      </div>

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "28px 24px" }}>
        <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)", marginBottom: 24 }}>
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: "8px 16px",
                background: "transparent",
                border: "none",
                borderBottom: tab === t.id ? "2px solid var(--accent)" : "2px solid transparent",
                color: tab === t.id ? "var(--accent)" : "var(--text-muted)",
                fontWeight: tab === t.id ? 600 : 400,
                fontSize: 14,
                cursor: "pointer",
                marginBottom: -1,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "profile" && <ProfileSection />}
        {tab === "tokens" && <ApiTokensSection />}
        {tab === "mcp" && <McpEndpointSection />}
      </div>
    </div>
  );
}

// ── styles ─────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  card: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: "20px 22px",
    marginBottom: 20,
  },
  cardTitle: { fontSize: 15, fontWeight: 600, color: "var(--text)", marginBottom: 6 },
  cardDesc: { fontSize: 13, color: "var(--text-muted)", marginBottom: 14 },
  badge: {
    fontSize: 11, fontWeight: 600, background: "var(--surface2)", border: "1px solid var(--border)",
    borderRadius: 20, padding: "1px 8px", color: "var(--text-muted)",
  },
  infoBox: {
    display: "flex", gap: 8, alignItems: "flex-start",
    background: "rgba(168,85,247,0.07)", border: "1px solid rgba(168,85,247,0.2)",
    borderRadius: 7, padding: "9px 12px", fontSize: 12, color: "var(--text-muted)", marginBottom: 16,
  },
  code: { fontFamily: "monospace", fontSize: 11, background: "var(--surface2)", padding: "1px 5px", borderRadius: 4, color: "var(--accent)" },
  endpointBox: {
    background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 7,
    padding: "10px 14px", fontFamily: "monospace", fontSize: 13, color: "var(--text)", marginBottom: 8,
  },
  endpointCode: { color: "var(--accent)" },
  tokenCard: { background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px" },
  tokenHeader: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" },
  tokenMeta: { flex: 1, display: "flex", flexDirection: "column", gap: 2 },
  tokenName: { fontSize: 14, fontWeight: 600, color: "var(--text)" },
  tokenPerms: { fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" },
  tokenDates: { fontSize: 11, color: "var(--text-muted)" },
  tokenActions: { display: "flex", gap: 6 },
  permGrid: { marginTop: 12, display: "flex", flexDirection: "column", gap: 8, paddingTop: 12, borderTop: "1px solid var(--border)" },
  permRow: { display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" },
  permToolName: { fontSize: 12, fontWeight: 600, color: "var(--text)", fontFamily: "monospace" },
  permToolDesc: { fontSize: 11, color: "var(--text-muted)", marginTop: 1 },
  field: { display: "flex", flexDirection: "column", gap: 6 },
  label: { fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" },
  input: { padding: "8px 11px", borderRadius: 7, width: "100%" },
  btnPrimary: { padding: "8px 16px", background: "var(--accent)", color: "#fff", fontWeight: 600, fontSize: 13, borderRadius: 7, border: "none", cursor: "pointer" },
  btnGhost: { padding: "5px 10px", background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)", borderRadius: 6, fontSize: 12, cursor: "pointer" },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 24 },
  modal: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "28px 28px 22px", width: "100%", maxWidth: 440, display: "flex", flexDirection: "column", gap: 16 },
  modalTitle: { fontSize: 18, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.02em" },
  modalSubtitle: { fontSize: 13, color: "var(--text-muted)", marginTop: -8 },
  modalFooter: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 },
  tokenReveal: { display: "flex", alignItems: "center", gap: 8, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px" },
  tokenCode: { flex: 1, fontFamily: "monospace", fontSize: 12, color: "var(--accent)", wordBreak: "break-all" },
  copyBtn: { padding: "4px 10px", background: "var(--accent)", color: "#fff", fontSize: 12, fontWeight: 600, borderRadius: 5, flexShrink: 0, border: "none", cursor: "pointer" },
  tokenNote: { display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, color: "var(--text-muted)", background: "rgba(168,85,247,0.07)", border: "1px solid rgba(168,85,247,0.2)", borderRadius: 7, padding: "9px 12px" },
};
