import { createFileRoute } from "@tanstack/react-router";
import { InfoTooltip } from "~/components/InfoTooltip";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { getTOTPStatus, setupTOTP, disableTOTP, verifyAndSaveTOTP } from "~/server/totp";
import {
  listApiTokens,
  createApiToken,
  revokeApiToken,
  updateApiTokenPermissions,
  renewApiToken,
  getProfile,
  saveProfile,
  getUserWorkspaces,
  setDeletionPasscode,
  removeDeletionPasscode,
  getPasscodeStatus,
  type ApiTokenPublic,
} from "~/server/memoryFunctions";
import { MCP_PERM_RECALL, MCP_PERM_COMMIT, MCP_PERM_UPDATE, MCP_PERM_DELETE } from "~/db/schema";
import { PageContainer } from "~/components/PageContainer";
import { PageHeader } from "~/components/PageHeader";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Label, Input, Select } from "~/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "~/components/ui/dialog";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

// ── constants ──────────────────────────────────────────────────────────────

export const TOOL_DEFS = [
  { bit: MCP_PERM_RECALL, label: "recall_context", desc: "Semantic search — lets AI read your memories" },
  { bit: MCP_PERM_COMMIT, label: "commit_memory", desc: "Write access — lets AI store new memories" },
  { bit: MCP_PERM_UPDATE, label: "update_memory", desc: "Edit access — lets AI update existing memories" },
  { bit: MCP_PERM_DELETE, label: "delete_memory", desc: "Delete access — lets AI delete memories" },
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
  const [renewTtl, setRenewTtl] = useState<number | null>(null);
  const [renewing, setRenewing] = useState(false);

  const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;
  const isExpiringSoon = token.expiresAt ? (token.expiresAt - Date.now()) < TWO_WEEKS_MS : false;
  const daysUntilExpiry = token.expiresAt ? Math.ceil((token.expiresAt - Date.now()) / (24 * 60 * 60 * 1000)) : null;

  function toggleBit(bit: number) {
    const next = perms ^ bit;
    setPerms(next);
    onUpdatePerms(token.id, next);
  }

  let scopeBadges: Array<{ type: string; name: string; id: string | null }> = [];
  if (token.scopes) {
    try {
      const parsedScopes = JSON.parse(token.scopes) as Array<{ type: string; id: string | null }>;
      scopeBadges = parsedScopes.map((s) => {
        const key = s.type === "personal" ? "personal" : `${s.type === "organization" ? "org" : "team"}:${s.id}`;
        const w = workspaces.find((work: any) => work.key === key);
        const name = w ? w.label.replace(/\s*\(Org\)|\s*\(Team\)/i, "") : (s.type === "personal" ? "Personal" : `${s.type} (${s.id})`);
        return { type: s.type, name, id: s.id };
      });
    } catch {
      scopeBadges = [{ type: "legacy", name: "Legacy Scope", id: null }];
    }
  } else {
    const scopeKey = token.scopeType === "personal" ? "personal" : `${token.scopeType === "organization" ? "org" : "team"}:${token.scopeId}`;
    const workspace = workspaces.find((w) => w.key === scopeKey);
    const name = workspace ? workspace.label : (token.scopeType === "personal" ? "Personal" : `${token.scopeType} (${token.scopeId})`);
    scopeBadges = [{ type: token.scopeType, name, id: token.scopeId || null }];
  }

  return (
    <div className="bg-surface2 border border-border rounded-xl p-4 flex flex-col gap-3 shadow-2xs">
      {/* Top Row: Name, Expiring Warning, Actions */}
      <div className="flex justify-between items-center gap-4 flex-wrap select-none">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm md:text-base text-text">{token.name}</span>
          {token.tokenType === "agent" && (
            <Badge className="h-5 px-2 text-[9px] font-semibold border-amber-500/30 bg-amber-500/10 text-amber-400 normal-case tracking-normal">
              Agent
            </Badge>
          )}
          {isExpiringSoon && daysUntilExpiry !== null && (
            <Badge variant="error" className="h-5 px-2 text-[9px] font-semibold border-amber-500/30 bg-amber-500/10 text-amber-400 normal-case tracking-normal">
              Expires in {daysUntilExpiry} day{daysUntilExpiry !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setExpanded((x) => !x)}>
            {expanded ? "Hide Details" : "Permissions"}
          </Button>
          {token.expiresAt && (
            renewTtl === null ? (
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setRenewTtl(30)}>
                Renew
              </Button>
            ) : (
              <div className="flex gap-1.5 items-center">
                <Select
                  value={renewTtl}
                  onChange={(e) => setRenewTtl(parseInt(e.target.value))}
                  className="h-7 text-xs px-2 min-w-[85px] cursor-pointer"
                >
                  <option value={7}>7 days</option>
                  <option value={30}>30 days</option>
                  <option value={90}>90 days</option>
                  <option value={365}>1 year</option>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    if (renewTtl !== null) {
                      setRenewing(true);
                      renewApiToken({ data: { id: token.id, ttlDays: renewTtl } })
                        .then(() => {
                          location.reload();
                          setRenewTtl(null);
                        })
                        .catch((err) => {
                          alert("Failed to renew token: " + (err.message || "Unknown error"));
                          setRenewTtl(null);
                        })
                        .finally(() => setRenewing(false));
                    }
                  }}
                  disabled={renewing}
                >
                  {renewing ? "Renewing..." : "Renew"}
                </Button>
              </div>
            )
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-error hover:text-error hover:bg-error/5 hover:border-error/25"
            onClick={() => onRevoke(token.id)}
          >
            Revoke
          </Button>
        </div>
      </div>

      {/* Middle Row: Scopes & Allowed Tools/Permissions */}
      <div className="flex flex-col gap-2.5">
        {/* Scopes Badges */}
        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-[11px] text-text-muted font-bold uppercase tracking-wider w-[80px] flex-shrink-0">Workspaces:</span>
          <div className="flex gap-1.5 flex-wrap">
            {scopeBadges.map((badge, idx) => (
              <span key={idx} className="text-[10px] md:text-xs font-semibold text-text bg-surface border border-border rounded-lg px-2.5 py-0.5 inline-flex items-center gap-1.5 select-none shadow-3xs">
                {badge.type === "personal" ? (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="opacity-70"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                ) : badge.type === "organization" ? (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="opacity-70"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
                ) : badge.type === "team" ? (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="opacity-70"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                ) : (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="opacity-70"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/></svg>
                )}
                {badge.name}
              </span>
            ))}
          </div>
        </div>

        {/* Agent Context (only for agent tokens) */}
        {token.tokenType === "agent" && token.agentPolicy && (() => {
          try {
            const policy = JSON.parse(token.agentPolicy);
            return (
              <div className="flex gap-2 flex-wrap items-start">
                <span className="text-[11px] text-text-muted font-bold uppercase tracking-wider w-[80px] flex-shrink-0 mt-0.5">Agent:</span>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-amber-400 font-medium">{policy.agentContext}</span>
                  {policy.allowedCategories && policy.allowedCategories.length > 0 && (
                    <span className="text-[10px] text-text-muted">Categories: {policy.allowedCategories.join(", ")}{policy.allowCredentials ? ", credentials" : ""}</span>
                  )}
                </div>
              </div>
            );
          } catch { return null; }
        })()}

        {/* Permissions Badges */}
        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-[11px] text-text-muted font-bold uppercase tracking-wider w-[80px] flex-shrink-0">MCP Tools:</span>
          <div className="flex gap-1.5 flex-wrap">
            {TOOL_DEFS.filter((t) => token.permissions & t.bit).map((t) => (
              <Badge key={t.bit} variant="accent" className="h-5 text-[9px] px-2 font-mono tracking-normal normal-case">
                {t.label}
              </Badge>
            ))}
            {(token.permissions === 0) && (
              <span className="text-xs text-text-muted italic select-none">No tools enabled</span>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Row: Metadata Dates */}
      <div className="border-t border-border pt-2.5 mt-1.5 flex justify-between flex-wrap gap-2 text-[10px] text-text-muted font-medium select-none">
        <div>
          <span>Created {formatDate(token.createdAt)}</span>
          {token.lastUsedAt && <span className="ml-3">Last used {formatDate(token.lastUsedAt)}</span>}
        </div>
        {token.expiresAt && (
          <span>Expires {formatDate(token.expiresAt)}</span>
        )}
      </div>

      {expanded && (
        <div className="border-t border-border pt-4 mt-2 flex flex-col gap-3 select-none">
          {TOOL_DEFS.map((tool) => (
            <label key={tool.bit} className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={!!(perms & tool.bit)}
                onChange={() => toggleBit(tool.bit)}
                className="mt-1 cursor-pointer h-4 w-4 rounded-sm border-border text-accent focus:ring-accent accent-accent"
              />
              <div>
                <div className="text-xs font-semibold text-text font-mono">{tool.label}</div>
                <div className="text-[10px] text-text-muted mt-0.5 leading-relaxed">{tool.desc}</div>
              </div>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

const AGENT_CATEGORY_DEFS = [
  { key: "rules", label: "rules", desc: "Behavioral directives and AI instructions" },
  { key: "projects", label: "projects", desc: "Active work, tasks, in-progress features" },
  { key: "references", label: "references", desc: "Technical references and documentation notes" },
  { key: "stack", label: "stack", desc: "Architecture, dependencies, framework choices" },
] as const;

export function NewTokenModal({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (name: string, permissions: number, scopeType: "personal" | "organization" | "team", scopeId?: string, scopes?: Array<{ type: "personal" | "organization" | "team"; id: string | null }>, ttlDays?: number, tokenType?: "human" | "agent", agentContext?: string, allowedCategories?: string[], allowCredentials?: boolean) => Promise<string>;
}) {
  const [name, setName] = useState("");
  const [perms, setPerms] = useState(MCP_PERM_RECALL | MCP_PERM_COMMIT | MCP_PERM_UPDATE | MCP_PERM_DELETE);
  const [selectedScopes, setSelectedScopes] = useState<string[]>(["personal"]);
  const [ttlDays, setTtlDays] = useState(365);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [timeLeft, setTimeLeft] = useState(300);
  const [tokenType, setTokenType] = useState<"human" | "agent">("human");
  const [agentContext, setAgentContext] = useState("");
  const [allowedCategories, setAllowedCategories] = useState<string[]>(["rules", "projects", "references", "stack"]);
  const [allowCredentials, setAllowCredentials] = useState(false);

  const { data: workspacesList = [] } = useQuery({ queryKey: ["workspaces"], queryFn: () => getUserWorkspaces() });
  const workspaces = Array.isArray(workspacesList) ? workspacesList : [];

  async function handleCreate() {
    if (!name.trim()) return;
    if (selectedScopes.length === 0) {
      setError("At least one scope must be selected.");
      return;
    }
    if (tokenType === "agent" && !agentContext.trim()) {
      setError("Agent context is required for agent tokens.");
      return;
    }
    setLoading(true);
    setError(null);

    const scopes = selectedScopes.map((key) => {
      if (key === "personal") {
        return { type: "personal" as const, id: null };
      }
      const [type, id] = key.split(":") as ["organization" | "team", string];
      return { type, id };
    });

    const primaryKey = selectedScopes[0] || "personal";
    const [scopeType, scopeId] = primaryKey === "personal"
      ? ["personal" as const, undefined]
      : primaryKey.split(":") as ["organization" | "team", string];

    try {
      setToken(await onCreate(name.trim(), perms, scopeType, scopeId, scopes, ttlDays, tokenType, agentContext.trim() || undefined, allowedCategories, allowCredentials));
    } catch (err: any) {
      setError(err.message || "Failed to generate token.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!token || confirmed) return;
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setToken(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [token, confirmed]);

  async function copyToken() {
    if (!token) return;
    await navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleConfirmCopied() {
    setConfirmed(true);
    setToken(null);
    onClose();
  }

  return (
    <Dialog open={true} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-[460px]">
        {!token ? (
          <>
            <DialogHeader>
              <DialogTitle>New API Token</DialogTitle>
              <DialogDescription>
                Tokens authenticate MCP requests. Restrict which tools each token can call.
              </DialogDescription>
            </DialogHeader>

            <div className="py-2 flex flex-col gap-4 overflow-y-auto max-h-[60vh] pr-1 select-none">
              {/* Token type toggle */}
              <div className="flex gap-1 p-1 bg-surface rounded-xl border border-border">
                <button
                  type="button"
                  onClick={() => setTokenType("human")}
                  className={`flex-1 text-xs font-semibold py-1.5 px-3 rounded-lg transition-colors ${tokenType === "human" ? "bg-surface2 text-text shadow-sm" : "text-text-muted hover:text-text"}`}
                >
                  Human Token
                </button>
                <button
                  type="button"
                  onClick={() => setTokenType("agent")}
                  className={`flex-1 text-xs font-semibold py-1.5 px-3 rounded-lg transition-colors ${tokenType === "agent" ? "bg-amber-500/15 text-amber-400 shadow-sm" : "text-text-muted hover:text-text"}`}
                >
                  Agent Token
                </button>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="token-name">Token Name</Label>
                <Input
                  id="token-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={tokenType === "agent" ? "e.g. Deploy Pipeline Bot" : "e.g. Claude Desktop"}
                  autoFocus
                />
              </div>

              {/* Agent-specific fields */}
              {tokenType === "agent" && (
                <>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="agent-context">Agent Context <span className="text-error">*</span></Label>
                    <Input
                      id="agent-context"
                      type="text"
                      value={agentContext}
                      onChange={(e) => setAgentContext(e.target.value.slice(0, 128))}
                      placeholder="e.g. frontend debugging, deploy pipeline, code review"
                    />
                    <span className="text-[10px] text-text-muted">Describes what this agent is authorized to do. Shown in audit logs.</span>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label>Allowed Memory Categories</Label>
                    <div className="flex flex-col gap-2 border border-border rounded-xl p-3 bg-surface2">
                      {AGENT_CATEGORY_DEFS.map((cat) => (
                        <label key={cat.key} className="flex items-start gap-2.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={allowedCategories.includes(cat.key)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setAllowedCategories([...allowedCategories, cat.key]);
                              } else {
                                setAllowedCategories(allowedCategories.filter((c) => c !== cat.key));
                              }
                            }}
                            className="mt-0.5 cursor-pointer h-4 w-4 rounded-sm border-border text-accent focus:ring-accent accent-accent"
                          />
                          <div>
                            <div className="text-xs font-semibold text-text font-mono">{cat.label}</div>
                            <div className="text-[10px] text-text-muted mt-0.5">{cat.desc}</div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>

                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allowCredentials}
                      onChange={(e) => setAllowCredentials(e.target.checked)}
                      className="mt-0.5 cursor-pointer h-4 w-4 rounded-sm border-border text-accent focus:ring-accent accent-accent"
                    />
                    <div>
                      <div className="text-xs font-semibold text-text">Allow Credential Vault Access</div>
                      <div className="text-[10px] text-text-muted mt-0.5 leading-relaxed">Grants the agent read/write access to encrypted secrets. Enable only when the agent explicitly needs credentials.</div>
                    </div>
                  </label>
                </>
              )}

              <div className="flex flex-col gap-1.5">
                <Label>Scope Constraints (Select one or more)</Label>
                <div className="flex flex-col gap-2 max-h-[160px] overflow-y-auto border border-border rounded-xl p-3 bg-surface2 no-scrollbar">
                  <label className="flex items-center gap-2.5 text-xs cursor-pointer font-bold border-b border-border/60 pb-2 mb-1.5">
                    <input
                      type="checkbox"
                      checked={workspaces.length > 0 && selectedScopes.length === workspaces.length}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedScopes(workspaces.map((w: any) => w.key));
                        } else {
                          setSelectedScopes([]);
                        }
                      }}
                      className="cursor-pointer h-4 w-4 rounded-sm border-border text-accent focus:ring-accent accent-accent"
                    />
                    <span>All Workspaces</span>
                  </label>
                  {workspaces.map((w: any) => (
                    <label key={w.key} className="flex items-center gap-2.5 text-xs cursor-pointer py-0.5">
                      <input
                        type="checkbox"
                        checked={selectedScopes.includes(w.key)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedScopes([...selectedScopes, w.key]);
                          } else {
                            setSelectedScopes(selectedScopes.filter((k) => k !== w.key));
                          }
                        }}
                        className="cursor-pointer h-4 w-4 rounded-sm border-border text-accent focus:ring-accent accent-accent"
                      />
                      <span>{w.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="token-expiry">Token Expiry</Label>
                <Select
                  id="token-expiry"
                  value={ttlDays}
                  onChange={(e) => setTtlDays(parseInt(e.target.value))}
                >
                  <option value={7}>7 days</option>
                  <option value={30}>30 days</option>
                  <option value={90}>90 days</option>
                  <option value={180}>6 months</option>
                  <option value={365}>1 year (default)</option>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Permissions</Label>
                <div className="flex flex-col gap-3 border border-border bg-surface2 p-3.5 rounded-xl">
                  {TOOL_DEFS.map((tool) => (
                    <label key={tool.bit} className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!(perms & tool.bit)}
                        onChange={() => setPerms((p) => p ^ tool.bit)}
                        className="mt-0.5 cursor-pointer h-4 w-4 rounded-sm border-border text-accent focus:ring-accent accent-accent"
                      />
                      <div>
                        <div className="text-xs font-semibold text-text font-mono">{tool.label}</div>
                        <div className="text-[10px] text-text-muted mt-0.5 leading-relaxed">{tool.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {error && (
                <div className="text-xs text-error bg-error/10 border border-error/20 p-3 rounded-xl font-medium">
                  {error}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={loading || !name.trim()}>
                {loading ? "Generating…" : "Generate token"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2 bg-accent/5 border border-accent/20 rounded-xl p-3 mb-2 w-full">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-accent flex-shrink-0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <span className="text-[11px] font-bold text-accent uppercase tracking-wider">Shown once only • Expiring in {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, "0")}</span>
              </div>
              <DialogTitle>API Token Created</DialogTitle>
              <DialogDescription>
                Copy and save this token immediately — it will not be shown again.
              </DialogDescription>
            </DialogHeader>

            <div className="py-2 flex flex-col gap-4 select-none">
              <div className="flex items-center gap-2.5 bg-surface2 border border-border rounded-xl p-3.5">
                <code className="flex-1 font-mono text-xs text-accent break-all select-all">{token}</code>
                <Button size="sm" onClick={copyToken} className="h-7 text-xs font-semibold flex-shrink-0 select-none">
                  {copied ? "✓ Copied" : "Copy"}
                </Button>
              </div>
              
              <div className="flex items-start gap-2.5 text-xs text-text-muted bg-surface2 border border-border rounded-xl p-3.5 leading-relaxed">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-0.5 flex-shrink-0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <span>Add this token to your MCP client as a Bearer token in the Authorization header.</span>
              </div>
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>
                Back
              </Button>
              <Button onClick={handleConfirmCopied} disabled={!copied} className={!copied ? "opacity-50 cursor-not-allowed" : ""}>
                I've copied my token
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
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
    <div className="bg-surface border border-border rounded-2xl p-5 flex flex-col gap-4 shadow-xs">
      <div>
        <h2 className="text-base font-bold text-text">Profile</h2>
        <p className="text-xs text-text-muted mt-0.5 leading-relaxed">Used to personalise how memories are phrased during import.</p>
      </div>

      {profileQuery.isPending ? (
        <p className="text-text-muted text-xs animate-pulse">Loading…</p>
      ) : profileQuery.isError ? (
        <p className="text-error text-xs font-semibold">Failed to load profile.</p>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); saveMutation.mutate({ data: { name, location } }); }} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="profile-name">Preferred Name</Label>
              <Input id="profile-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Roger" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="profile-location">Location</Label>
              <Input id="profile-location" type="text" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Florida" />
            </div>
          </div>
          {savedMessage && (
            <div className="flex items-center gap-2 p-3 bg-success/10 border border-success/30 rounded-xl text-success text-xs font-semibold select-none">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
              Profile saved successfully.
            </div>
          )}
          {saveMutation.isError && <p className="text-error text-xs font-semibold">Failed to save: {(saveMutation.error as Error).message}</p>}
          <div>
            <Button type="submit" disabled={saveMutation.isPending} className="font-bold text-xs select-none h-9 px-4">
              {saveMutation.isPending ? "Saving…" : "Save Profile"}
            </Button>
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
  const { data: workspacesList = [] } = useQuery({ queryKey: ["workspaces"], queryFn: () => getUserWorkspaces() });
  const workspaces = Array.isArray(workspacesList) ? workspacesList : [];

  const createMut = useMutation({
    mutationFn: ({ name, permissions, scopeType, scopeId, scopes, ttlDays, tokenType, agentContext, allowedCategories, allowCredentials }: { name: string; permissions: number; scopeType: "personal" | "organization" | "team"; scopeId?: string; scopes?: any; ttlDays?: number; tokenType?: "human" | "agent"; agentContext?: string; allowedCategories?: string[]; allowCredentials?: boolean }) =>
      createApiToken({ data: { name, permissions, scopeType, scopeId, scopes, ttlDays, tokenType: tokenType ?? "human", agentContext, allowedCategories, allowCredentials } }),
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

  async function handleCreate(name: string, permissions: number, scopeType: "personal" | "organization" | "team", scopeId?: string, scopes?: any, ttlDays?: number, tokenType?: "human" | "agent", agentContext?: string, allowedCategories?: string[], allowCredentials?: boolean): Promise<string> {
    const result = await createMut.mutateAsync({ name, permissions, scopeType, scopeId, scopes, ttlDays, tokenType, agentContext, allowedCategories, allowCredentials });
    return result.token;
  }

  return (
    <>
      <div className="bg-surface border border-border rounded-2xl p-5 flex flex-col gap-4 shadow-xs">
        <div className="flex items-center justify-between gap-4 select-none">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-text">API Tokens</h2>
            <Badge variant="secondary" className="normal-case font-semibold tracking-normal">{tokens.length}</Badge>
          </div>
          <Button onClick={() => setShowModal(true)} className="h-8 text-xs font-bold px-3">
            + New Token
          </Button>
        </div>
        <p className="text-xs text-text-muted -mt-1 leading-relaxed">Authenticate MCP calls from AI clients using Bearer tokens.</p>

        <div className="flex items-start gap-2.5 bg-accent/5 border border-accent/20 rounded-xl p-3.5 text-xs text-text-muted leading-relaxed select-none">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0 mt-0.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span>Set <code className="font-mono text-[10px] bg-surface border border-border px-1 py-0.5 rounded-sm text-accent select-all">Authorization: Bearer &lt;token&gt;</code> in your client's headers.</span>
        </div>

        {isLoading ? (
          <p className="text-text-muted text-xs animate-pulse">Loading…</p>
        ) : tokens.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-text-muted text-xs border border-dashed border-border rounded-xl select-none">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="opacity-40"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            <p className="margin-0 font-medium">No API tokens yet. Create one to connect your AI clients.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 mt-1">
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
    <div className="bg-surface border border-border rounded-2xl p-5 flex flex-col gap-4 shadow-xs">
      <div>
        <h2 className="text-base font-bold text-text">MCP Endpoint</h2>
        <p className="text-xs text-text-muted mt-0.5 leading-relaxed">Point your AI client's MCP configuration at:</p>
      </div>
      <div className="bg-surface2 border border-border rounded-xl p-3.5 font-mono text-xs text-text break-all select-all shadow-3xs">
        <code className="text-accent">{typeof window !== "undefined" ? window.location.origin : ""}/api/mcp</code>
      </div>
      <p className="text-xs text-text-muted leading-relaxed select-none">
        Authentication: <code className="font-mono text-[10px] bg-surface2 border border-border px-1 py-0.5 rounded-sm text-accent select-all">Authorization: Bearer lkr_&lt;your-token&gt;</code>
      </p>
    </div>
  );
}

export function TwoFactorSection() {
  const queryClient = useQueryClient();
  const [setupData, setSetupData] = useState<{ secret: string; uri: string; backupCodes: string[] } | null>(null);
  const [code, setCode] = useState("");
  const [verificationError, setVerificationError] = useState("");
  const [showBackupCodes, setShowBackupCodes] = useState(false);
  const [copiedBackup, setCopiedBackup] = useState(false);

  const { data: totpStatus, refetch: refetchStatus } = useQuery({
    queryKey: ["totp-status"],
    queryFn: () => getTOTPStatus(),
  });

  const setupMut = useMutation({
    mutationFn: () => setupTOTP(),
    onSuccess: (data) => {
      setSetupData(data);
      setCode("");
      setVerificationError("");
      setShowBackupCodes(false);
    },
  });

  const verifyMut = useMutation({
    mutationFn: (vars: { secret: string; code: string; backupCodes: string[] }) =>
      verifyAndSaveTOTP({ data: vars }),
    onSuccess: (res) => {
      if (res.success) {
        queryClient.invalidateQueries({ queryKey: ["totp-status"] });
        refetchStatus();
        setShowBackupCodes(true);
        setVerificationError("");
      } else {
        setVerificationError(res.message || "Invalid verification code.");
      }
    },
    onError: (err: any) => {
      setVerificationError(err.message || "Failed to verify code.");
    },
  });

  const disableMut = useMutation({
    mutationFn: () => disableTOTP(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["totp-status"] });
      refetchStatus();
      setSetupData(null);
      setShowBackupCodes(false);
    },
  });

  const handleVerifySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!setupData) return;
    if (!/^\d{6}$/.test(code.trim())) {
      setVerificationError("Verification code must be exactly 6 digits.");
      return;
    }
    verifyMut.mutate({
      secret: setupData.secret,
      code: code.trim(),
      backupCodes: setupData.backupCodes,
    });
  };

  const handleCopyBackup = () => {
    if (!setupData) return;
    navigator.clipboard.writeText(setupData.backupCodes.join("\n"));
    setCopiedBackup(true);
    setTimeout(() => setCopiedBackup(false), 2000);
  };

  return (
    <div className="bg-surface border border-border rounded-2xl p-5 flex flex-col gap-4 shadow-xs">
      <div>
        <h2 className="text-base font-bold text-text">Two-Factor Authentication</h2>
        <p className="text-xs text-text-muted mt-0.5 leading-relaxed">
          Add an extra layer of security to your account using TOTP.
        </p>
      </div>

      {totpStatus?.enabled ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 p-3.5 bg-success/10 border border-success/20 rounded-xl text-success text-xs font-semibold select-none leading-relaxed">
            <span>✓ Two-factor authentication is enabled on your account.</span>
          </div>
          <Button
            variant="ghost"
            className="bg-error/10 hover:bg-error/20 text-error border border-error/20 hover:border-error/35 mt-1 font-bold text-xs select-none w-fit h-9 px-4"
            onClick={() => {
              if (confirm("Are you sure you want to disable 2FA?")) {
                disableMut.mutate();
              }
            }}
            disabled={disableMut.isPending}
          >
            Disable 2FA
          </Button>
        </div>
      ) : setupData ? (
        showBackupCodes ? (
          <div className="flex flex-col gap-4 border-t border-border pt-4 animate-in fade-in duration-200">
            <div className="bg-success/10 border border-success/25 rounded-xl p-4 flex flex-col gap-1.5">
              <h3 className="text-xs font-bold text-success uppercase tracking-wider">
                ✓ 2FA Enabled Successfully!
              </h3>
              <p className="text-xs text-text-muted leading-relaxed">
                Save your backup codes. You will need them if you lose access to your authenticator app.
              </p>
            </div>

            <div className="bg-surface2 border border-border rounded-xl p-4 flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2.5 font-mono text-xs text-text select-all">
                {setupData.backupCodes.map((code, idx) => (
                  <div key={idx} className="flex gap-1.5 items-center">
                    <span className="text-[10px] text-text-muted">{idx + 1}.</span>
                    <span>{code}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between items-center gap-3 border-t border-border pt-3 mt-1.5">
                <Button
                  onClick={handleCopyBackup}
                  variant="outline"
                  className="h-8 text-xs font-semibold"
                >
                  {copiedBackup ? "✓ Copied" : "Copy All Codes"}
                </Button>
                <Button
                  onClick={() => setSetupData(null)}
                  className="h-8 text-xs font-bold"
                >
                  Finished
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 border-t border-border pt-4 animate-in fade-in duration-200">
            <h3 className="text-xs font-bold text-text uppercase tracking-wider">
              Setup Authenticator
            </h3>
            
            <div className="flex flex-col md:flex-row gap-5 items-start">
              <div className="flex-1 flex flex-col gap-3">
                <p className="text-xs text-text-muted leading-relaxed">
                  Scan the QR code with your authenticator app, or manually enter the secret key shown below:
                </p>
                <div className="bg-surface2 border border-border rounded-xl p-3.5 flex flex-col gap-2 shadow-3xs">
                  <div className="flex flex-col gap-1">
                    <span className="text-[9px] uppercase font-bold text-text-muted">Secret Key</span>
                    <code className="text-accent text-xs font-mono select-all tracking-wider break-all">{setupData.secret}</code>
                  </div>
                </div>
              </div>
            </div>

            <form onSubmit={handleVerifySubmit} className="flex flex-col gap-3 border-t border-border pt-4">
              <div className="flex flex-col gap-1.5 max-w-[240px]">
                <Label htmlFor="verification-code" className="text-[10px]">
                  Verification Code
                </Label>
                <Input
                  id="verification-code"
                  type="text"
                  placeholder="Enter 6-digit code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="h-9 text-xs font-mono"
                  maxLength={6}
                />
              </div>

              {verificationError && (
                <p className="text-xs text-error font-medium">{verificationError}</p>
              )}

              <div className="flex gap-2.5 select-none">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSetupData(null)}
                  className="h-9 text-xs font-semibold"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={verifyMut.isPending || code.length !== 6}
                  className="h-9 text-xs font-bold"
                >
                  {verifyMut.isPending ? "Verifying..." : "Verify & Enable"}
                </Button>
              </div>
            </form>
          </div>
        )
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-2.5 bg-accent/5 border border-accent/20 rounded-xl p-3.5 text-xs text-text-muted leading-relaxed select-none">
            <span>Enable TOTP-based 2FA using an authenticator app like Authy, Google Authenticator, or Microsoft Authenticator.</span>
          </div>
          <Button
            className="mt-1 font-bold text-xs select-none w-fit h-9 px-4"
            onClick={() => setupMut.mutate()}
            disabled={setupMut.isPending}
          >
            {setupMut.isPending ? "Setting up..." : "Set Up 2FA"}
          </Button>
        </div>
      )}
    </div>
  );
}

export function PasscodeSection() {
  const queryClient = useQueryClient();
  const [passcode, setPasscode] = useState("");
  const [confirmPasscode, setConfirmPasscode] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const { data: status } = useQuery({
    queryKey: ["passcode-status"],
    queryFn: () => getPasscodeStatus(),
  });

  const setMut = useMutation({
    mutationFn: (p: string) => setDeletionPasscode({ data: { passcode: p } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["passcode-status"] });
      setPasscode("");
      setConfirmPasscode("");
      setErrorMsg("");
      setSuccessMsg("Deletion passcode successfully updated!");
      setTimeout(() => setSuccessMsg(""), 5000);
    },
    onError: (err: any) => {
      setErrorMsg(err.message || "Failed to set passcode.");
    },
  });

  const removeMut = useMutation({
    mutationFn: () => removeDeletionPasscode(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["passcode-status"] });
      setErrorMsg("");
      setSuccessMsg("Deletion passcode successfully removed.");
      setTimeout(() => setSuccessMsg(""), 5000);
    },
    onError: (err: any) => {
      setErrorMsg(err.message || "Failed to remove passcode.");
    },
  });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (passcode.length < 4 || passcode.length > 32) {
      setErrorMsg("Passcode must be between 4 and 32 characters long.");
      return;
    }
    if (passcode !== confirmPasscode) {
      setErrorMsg("Passcodes do not match.");
      return;
    }
    setMut.mutate(passcode);
  };

  return (
    <div className="bg-surface border border-border rounded-2xl p-5 flex flex-col gap-4 shadow-xs">
      <div>
        <h2 className="text-base font-bold text-text">Deletion & Write Passcode</h2>
        <p className="text-xs text-text-muted mt-0.5 leading-relaxed">
          Require a passcode for modifying or deleting memories via MCP when 2FA is inactive.
        </p>
      </div>

      {status?.enabled ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 p-3.5 bg-success/10 border border-success/20 rounded-xl text-success text-xs font-semibold select-none leading-relaxed">
            <span>✓ A static passcode is active for destructive operations.</span>
          </div>
          <Button
            variant="ghost"
            className="bg-error/10 hover:bg-error/20 text-error border border-error/20 hover:border-error/35 mt-1 font-bold text-xs select-none w-fit h-9 px-4 animate-in fade-in duration-150"
            onClick={() => {
              if (confirm("Are you sure you want to disable passcode protection? Your MCP write operations will no longer require validation (unless 2FA is active).")) {
                removeMut.mutate();
              }
            }}
            disabled={removeMut.isPending}
          >
            Remove Passcode
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 animate-in fade-in duration-150">
          <div className="flex items-start gap-2.5 bg-accent/5 border border-accent/20 rounded-xl p-3.5 text-xs text-text-muted leading-relaxed select-none">
            <span>No passcode is set. Modifying or deleting memories via MCP will only require simple confirmation.</span>
          </div>
        </div>
      )}

      <form onSubmit={handleSave} className="border-t border-border pt-4 flex flex-col gap-3.5 mt-1">
        <h3 className="text-xs font-bold text-text uppercase tracking-wider select-none">
          {status?.enabled ? "Update Passcode" : "Set Deletion Passcode"}
        </h3>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-passcode" className="text-[10px]">
              New Passcode
            </Label>
            <Input
              id="new-passcode"
              type="password"
              placeholder="Enter passcode"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              className="h-9 text-xs"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm-passcode" className="text-[10px]">
              Confirm Passcode
            </Label>
            <Input
              id="confirm-passcode"
              type="password"
              placeholder="Re-enter passcode"
              value={confirmPasscode}
              onChange={(e) => setConfirmPasscode(e.target.value)}
              className="h-9 text-xs"
            />
          </div>
        </div>

        {errorMsg && <p className="text-xs text-error font-medium">{errorMsg}</p>}
        {successMsg && <p className="text-xs text-success font-medium">{successMsg}</p>}

        <Button
          type="submit"
          disabled={setMut.isPending || !passcode || !confirmPasscode}
          className="mt-1 font-bold text-xs select-none w-fit h-9 px-4"
        >
          {setMut.isPending ? "Updating..." : "Save Passcode"}
        </Button>
      </form>
    </div>
  );
}

export function SessionsSection() {
  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ["active-sessions"],
    queryFn: async () => {
      const response = await fetch("/api/sessions");
      return response.json() as Promise<any[]>;
    },
  });

  const revokeOneMut = useMutation({
    mutationFn: async (sessionId: string) => {
      await fetch(`/api/sessions/${sessionId}/revoke`, { method: "POST" });
    },
    onSuccess: () => { useQueryClient().invalidateQueries({ queryKey: ["active-sessions"] }); },
  });

  const revokeAllMut = useMutation({
    mutationFn: async () => {
      await fetch("/api/sessions/revoke-all", { method: "POST" });
    },
    onSuccess: () => { useQueryClient().invalidateQueries({ queryKey: ["active-sessions"] }); },
  });

  if (isLoading) {
    return (
      <div className="bg-surface border border-border rounded-2xl p-5 shadow-xs">
        <p className="text-text-muted text-xs animate-pulse">Loading sessions...</p>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-2xl p-5 flex flex-col gap-4 shadow-xs">
      <div className="flex items-center justify-between gap-4 select-none">
        <div>
          <h2 className="text-base font-bold text-text">Active Sessions</h2>
          <p className="text-xs text-text-muted mt-0.5 leading-relaxed">Sessions on other devices and browsers</p>
        </div>
        {sessions.length > 1 && (
          <Button
            variant="ghost"
            className="h-8 text-xs text-error hover:text-error hover:bg-error/5 hover:border-error/25 px-3 font-semibold"
            onClick={() => revokeAllMut.mutate()}
          >
            Sign Out All
          </Button>
        )}
      </div>

      {sessions.length === 0 ? (
        <p className="text-xs text-text-muted italic select-none">Only this session active.</p>
      ) : (
        <div className="flex flex-col gap-2.5 mt-1">
          {sessions.map((session: any) => (
            <div key={session.id} className="flex items-center justify-between p-3.5 bg-surface2 border border-border rounded-xl shadow-3xs gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-xs md:text-sm font-semibold text-text mb-0.5">
                  {session.userAgent?.includes("Chrome") ? "Chrome" : session.userAgent?.includes("Firefox") ? "Firefox" : "Browser"}
                </div>
                <div className="text-[10px] md:text-xs text-text-muted font-medium">
                  {session.ipAddress || "Unknown IP"} · {new Date(session.createdAt).toLocaleDateString()}
                </div>
              </div>
              <Button
                variant="ghost"
                className="h-7 text-xs text-error hover:text-error hover:bg-error/5 hover:border-error/25 px-3"
                onClick={() => revokeOneMut.mutate(session.id)}
              >
                Revoke
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── standalone /settings page ──────────────────────────────────────────────

function SettingsPage() {
  const [tab, setTab] = useState<"profile" | "tokens" | "mcp" | "security" | "sessions">("profile");

  const tabs = [
    { id: "profile" as const, label: "Profile", tooltip: "Update your display name and email address." },
    { id: "security" as const, label: "Security", tooltip: "Manage two-factor authentication and change your password." },
    { id: "sessions" as const, label: "Sessions", tooltip: "View and revoke active login sessions across devices." },
    { id: "tokens" as const, label: "API Tokens", tooltip: "Create tokens that let AI clients authenticate with your memories via the MCP endpoint." },
    { id: "mcp" as const, label: "MCP Endpoint", tooltip: "Your personal MCP server URL — paste this into your AI client (e.g. Claude, Cursor) to enable memory retrieval." },
  ];

  return (
    <div className="flex-1 min-h-screen bg-background">
      <PageHeader
        title="Settings"
        icon={
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        }
        description="Profile parameters, API tokens, security and MCP endpoints"
      />

      <PageContainer>
        <div className="flex gap-1 border-b border-border overflow-x-auto no-scrollbar select-none mb-2">
          {tabs.map((t) => {
            const isActive = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-2.5 text-xs md:text-sm font-semibold border-b-2 whitespace-nowrap transition-colors -mb-[1px] rounded-t-md hover:bg-surface2/40 uppercase tracking-wider text-[11px] flex items-center gap-1.5 ${
                  isActive
                    ? "border-accent text-accent bg-surface"
                    : "border-transparent text-text-muted hover:text-text"
                }`}
              >
                {t.label}
                <InfoTooltip text={t.tooltip} size={12} />
              </button>
            );
          })}
        </div>

        <div>
          {tab === "profile" && <ProfileSection />}
          {tab === "security" && (
            <div className="flex flex-col gap-6">
              <TwoFactorSection />
              <PasscodeSection />
            </div>
          )}
          {tab === "sessions" && <SessionsSection />}
          {tab === "tokens" && <ApiTokensSection />}
          {tab === "mcp" && <McpEndpointSection />}
        </div>
      </PageContainer>
    </div>
  );
}
