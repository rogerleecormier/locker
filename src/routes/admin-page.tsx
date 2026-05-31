import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AdminLayout, type AdminSection } from "~/components/AdminLayout";
import { SiteAdminSection, OrgAdminSection, StatBox, AdminCard } from "~/components/AdminSections";
import {
  getAdminStatus,
  getDbStats,
  getVectorizeDebug,
  listAllOrgsAndQuotas,
  listAllUsersAndDetails,
  clearDatabase,
  clearVectorizeIndex,
  createUserAdmin,
  updateUserAdmin,
  deleteUserAdmin,
  updateUserPlanAdmin,
  setUserPasswordAdmin,
  resetUserPasswordAdmin,
  assignUserToOrgAdmin,
  removeUserFromOrgAdmin,
  updateOrgQuota,
  deleteOrganization,
  type UserDetails,
  type OrgWithQuota,
} from "~/routes/admin";
import {
  nukeEverything,
  scanDatabaseDuplicates,
  bulkDeleteMemories,
  encryptAllMemories,
  rebuildVectorizeIndex,
  getOrgAuditLogs,
  type DuplicateGroup,
} from "~/server/memoryFunctions";
import { MyUsageSection, MyBillingSection, OrgBillingSection, useBillingData } from "~/routes/billing";
import { ProfileSection, ApiTokensSection, McpEndpointSection } from "~/routes/settings";
import {
  getUserOrgsAndTeams,
  createOrganizationSelfServe,
  addOrgMemberByEmail,
  updateOrgMemberRole,
  removeOrgMember,
  createTeam,
  deleteTeam,
  addTeamMemberByEmail,
  updateTeamMemberRole,
  removeTeamMember,
  MemberRow,
  InviteForm,
  CreateOrgModal,
} from "~/routes/organization";

const modalOverlay: React.CSSProperties = {
  position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
  background: "rgba(15, 17, 23, 0.75)", backdropFilter: "blur(4px)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 1000, padding: "20px",
};
const modalBox: React.CSSProperties = {
  background: "var(--surface)", border: "1px solid var(--border)",
  borderRadius: "12px", width: "100%", maxWidth: "450px",
  boxShadow: "0 20px 25px -5px rgba(0,0,0,0.3)", padding: "24px",
};
function AuditLogsSection() {
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);

  const { data: logs, isLoading } = useQuery({
    queryKey: ["audit-logs", limit, offset],
    queryFn: () => getOrgAuditLogs({ data: { limit, offset } }),
  });

  return (
    <OrgAdminSection title="Audit Logs" description="Track all actions taken in your organization" icon="📋">
      {isLoading ? (
        <p>Loading audit logs...</p>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {!logs?.logs || logs.logs.length === 0 ? (
              <p style={{ color: "var(--text-muted)", fontSize: 13 }}>No audit logs yet</p>
            ) : (
              logs.logs.map((log: any) => (
                <div key={log.id} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", fontSize: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontWeight: 600, color: "var(--text)" }}>{log.action}</span>
                    <span style={{ color: "var(--text-muted)" }}>{new Date(log.timestamp).toLocaleString()}</span>
                  </div>
                  <div style={{ color: "var(--text-muted)", fontSize: 11, display: "flex", gap: 12 }}>
                    <span>User: {log.userId}</span>
                    {log.tokenId && <span>Token: {log.tokenId}</span>}
                    {log.memoryId && <span>Memory: {log.memoryId}</span>}
                    {log.ipAddress && <span>IP: {log.ipAddress}</span>}
                  </div>
                </div>
              ))
            )}
          </div>

          {logs && logs.total > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)", fontSize: 12, color: "var(--text-muted)" }}>
              <span>Showing {offset + 1}-{Math.min(offset + limit, logs.total)} of {logs.total} logs</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setOffset(Math.max(0, offset - limit))} disabled={offset === 0} style={{ padding: "4px 10px", background: offset === 0 ? "var(--surface2)" : "var(--surface)", border: "1px solid var(--border)", borderRadius: 4, cursor: offset === 0 ? "default" : "pointer", fontSize: 11 }}>
                  Previous
                </button>
                <button onClick={() => setOffset(offset + limit)} disabled={offset + limit >= logs.total} style={{ padding: "4px 10px", background: offset + limit >= logs.total ? "var(--surface2)" : "var(--surface)", border: "1px solid var(--border)", borderRadius: 4, cursor: offset + limit >= logs.total ? "default" : "pointer", fontSize: 11 }}>
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </OrgAdminSection>
  );
}

function AdminPage() {
  const [activeSection, setActiveSection] = useState<AdminSection>("personal-account");

  // ── state ──────────────────────────────────────────────────────────────────
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmClearVectorize, setConfirmClearVectorize] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [scanResults, setScanResults] = useState<DuplicateGroup[] | null>(null);
  const [retainSelections, setRetainSelections] = useState<Record<number, string>>({});
  const [encryptResult, setEncryptResult] = useState<{ encrypted: number; alreadyEncrypted: number; failed: number } | null>(null);
  const [rebuildResult, setRebuildResult] = useState<{ processed: number; failed: number } | null>(null);

  // users modals
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [isOrgsModalOpen, setIsOrgsModalOpen] = useState(false);
  const [isResetSuccessModalOpen, setIsResetSuccessModalOpen] = useState(false);

  const [createName, setCreateName] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createPlan, setCreatePlan] = useState("free");

  const [selectedUser, setSelectedUser] = useState<UserDetails | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editEmailVerified, setEditEmailVerified] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState("free");
  const [passwordValue, setPasswordValue] = useState("");
  const [generatedPassword, setGeneratedPassword] = useState("");
  const [assignOrgId, setAssignOrgId] = useState("");
  const [assignRole, setAssignRole] = useState<"owner" | "admin" | "member">("member");
  const [userSearch, setUserSearch] = useState("");

  // orgs
  const [editingOrgQuotaId, setEditingOrgQuotaId] = useState<string | null>(null);
  const [editMemories, setEditMemories] = useState(100);
  const [editRecalls, setEditRecalls] = useState(1000);
  const [editCommits, setEditCommits] = useState(500);

  // ── queries ────────────────────────────────────────────────────────────────
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
  const orgsQuery = useQuery({
    queryKey: ["admin-orgs"],
    queryFn: () => listAllOrgsAndQuotas(),
    enabled: activeSection === "orgs" || activeSection === "users",
  });

  // Full org+team data for the org/team management sections
  const orgTeamQuery = useQuery({
    queryKey: ["admin-orgs-teams"],
    queryFn: () => getUserOrgsAndTeams(),
    enabled: activeSection === "orgs" || activeSection === "teams",
  });

  // Org/team UI state
  const [selectedOrgKey, setSelectedOrgKey] = useState<string>("");
  const [selectedTeamKey, setSelectedTeamKey] = useState<string>("");
  const [orgInviteEmail, setOrgInviteEmail] = useState("");
  const [orgInviteRole, setOrgInviteRole] = useState<"admin" | "member">("member");
  const [teamInviteEmail, setTeamInviteEmail] = useState("");
  const [teamInviteRole, setTeamInviteRole] = useState("member");
  const [newTeamName, setNewTeamName] = useState("");
  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const usersQuery = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => listAllUsersAndDetails(),
    enabled: activeSection === "users",
  });
  const { data: adminStatus } = useQuery({
    queryKey: ["admin-status"],
    queryFn: () => getAdminStatus(),
  });
  // Billing data used for role gating (isOrgAdmin) — loaded eagerly since it
  // determines which sidebar sections are visible.
  const { data: billingData } = useBillingData();
  const isOrgAdmin = (billingData?.managedOrgs?.length ?? 0) > 0;
  const isSiteAdmin = adminStatus?.isAdmin ?? false;

  // ── mutations ──────────────────────────────────────────────────────────────
  const clearDbMutation = useMutation({
    mutationFn: clearDatabase,
    onSuccess: () => { setConfirmClear(false); statsQuery.refetch(); debugQuery.refetch(); },
  });
  const clearVectorizeMutation = useMutation({
    mutationFn: clearVectorizeIndex,
    onSuccess: () => { setConfirmClearVectorize(false); statsQuery.refetch(); debugQuery.refetch(); },
  });
  const clearAllMutation = useMutation({
    mutationFn: nukeEverything,
    onSuccess: () => { setConfirmClearAll(false); statsQuery.refetch(); debugQuery.refetch(); },
  });
  const rebuildMutation = useMutation({
    mutationFn: () => rebuildVectorizeIndex({}),
    onSuccess: (data) => { setRebuildResult(data); statsQuery.refetch(); debugQuery.refetch(); },
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
      statsQuery.refetch();
      debugQuery.refetch();
      alert("Successfully resolved duplicates!");
    },
  });
  const encryptMutation = useMutation({
    mutationFn: () => encryptAllMemories({}),
    onSuccess: (data) => setEncryptResult(data),
  });

  const createUserMut = useMutation({
    mutationFn: (data: { name: string; email: string; password?: string; plan?: string }) => createUserAdmin({ data }),
    onSuccess: () => {
      usersQuery.refetch();
      setIsCreateModalOpen(false);
      setCreateName(""); setCreateEmail(""); setCreatePassword(""); setCreatePlan("free");
    },
    onError: (err) => alert("Failed to create user: " + String(err)),
  });
  const updateUserMut = useMutation({
    mutationFn: (data: { userId: string; name: string; email: string; emailVerified: boolean }) => updateUserAdmin({ data }),
    onSuccess: () => { usersQuery.refetch(); setIsEditModalOpen(false); },
    onError: (err) => alert("Failed to update user: " + String(err)),
  });
  const deleteUserMut = useMutation({
    mutationFn: (userId: string) => deleteUserAdmin({ data: { userId } }),
    onSuccess: () => usersQuery.refetch(),
    onError: (err) => alert("Failed to delete user: " + String(err)),
  });
  const updateUserPlanMut = useMutation({
    mutationFn: (data: { userId: string; plan: string }) => updateUserPlanAdmin({ data }),
    onSuccess: () => { usersQuery.refetch(); setIsPlanModalOpen(false); },
    onError: (err) => alert("Failed to update user plan: " + String(err)),
  });
  const setUserPasswordMut = useMutation({
    mutationFn: (data: { userId: string; password: string }) => setUserPasswordAdmin({ data }),
    onSuccess: () => { setIsPasswordModalOpen(false); setPasswordValue(""); alert("Password set successfully!"); },
    onError: (err) => alert("Failed to set password: " + String(err)),
  });
  const resetUserPasswordMut = useMutation({
    mutationFn: (userId: string) => resetUserPasswordAdmin({ data: { userId } }),
    onSuccess: (res) => { setGeneratedPassword(res.password || ""); setIsResetSuccessModalOpen(true); },
    onError: (err) => alert("Failed to reset password: " + String(err)),
  });
  const assignUserToOrgMut = useMutation({
    mutationFn: (data: { userId: string; orgId: string; role: "owner" | "admin" | "member" }) => assignUserToOrgAdmin({ data }),
    onSuccess: () => { usersQuery.refetch(); orgsQuery.refetch(); },
    onError: (err) => alert("Failed to assign user to organization: " + String(err)),
  });
  const removeUserFromOrgMut = useMutation({
    mutationFn: (data: { userId: string; orgId: string }) => removeUserFromOrgAdmin({ data }),
    onSuccess: () => { usersQuery.refetch(); orgsQuery.refetch(); },
    onError: (err) => alert("Failed to remove user from organization: " + String(err)),
  });
  const updateQuotaMut = useMutation({
    mutationFn: (data: { orgId: string; monthlyMemories: number; monthlyRecalls: number; monthlyCommits: number }) => updateOrgQuota({ data }),
    onSuccess: () => { setEditingOrgQuotaId(null); orgsQuery.refetch(); },
    onError: (err) => alert("Failed to update quota: " + String(err)),
  });
  const deleteOrgMut = useMutation({
    mutationFn: (id: string) => deleteOrganization({ data: { id } }),
    onSuccess: () => orgsQuery.refetch(),
    onError: (err) => alert("Failed to delete org: " + String(err)),
  });

  const filteredUsers = (usersQuery.data || []).filter(
    (u) =>
      u.name.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.email.toLowerCase().includes(userSearch.toLowerCase())
  );

  // Org/team mutations (self-serve operations for org admins)
  const refetchOrgTeams = () => orgTeamQuery.refetch();
  const mutOpts = { onSuccess: refetchOrgTeams, onError: (err: Error) => alert(err.message) };

  const createOrgMut = useMutation({
    mutationFn: (name: string) => createOrganizationSelfServe({ data: { name } }),
    onSuccess: (res) => { setShowCreateOrg(false); setNewOrgName(""); setSelectedOrgKey(`org:${res.orgId}`); refetchOrgTeams(); },
    onError: (err: Error) => alert(err.message),
  });
  const addOrgMemberMut = useMutation({
    mutationFn: (data: { orgId: string; email: string; role: "admin" | "member" }) => addOrgMemberByEmail({ data }),
    onSuccess: () => { setOrgInviteEmail(""); refetchOrgTeams(); },
    onError: (err: Error) => alert(err.message),
  });
  const updateOrgRoleMut = useMutation({
    mutationFn: (data: { orgId: string; userId: string; role: "owner" | "admin" | "member" }) => updateOrgMemberRole({ data }),
    ...mutOpts,
  });
  const removeOrgMemberMut = useMutation({
    mutationFn: (data: { orgId: string; userId: string }) => removeOrgMember({ data }),
    ...mutOpts,
  });
  const createTeamMut = useMutation({
    mutationFn: (data: { orgId: string; name: string }) => createTeam({ data }),
    onSuccess: () => { setNewTeamName(""); refetchOrgTeams(); },
    onError: (err: Error) => alert(err.message),
  });
  const deleteTeamMut = useMutation({
    mutationFn: (teamId: string) => deleteTeam({ data: { teamId } }),
    onSuccess: () => { setSelectedTeamKey(""); refetchOrgTeams(); },
    onError: (err: Error) => alert(err.message),
  });
  const addTeamMemberMut = useMutation({
    mutationFn: (data: { teamId: string; email: string; role: string }) => addTeamMemberByEmail({ data }),
    onSuccess: () => { setTeamInviteEmail(""); refetchOrgTeams(); },
    onError: (err: Error) => alert(err.message),
  });
  const updateTeamRoleMut = useMutation({
    mutationFn: (data: { teamId: string; userId: string; role: string }) => updateTeamMemberRole({ data }),
    ...mutOpts,
  });
  const removeTeamMemberMut = useMutation({
    mutationFn: (data: { teamId: string; userId: string }) => removeTeamMember({ data }),
    ...mutOpts,
  });

  // Derived org/team data
  const allOrgs = orgTeamQuery.data?.organizations ?? [];
  const allTeams = orgTeamQuery.data?.teams ?? [];
  const activeOrg = allOrgs.find((o) => o.id === selectedOrgKey) ?? allOrgs[0];
  const activeTeam = allTeams.find((t) => t.id === selectedTeamKey);
  const orgQuotaData = orgsQuery.data?.find((o) => o.id === activeOrg?.id);

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <AdminLayout
      activeSection={activeSection}
      onSectionChange={setActiveSection}
      isOrgAdmin={isOrgAdmin}
      isSiteAdmin={isSiteAdmin}
    >

      {/* ── PERSONAL ACCOUNT ────────────────────────────────────────────── */}
      {activeSection === "personal-account" && <ProfileSection />}

      {/* ── API TOKENS ──────────────────────────────────────────────────── */}
      {activeSection === "personal-tokens" && <ApiTokensSection />}

      {/* ── MCP ENDPOINT ────────────────────────────────────────────────── */}
      {activeSection === "personal-mcp" && <McpEndpointSection />}

      {/* ── MY USAGE ────────────────────────────────────────────────────── */}
      {activeSection === "personal-usage" && <MyUsageSection />}

      {/* ── MY BILLING ──────────────────────────────────────────────────── */}
      {activeSection === "personal-billing" && <MyBillingSection />}

      {/* ── SYSTEM OVERVIEW ─────────────────────────────────────────────── */}
      {activeSection === "system" && (
        <>
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
                    <div key={v.id} style={{ color: "var(--text-muted)", padding: "3px 0" }}>
                      {v.id.slice(0, 8)}... (missing from Vectorize)
                    </div>
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
              <button
                onClick={() => scanMutation.mutate({})}
                disabled={scanMutation.isPending}
                style={{ padding: "10px 20px", background: "var(--accent)", color: "white", border: "none", borderRadius: "var(--radius)", fontWeight: "bold", cursor: "pointer" }}
              >
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
                      Found {scanResults.length} duplicate group{scanResults.length !== 1 ? "s" : ""}. Choose which memory to retain (non-selected will be deleted):
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

          <SiteAdminSection title="Encryption" description="Encrypt plaintext memories at rest" icon="🔒">
            <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "15px" }}>
              Encrypt any plaintext memory facts stored before encryption was enabled. Safe to run multiple times — already-encrypted facts are skipped.
            </p>
            {encryptResult && (
              <AdminCard status="success">
                <p style={{ margin: 0 }}>Done — encrypted {encryptResult.encrypted}, skipped {encryptResult.alreadyEncrypted} already encrypted{encryptResult.failed > 0 ? `, ${encryptResult.failed} failed` : ""}.</p>
              </AdminCard>
            )}
            <button onClick={() => { setEncryptResult(null); encryptMutation.mutate(); }} disabled={encryptMutation.isPending}
              style={{ padding: "9px 20px", background: "var(--accent)", color: "white", border: "none", borderRadius: "var(--radius)", fontWeight: "bold", cursor: "pointer", marginTop: encryptResult ? "12px" : 0 }}>
              {encryptMutation.isPending ? "Encrypting…" : "Encrypt All Plaintext Memories"}
            </button>
            {encryptMutation.isError && <p style={{ color: "var(--error)", fontSize: "13px", marginTop: "8px" }}>Encryption failed. Check logs.</p>}
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
                <strong>Status:</strong>{" "}
                {clearDbMutation.isPending || clearVectorizeMutation.isPending || clearAllMutation.isPending ? "Operating..." : "Ready"}
              </p>
            </div>
          </SiteAdminSection>
        </>
      )}

      {/* ── SITE CONFIGURATION ──────────────────────────────────────────────── */}
      {activeSection === "site-config" && (
        <SiteAdminSection title="Site Configuration" description="Global settings and configuration" icon="🔧">
          <AdminCard>
            <p style={{ color: "var(--text-muted)", margin: 0 }}>Configuration options coming soon...</p>
          </AdminCard>
        </SiteAdminSection>
      )}

      {/* ── BILLING MANAGEMENT ──────────────────────────────────────────────── */}
      {activeSection === "billing-manage" && (
        <SiteAdminSection title="Billing Management" description="Manage subscription metrics and revenue" icon="💳">
          <AdminCard>
            <p style={{ color: "var(--text-muted)", margin: 0 }}>Billing dashboard coming soon...</p>
          </AdminCard>
        </SiteAdminSection>
      )}

      {/* ── ORGANIZATIONS ───────────────────────────────────────────────────── */}
      {activeSection === "orgs" && (
        <OrgAdminSection title="Organizations" description="Create organizations and manage members" icon="🏢">
          {/* Header: org picker + create */}
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 20 }}>
            {allOrgs.length > 0 && (
              <select value={activeOrg?.id ?? ""} onChange={(e) => setSelectedOrgKey(e.target.value)}
                style={{ flex: 1, padding: "8px 12px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontWeight: 600 }}>
                {allOrgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            )}
            <button onClick={() => setShowCreateOrg(true)}
              style={{ padding: "8px 16px", background: "var(--accent)", color: "white", border: "none", borderRadius: "var(--radius)", fontWeight: 600, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}>
              + Create Org
            </button>
          </div>

          {orgTeamQuery.isPending && <p style={{ color: "var(--text-muted)" }}>Loading...</p>}
          {orgTeamQuery.isError && <p style={{ color: "var(--error)" }}>Failed to load organizations.</p>}

          {allOrgs.length === 0 && !orgTeamQuery.isPending && (
            <div style={{ textAlign: "center", padding: "40px", border: "1px dashed var(--border)", borderRadius: "var(--radius)", color: "var(--text-muted)" }}>
              No organizations yet. Create one to get started.
            </div>
          )}

          {activeOrg && (() => {
            const isEditing = editingOrgQuotaId === activeOrg.id;
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                {/* Org header + delete */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "16px 18px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <h3 style={{ margin: 0, fontSize: 16, fontWeight: "bold" }}>{activeOrg.name}</h3>
                      <span style={{ fontSize: 10, background: activeOrg.plan === "enterprise" ? "rgba(16,185,129,0.15)" : activeOrg.plan === "business" ? "rgba(168,85,247,0.15)" : "var(--surface2)", color: activeOrg.plan === "enterprise" ? "#10b981" : activeOrg.plan === "business" ? "var(--accent)" : "var(--text-muted)", padding: "2px 8px", borderRadius: 20, fontWeight: "bold", textTransform: "uppercase" }}>
                        {activeOrg.plan}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      ID: <code style={{ color: "var(--accent)" }}>{activeOrg.id}</code> · {activeOrg.members.length} member(s) · {activeOrg.teams.length} team(s)
                    </div>
                  </div>
                  <button onClick={() => { if (confirm(`Delete ${activeOrg.name}? This removes all members, teams and quotas.`)) deleteOrgMut.mutate(activeOrg.id); }}
                    style={{ padding: "4px 10px", background: "transparent", color: "var(--error)", border: "1px solid transparent", borderRadius: "var(--radius)", cursor: "pointer", fontSize: 12 }}
                    onMouseEnter={(e) => { (e.target as HTMLElement).style.background = "rgba(239,68,68,0.1)"; (e.target as HTMLElement).style.borderColor = "rgba(239,68,68,0.2)"; }}
                    onMouseLeave={(e) => { (e.target as HTMLElement).style.background = "transparent"; (e.target as HTMLElement).style.borderColor = "transparent"; }}>
                    Delete
                  </button>
                </div>

                {/* Members + invite */}
                <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "18px", display: "flex", flexDirection: "column", gap: 12 }}>
                  <h4 style={{ margin: 0, fontSize: 14, fontWeight: "bold" }}>Members</h4>
                  <InviteForm label="Add Member by Email" email={orgInviteEmail} setEmail={setOrgInviteEmail} role={orgInviteRole} setRole={(v) => setOrgInviteRole(v as "admin" | "member")} roles={["member", "admin"]}
                    onSubmit={() => addOrgMemberMut.mutate({ orgId: activeOrg.id, email: orgInviteEmail, role: orgInviteRole })} loading={addOrgMemberMut.isPending} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {activeOrg.members.map((m: any) => (
                      <MemberRow key={m.userId} member={m} roles={["member", "admin", "owner"]}
                        onUpdateRole={(uid, role) => updateOrgRoleMut.mutate({ orgId: activeOrg.id, userId: uid, role: role as any })}
                        onRemove={(uid) => removeOrgMemberMut.mutate({ orgId: activeOrg.id, userId: uid })}
                        isUpdating={updateOrgRoleMut.isPending} isRemoving={removeOrgMemberMut.isPending} currentUserRole={activeOrg.role} />
                    ))}
                  </div>
                </div>

                {/* Quotas */}
                <div style={{ background: "var(--surface2)", borderRadius: 10, padding: "14px 16px", border: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <span style={{ fontSize: 12, fontWeight: "bold", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Monthly Quotas</span>
                    {!isEditing ? (
                      <button onClick={() => { setEditingOrgQuotaId(activeOrg.id); setEditMemories(orgQuotaData?.monthlyMemories ?? 100); setEditRecalls(orgQuotaData?.monthlyRecalls ?? 1000); setEditCommits(orgQuotaData?.monthlyCommits ?? 500); }}
                        style={{ padding: "4px 8px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: 11, cursor: "pointer", color: "var(--text-muted)" }}>
                        Edit Quotas
                      </button>
                    ) : (
                      <div style={{ display: "flex", gap: 5 }}>
                        <button onClick={() => updateQuotaMut.mutate({ orgId: activeOrg.id, monthlyMemories: editMemories, monthlyRecalls: editRecalls, monthlyCommits: editCommits })} disabled={updateQuotaMut.isPending}
                          style={{ padding: "4px 8px", background: "var(--accent)", color: "white", border: "none", borderRadius: "var(--radius)", fontSize: 11, cursor: "pointer", fontWeight: "bold" }}>
                          {updateQuotaMut.isPending ? "Saving..." : "Save"}
                        </button>
                        <button onClick={() => setEditingOrgQuotaId(null)} style={{ padding: "4px 8px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: 11, cursor: "pointer", color: "var(--text-muted)" }}>Cancel</button>
                      </div>
                    )}
                  </div>
                  {!isEditing ? (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                      {[["Memories", orgQuotaData?.monthlyMemories], ["Recalls", orgQuotaData?.monthlyRecalls], ["Commits", orgQuotaData?.monthlyCommits]].map(([label, val]: any) => (
                        <div key={label} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{label} Max</span>
                          <span style={{ fontSize: 14, fontWeight: "bold" }}>{val}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                      {([["Memories Max", editMemories, setEditMemories], ["Recalls Max", editRecalls, setEditRecalls], ["Commits Max", editCommits, setEditCommits]] as [string, number, (v: number) => void][]).map(([label, val, setter]) => (
                        <div key={label}>
                          <span style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>{label}</span>
                          <input type="number" value={val} onChange={(e) => setter(Number(e.target.value))} style={{ width: "100%", padding: "5px 8px", fontSize: 12, borderRadius: 4 }} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {showCreateOrg && (
            <CreateOrgModal onClose={() => setShowCreateOrg(false)} onSubmit={(name) => createOrgMut.mutate(name)}
              loading={createOrgMut.isPending} nameValue={newOrgName} onNameChange={setNewOrgName} />
          )}
        </OrgAdminSection>
      )}

      {/* ── ORG BILLING ─────────────────────────────────────────────────────── */}
      {activeSection === "org-billing" && <OrgBillingSection />}

      {/* ── AUDIT LOGS ───────────────────────────────────────────────────────── */}
      {activeSection === "org-audit-logs" && <AuditLogsSection />}

      {/* ── USERS ───────────────────────────────────────────────────────────── */}
      {activeSection === "users" && (
        <OrgAdminSection title="Users Directory" description="Manage all users and their plans" icon="👥">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <input
              type="text"
              placeholder="Search users by name or email..."
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              style={{ flex: 1, padding: "10px 14px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: "var(--text)", marginRight: "12px" }}
            />
            <button
              onClick={() => { setCreateName(""); setCreateEmail(""); setCreatePassword(""); setCreatePlan("free"); setIsCreateModalOpen(true); }}
              style={{ padding: "8px 16px", background: "var(--accent)", color: "white", border: "none", borderRadius: "var(--radius)", fontWeight: "bold", fontSize: "13px", cursor: "pointer", whiteSpace: "nowrap" }}
            >
              Create User
            </button>
          </div>

          {usersQuery.isPending && <p>Loading users...</p>}
          {usersQuery.isError && <p style={{ color: "var(--error)" }}>Failed to load users: {String(usersQuery.error)}</p>}
          {usersQuery.data && (
            <div style={{ width: "100%", overflowX: "auto", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    {["User", "Pricing Plan", "Organizations", "Memories", "Joined", "Actions"].map((h, i) => (
                      <th key={h} style={{ padding: "12px 16px", color: "var(--text-muted)", fontSize: "11px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: i === 3 ? "center" : i === 5 ? "right" : "left" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: "center", padding: "32px", color: "var(--text-muted)", fontStyle: "italic" }}>
                        No users found matching search criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((user) => (
                      <tr key={user.id} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: "14px 16px" }}>
                          <div style={{ fontWeight: "bold", fontSize: "14px" }}>{user.name}</div>
                          <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>{user.email}</div>
                          {user.id === adminStatus?.userId && (
                            <span style={{ fontSize: "9px", background: "rgba(168,85,247,0.15)", color: "var(--accent)", padding: "1px 6px", borderRadius: "10px", fontWeight: "bold", display: "inline-block", marginTop: "4px" }}>ADMIN</span>
                          )}
                        </td>
                        <td style={{ padding: "14px 16px" }}>
                          <span style={{
                            fontSize: "10px",
                            background: user.plan === "enterprise" ? "rgba(16,185,129,0.15)" : user.plan === "business" ? "rgba(168,85,247,0.15)" : "var(--surface2)",
                            color: user.plan === "enterprise" ? "#10b981" : user.plan === "business" ? "var(--accent)" : "var(--text-muted)",
                            padding: "2px 8px", borderRadius: "20px", fontWeight: "bold", textTransform: "uppercase",
                          }}>
                            {user.plan}
                          </span>
                        </td>
                        <td style={{ padding: "14px 16px" }}>
                          {user.organizations.length === 0 ? (
                            <span style={{ fontSize: "11px", color: "var(--text-muted)", fontStyle: "italic" }}>None</span>
                          ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                              {user.organizations.map((org) => (
                                <div key={org.id} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                  <span style={{ fontSize: "11px", fontWeight: 600 }}>{org.name}</span>
                                  <span style={{
                                    fontSize: "9px",
                                    background: org.role === "owner" ? "rgba(239,68,68,0.1)" : org.role === "admin" ? "rgba(168,85,247,0.1)" : "var(--surface2)",
                                    color: org.role === "owner" ? "var(--error)" : org.role === "admin" ? "var(--accent)" : "var(--text-muted)",
                                    padding: "1px 4px", borderRadius: "4px", fontWeight: 600, textTransform: "uppercase",
                                  }}>
                                    {org.role}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "14px 16px", textAlign: "center", fontWeight: 600, color: "var(--accent)" }}>{user.memoryCount}</td>
                        <td style={{ padding: "14px 16px", fontSize: "12px", color: "var(--text-muted)" }}>{new Date(user.createdAt).toLocaleDateString()}</td>
                        <td style={{ padding: "14px 16px", textAlign: "right" }}>
                          <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end", flexWrap: "wrap" }}>
                            <button onClick={() => { setSelectedUser(user); setEditName(user.name); setEditEmail(user.email); setEditEmailVerified(user.emailVerified); setIsEditModalOpen(true); }}
                              style={{ padding: "4px 8px", background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: "11px", fontWeight: 600, cursor: "pointer" }}>Edit</button>
                            <button onClick={() => { setSelectedUser(user); setSelectedPlan(user.plan); setIsPlanModalOpen(true); }}
                              style={{ padding: "4px 8px", background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: "11px", fontWeight: 600, cursor: "pointer" }}>Plan</button>
                            <button onClick={() => { setSelectedUser(user); setIsOrgsModalOpen(true); setAssignOrgId(""); setAssignRole("member"); }}
                              style={{ padding: "4px 8px", background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: "11px", fontWeight: 600, cursor: "pointer" }}>Orgs</button>
                            <button onClick={() => { setSelectedUser(user); setPasswordValue(""); setIsPasswordModalOpen(true); }}
                              style={{ padding: "4px 8px", background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: "11px", fontWeight: 600, cursor: "pointer" }}>Password</button>
                            <button onClick={() => { if (confirm(`Reset password for ${user.name}? A new random password will be generated.`)) resetUserPasswordMut.mutate(user.id); }}
                              style={{ padding: "4px 8px", background: "var(--surface2)", color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: "11px", cursor: "pointer" }}>Reset</button>
                            {user.id !== adminStatus?.userId && (
                              <button onClick={() => { if (confirm(`DELETE user ${user.name}? This will delete all their data permanently.`)) deleteUserMut.mutate(user.id); }}
                                style={{ padding: "4px 8px", background: "rgba(239,68,68,0.1)", color: "var(--error)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "var(--radius)", fontSize: "11px", fontWeight: "bold", cursor: "pointer" }}>Delete</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </OrgAdminSection>
      )}

      {/* ── TEAMS ───────────────────────────────────────────────────────────── */}
      {activeSection === "teams" && (
        <OrgAdminSection title="Teams" description="Create teams within organizations and manage members" icon="👤">
          {orgTeamQuery.isPending && <p style={{ color: "var(--text-muted)" }}>Loading...</p>}
          {orgTeamQuery.isError && <p style={{ color: "var(--error)" }}>Failed to load teams.</p>}

          {/* Create team — pick org first */}
          {allOrgs.length > 0 && (
            <AdminCard>
              <h4 style={{ margin: "0 0 12px 0", fontSize: 14, fontWeight: "bold" }}>Create New Team</h4>
              <div style={{ display: "flex", gap: 8 }}>
                <select value={selectedOrgKey || allOrgs[0]?.id} onChange={(e) => setSelectedOrgKey(e.target.value)}
                  style={{ padding: "7px 10px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: 13 }}>
                  {allOrgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
                <input type="text" placeholder="Team name" value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)}
                  style={{ flex: 1, padding: "7px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: 13 }} />
                <button onClick={() => { const orgId = selectedOrgKey || allOrgs[0]?.id; if (orgId && newTeamName.trim()) createTeamMut.mutate({ orgId, name: newTeamName }); }}
                  disabled={createTeamMut.isPending || !newTeamName.trim()}
                  style={{ padding: "7px 16px", background: "var(--accent)", color: "white", border: "none", borderRadius: "var(--radius)", fontWeight: 600, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}>
                  {createTeamMut.isPending ? "Creating..." : "+ Create Team"}
                </button>
              </div>
            </AdminCard>
          )}

          {/* Team list — pick team to manage */}
          {allTeams.length === 0 && !orgTeamQuery.isPending && (
            <div style={{ textAlign: "center", padding: "40px", border: "1px dashed var(--border)", borderRadius: "var(--radius)", color: "var(--text-muted)" }}>
              No teams yet. Create one above.
            </div>
          )}

          {allTeams.length > 0 && (
            <>
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8 }}>
                <select value={activeTeam?.id ?? allTeams[0]?.id} onChange={(e) => setSelectedTeamKey(e.target.value)}
                  style={{ flex: 1, padding: "8px 12px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontWeight: 600 }}>
                  {allTeams.map((t) => <option key={t.id} value={t.id}>{t.orgName} › {t.name}</option>)}
                </select>
              </div>

              {(() => {
                const team = activeTeam ?? allTeams[0];
                if (!team) return null;
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12 }}>
                      <div>
                        <div style={{ fontWeight: "bold", fontSize: 15 }}>{team.name}</div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{team.orgName} · {team.members.length} members · Role: <strong>{team.role}</strong></div>
                      </div>
                      {team.role !== "member" && (
                        <button onClick={() => { if (confirm(`Delete team "${team.name}"?`)) deleteTeamMut.mutate(team.id); }} disabled={deleteTeamMut.isPending}
                          style={{ padding: "5px 12px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "var(--error)", fontSize: 12, cursor: "pointer", borderRadius: "var(--radius)" }}>
                          Delete Team
                        </button>
                      )}
                    </div>

                    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
                      <h4 style={{ margin: 0, fontSize: 14, fontWeight: "bold" }}>Members</h4>
                      {team.role !== "member" && (
                        <InviteForm label="Add Member by Email" email={teamInviteEmail} setEmail={setTeamInviteEmail} role={teamInviteRole} setRole={setTeamInviteRole} roles={["member", "admin"]}
                          onSubmit={() => addTeamMemberMut.mutate({ teamId: team.id, email: teamInviteEmail, role: teamInviteRole })} loading={addTeamMemberMut.isPending} />
                      )}
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {team.members.map((m: any) => (
                          <MemberRow key={m.userId} member={m} roles={["member", "admin"]}
                            onUpdateRole={(uid, role) => updateTeamRoleMut.mutate({ teamId: team.id, userId: uid, role })}
                            onRemove={(uid) => removeTeamMemberMut.mutate({ teamId: team.id, userId: uid })}
                            isUpdating={updateTeamRoleMut.isPending} isRemoving={removeTeamMemberMut.isPending} currentUserRole={team.role} />
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </>
          )}
        </OrgAdminSection>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          MODALS
      ══════════════════════════════════════════════════════════════════════ */}

      {/* Create User */}
      {isCreateModalOpen && (
        <div style={modalOverlay}>
          <div style={modalBox}>
            <h3 style={{ margin: "0 0 16px 0", fontSize: "16px", fontWeight: "bold" }}>Create New User</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {[
                { label: "Full Name", type: "text", value: createName, setter: setCreateName, placeholder: "e.g. John Doe" },
                { label: "Email Address", type: "email", value: createEmail, setter: setCreateEmail, placeholder: "e.g. john@example.com" },
                { label: "Initial Password (Optional)", type: "password", value: createPassword, setter: setCreatePassword, placeholder: "Leave blank for passwordless OAuth" },
              ].map(({ label, type, value, setter, placeholder }) => (
                <div key={label}>
                  <label style={{ display: "block", fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px", fontWeight: "bold", textTransform: "uppercase" }}>{label}</label>
                  <input type={type} value={value} onChange={(e) => setter(e.target.value)} placeholder={placeholder} style={{ width: "100%", padding: "8px 12px" }} />
                </div>
              ))}
              <div>
                <label style={{ display: "block", fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px", fontWeight: "bold", textTransform: "uppercase" }}>Personal Pricing Plan</label>
                <select value={createPlan} onChange={(e) => setCreatePlan(e.target.value)} style={{ width: "100%", padding: "8px 12px" }}>
                  <option value="free">Free (Personal)</option>
                  <option value="business">Business</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>
            </div>
            <div style={{ display: "flex", gap: "10px", marginTop: "24px", justifyContent: "flex-end" }}>
              <button onClick={() => setIsCreateModalOpen(false)} style={{ padding: "8px 16px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-muted)", fontWeight: 600 }}>Cancel</button>
              <button onClick={() => { if (!createName || !createEmail) { alert("Name and email are required."); return; } createUserMut.mutate({ name: createName, email: createEmail, password: createPassword || undefined, plan: createPlan }); }}
                disabled={createUserMut.isPending} style={{ padding: "8px 16px", background: "var(--accent)", color: "white", fontWeight: "bold" }}>
                {createUserMut.isPending ? "Creating..." : "Create User"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit User */}
      {isEditModalOpen && selectedUser && (
        <div style={modalOverlay}>
          <div style={modalBox}>
            <h3 style={{ margin: "0 0 16px 0", fontSize: "16px", fontWeight: "bold" }}>Edit User</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div>
                <label style={{ display: "block", fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px", fontWeight: "bold", textTransform: "uppercase" }}>Full Name</label>
                <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} style={{ width: "100%", padding: "8px 12px" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px", fontWeight: "bold", textTransform: "uppercase" }}>Email Address</label>
                <input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} style={{ width: "100%", padding: "8px 12px" }} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" }}>
                <input type="checkbox" id="edit-email-verified" checked={editEmailVerified} onChange={(e) => setEditEmailVerified(e.target.checked)} style={{ width: "auto" }} />
                <label htmlFor="edit-email-verified" style={{ fontSize: "13px", fontWeight: 500 }}>Email Verified</label>
              </div>
            </div>
            <div style={{ display: "flex", gap: "10px", marginTop: "24px", justifyContent: "flex-end" }}>
              <button onClick={() => setIsEditModalOpen(false)} style={{ padding: "8px 16px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-muted)", fontWeight: 600 }}>Cancel</button>
              <button onClick={() => { if (!editName || !editEmail) { alert("Name and email are required."); return; } updateUserMut.mutate({ userId: selectedUser.id, name: editName, email: editEmail, emailVerified: editEmailVerified }); }}
                disabled={updateUserMut.isPending} style={{ padding: "8px 16px", background: "var(--accent)", color: "white", fontWeight: "bold" }}>
                {updateUserMut.isPending ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Change Plan */}
      {isPlanModalOpen && selectedUser && (
        <div style={modalOverlay}>
          <div style={{ ...modalBox, maxWidth: "400px" }}>
            <h3 style={{ margin: "0 0 8px 0", fontSize: "16px", fontWeight: "bold" }}>Change Plan</h3>
            <p style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "16px" }}>Assign pricing plan for <strong>{selectedUser.name}</strong>.</p>
            <div>
              <label style={{ display: "block", fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px", fontWeight: "bold", textTransform: "uppercase" }}>Plan</label>
              <select value={selectedPlan} onChange={(e) => setSelectedPlan(e.target.value)} style={{ width: "100%", padding: "8px 12px" }}>
                <option value="free">Free (Personal)</option>
                <option value="business">Business</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
            <div style={{ display: "flex", gap: "10px", marginTop: "24px", justifyContent: "flex-end" }}>
              <button onClick={() => setIsPlanModalOpen(false)} style={{ padding: "8px 16px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-muted)", fontWeight: 600 }}>Cancel</button>
              <button onClick={() => updateUserPlanMut.mutate({ userId: selectedUser.id, plan: selectedPlan })} disabled={updateUserPlanMut.isPending}
                style={{ padding: "8px 16px", background: "var(--accent)", color: "white", fontWeight: "bold" }}>
                {updateUserPlanMut.isPending ? "Updating..." : "Update Plan"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Set Password */}
      {isPasswordModalOpen && selectedUser && (
        <div style={modalOverlay}>
          <div style={{ ...modalBox, maxWidth: "400px" }}>
            <h3 style={{ margin: "0 0 8px 0", fontSize: "16px", fontWeight: "bold" }}>Set Password</h3>
            <p style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "16px" }}>Set a manual password for <strong>{selectedUser.name}</strong>.</p>
            <div>
              <label style={{ display: "block", fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px", fontWeight: "bold", textTransform: "uppercase" }}>New Password</label>
              <input type="password" value={passwordValue} onChange={(e) => setPasswordValue(e.target.value)} placeholder="At least 8 characters" style={{ width: "100%", padding: "8px 12px" }} />
            </div>
            <div style={{ display: "flex", gap: "10px", marginTop: "24px", justifyContent: "flex-end" }}>
              <button onClick={() => setIsPasswordModalOpen(false)} style={{ padding: "8px 16px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-muted)", fontWeight: 600 }}>Cancel</button>
              <button onClick={() => { if (passwordValue.length < 8) { alert("Password must be at least 8 characters."); return; } setUserPasswordMut.mutate({ userId: selectedUser.id, password: passwordValue }); }}
                disabled={setUserPasswordMut.isPending} style={{ padding: "8px 16px", background: "var(--accent)", color: "white", fontWeight: "bold" }}>
                {setUserPasswordMut.isPending ? "Setting..." : "Set Password"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Password Success */}
      {isResetSuccessModalOpen && (
        <div style={{ ...modalOverlay, zIndex: 1010 }}>
          <div style={modalBox}>
            <h3 style={{ margin: "0 0 12px 0", fontSize: "16px", fontWeight: "bold", color: "var(--success)" }}>Password Reset Success</h3>
            <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "16px" }}>A new temporary password has been generated:</p>
            <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", padding: "12px 16px", borderRadius: "8px", fontFamily: "monospace", fontSize: "18px", textAlign: "center", color: "var(--text)", letterSpacing: "0.08em", fontWeight: "bold", marginBottom: "20px" }}>
              {generatedPassword}
            </div>
            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
              <button onClick={() => { navigator.clipboard.writeText(generatedPassword); alert("Copied to clipboard!"); }}
                style={{ padding: "8px 16px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", fontWeight: 600 }}>Copy Password</button>
              <button onClick={() => { setIsResetSuccessModalOpen(false); setGeneratedPassword(""); }}
                style={{ padding: "8px 16px", background: "var(--accent)", color: "white", fontWeight: "bold" }}>Done</button>
            </div>
          </div>
        </div>
      )}

      {/* Manage Organizations */}
      {isOrgsModalOpen && selectedUser && (
        <div style={modalOverlay}>
          <div style={{ ...modalBox, maxWidth: "500px" }}>
            <h3 style={{ margin: "0 0 8px 0", fontSize: "16px", fontWeight: "bold" }}>Manage Organizations</h3>
            <p style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "16px" }}>Organization memberships for <strong>{selectedUser.name}</strong>.</p>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxHeight: "200px", overflowY: "auto", marginBottom: "20px", border: "1px solid var(--border)", borderRadius: "8px", padding: "10px", background: "var(--surface2)" }}>
              <span style={{ fontSize: "11px", fontWeight: "bold", color: "var(--text-muted)", textTransform: "uppercase" }}>Current Memberships</span>
              {selectedUser.organizations.length === 0 ? (
                <span style={{ fontSize: "12px", color: "var(--text-muted)", fontStyle: "italic", padding: "8px 0" }}>Not a member of any organization.</span>
              ) : (
                selectedUser.organizations.map((org) => (
                  <div key={org.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "6px" }}>
                    <div>
                      <div style={{ fontWeight: "bold", fontSize: "13px" }}>{org.name}</div>
                      <div style={{ fontSize: "10px", color: "var(--text-muted)" }}>ID: {org.id}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <select value={org.role} onChange={(e) => {
                        assignUserToOrgMut.mutate({ userId: selectedUser.id, orgId: org.id, role: e.target.value as "owner" | "admin" | "member" });
                        setSelectedUser({ ...selectedUser, organizations: selectedUser.organizations.map(o => o.id === org.id ? { ...o, role: e.target.value } : o) });
                      }} style={{ padding: "3px 6px", fontSize: "11px", borderRadius: "4px" }}>
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                        <option value="owner">Owner</option>
                      </select>
                      <button onClick={() => { if (confirm(`Remove ${selectedUser.name} from ${org.name}?`)) { removeUserFromOrgMut.mutate({ userId: selectedUser.id, orgId: org.id }); setSelectedUser({ ...selectedUser, organizations: selectedUser.organizations.filter(o => o.id !== org.id) }); } }}
                        style={{ padding: "4px 8px", background: "transparent", color: "var(--error)", fontSize: "11px", fontWeight: "bold", cursor: "pointer" }}>Remove</button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div style={{ borderTop: "1px solid var(--border)", paddingTop: "16px" }}>
              <span style={{ display: "block", fontSize: "11px", fontWeight: "bold", color: "var(--text-muted)", marginBottom: "8px", textTransform: "uppercase" }}>Add to Organization</span>
              <div style={{ display: "flex", gap: "8px" }}>
                <select value={assignOrgId} onChange={(e) => setAssignOrgId(e.target.value)} style={{ flex: 1, padding: "8px 12px" }}>
                  <option value="">Select organization...</option>
                  {(orgsQuery.data || []).filter((org) => !selectedUser.organizations.some((o) => o.id === org.id)).map((org) => (
                    <option key={org.id} value={org.id}>{org.name}</option>
                  ))}
                </select>
                <select value={assignRole} onChange={(e) => setAssignRole(e.target.value as "owner" | "admin" | "member")} style={{ padding: "8px 12px" }}>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                  <option value="owner">Owner</option>
                </select>
                <button onClick={() => { if (!assignOrgId) return; assignUserToOrgMut.mutate({ userId: selectedUser.id, orgId: assignOrgId, role: assignRole }); const matchedName = (orgsQuery.data || []).find(o => o.id === assignOrgId)?.name || "New Organization"; setSelectedUser({ ...selectedUser, organizations: [...selectedUser.organizations, { id: assignOrgId, name: matchedName, role: assignRole }] }); setAssignOrgId(""); }}
                  disabled={!assignOrgId || assignUserToOrgMut.isPending}
                  style={{ padding: "8px 16px", background: "var(--accent)", color: "white", fontWeight: "bold", cursor: "pointer" }}>Add</button>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "24px" }}>
              <button onClick={() => setIsOrgsModalOpen(false)} style={{ padding: "8px 16px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-muted)", fontWeight: 600 }}>Close</button>
            </div>
          </div>
        </div>
      )}

    </AdminLayout>
  );
}



export function AdminGuard() {
  const { data: adminStatus, isLoading } = useQuery({
    queryKey: ["admin-status"],
    queryFn: () => getAdminStatus(),
  });

  if (isLoading) return <p style={{ padding: 32, color: "var(--text-muted)" }}>Loading…</p>;

  return <AdminPage />;
}

