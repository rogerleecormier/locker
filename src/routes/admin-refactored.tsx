import { createFileRoute } from "@tanstack/react-router";
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
  nukeEverything,
  scanDatabaseDuplicates,
  bulkDeleteMemories,
  encryptAllMemories,
  rebuildVectorizeIndex,
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
  type DuplicateGroup,
  type UserDetails,
  type OrgWithQuota,
} from "~/routes/admin";

function AdminPage() {
  const [activeSection, setActiveSection] = useState<AdminSection>("system");

  // System stats
  const statsQuery = useQuery({
    queryKey: ["admin-stats"],
    queryFn: async () => (await import("~/routes/admin")).getDbStats(),
    refetchInterval: 5000,
  });

  const debugQuery = useQuery({
    queryKey: ["admin-debug"],
    queryFn: async () => (await import("~/routes/admin")).getVectorizeDebug(),
    refetchInterval: 10000,
  });

  // Organizations
  const orgsQuery = useQuery({
    queryKey: ["admin-orgs"],
    queryFn: () => listAllOrgsAndQuotas(),
    enabled: activeSection === "orgs" || activeSection === "users",
  });

  // Users
  const usersQuery = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => listAllUsersAndDetails(),
    enabled: activeSection === "users",
  });

  // Admin status
  const { data: adminStatus } = useQuery({
    queryKey: ["admin-status"],
    queryFn: () => getAdminStatus(),
  });

  // Mutations
  const clearDbMutation = useMutation({
    mutationFn: clearDatabase,
    onSuccess: () => {
      statsQuery.refetch();
      debugQuery.refetch();
    },
  });

  const clearVectorizeMutation = useMutation({
    mutationFn: clearVectorizeIndex,
    onSuccess: () => {
      statsQuery.refetch();
      debugQuery.refetch();
    },
  });

  const clearAllMutation = useMutation({
    mutationFn: nukeEverything,
    onSuccess: () => {
      statsQuery.refetch();
      debugQuery.refetch();
    },
  });

  // State for modals and confirmations
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmClearVectorize, setConfirmClearVectorize] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  return (
    <AdminLayout activeSection={activeSection} onSectionChange={setActiveSection}>
      {/* SYSTEM OVERVIEW */}
      {activeSection === "system" && (
        <>
          <SiteAdminSection
            title="Database Statistics"
            description="Real-time metrics for your system storage"
            icon="📊"
          >
            {statsQuery.isPending && <p>Loading stats...</p>}
            {statsQuery.isError && (
              <p style={{ color: "var(--error)" }}>Failed to load stats</p>
            )}
            {statsQuery.data && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
                <StatBox label="Memories in D1" value={statsQuery.data.memoryCount} />
                <StatBox label="Vectors in Vectorize" value={statsQuery.data.vectorCount} />
              </div>
            )}
          </SiteAdminSection>

          <SiteAdminSection
            title="Vector Index Health"
            description="Check for orphaned or missing vectors"
            icon="🔍"
          >
            {debugQuery.data?.vectors?.length ? (
              <AdminCard status="error">
                <p style={{ margin: "0 0 12px 0", fontWeight: 600, color: "var(--error)" }}>
                  Found {debugQuery.data.vectors.length} orphaned vectors
                </p>
                <p style={{ fontSize: "13px", color: "var(--text-muted)", margin: 0 }}>
                  These are D1 records without matching vectors. Consider running a rebuild.
                </p>
              </AdminCard>
            ) : (
              <AdminCard status="success">
                <p style={{ margin: 0, fontWeight: 600, color: "var(--success)" }}>
                  ✓ No orphaned vectors detected
                </p>
              </AdminCard>
            )}
          </SiteAdminSection>

          <SiteAdminSection
            title="Destructive Operations"
            description="Dangerous actions that cannot be undone"
            icon="⚠️"
          >
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
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
                    borderRadius: "8px",
                    fontWeight: "bold",
                    cursor: "pointer",
                  }}
                >
                  Clear Vectorize
                </button>
                {confirmClearVectorize && (
                  <AdminCard status="warning">
                    <p style={{ fontSize: "12px", marginBottom: "8px" }}>
                      Delete all vectors from Vectorize (keeps D1 data)?
                    </p>
                    <div style={{ display: "flex", gap: "5px" }}>
                      <button
                        onClick={() => {
                          clearVectorizeMutation.mutate({});
                          setConfirmClearVectorize(false);
                        }}
                        style={{ flex: 1, padding: "6px", background: "var(--error)", color: "white" }}
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setConfirmClearVectorize(false)}
                        style={{ flex: 1, padding: "6px", background: "var(--surface2)" }}
                      >
                        Cancel
                      </button>
                    </div>
                  </AdminCard>
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
                    borderRadius: "8px",
                    fontWeight: "bold",
                    cursor: "pointer",
                  }}
                >
                  Clear Database
                </button>
                {confirmClear && (
                  <AdminCard status="warning">
                    <p style={{ fontSize: "12px", marginBottom: "8px" }}>
                      Delete all memories from D1 and Vectorize?
                    </p>
                    <div style={{ display: "flex", gap: "5px" }}>
                      <button
                        onClick={() => {
                          clearDbMutation.mutate({});
                          setConfirmClear(false);
                        }}
                        style={{ flex: 1, padding: "6px", background: "var(--error)", color: "white" }}
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setConfirmClear(false)}
                        style={{ flex: 1, padding: "6px", background: "var(--surface2)" }}
                      >
                        Cancel
                      </button>
                    </div>
                  </AdminCard>
                )}
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <button
                  onClick={() => setConfirmClearAll(true)}
                  disabled={clearAllMutation.isPending}
                  style={{
                    width: "100%",
                    padding: "12px",
                    background: "rgba(239,68,68,0.15)",
                    border: "2px solid rgba(239,68,68,0.5)",
                    color: "var(--error)",
                    borderRadius: "8px",
                    fontWeight: "bold",
                    fontSize: "14px",
                    cursor: "pointer",
                  }}
                >
                  🔥 NUKE: Clear Everything
                </button>
                {confirmClearAll && (
                  <AdminCard status="error">
                    <p style={{ fontSize: "13px", marginBottom: "8px", fontWeight: "bold" }}>
                      Delete ALL memories from both D1 and Vectorize. This cannot be undone!
                    </p>
                    <div style={{ display: "flex", gap: "5px" }}>
                      <button
                        onClick={() => {
                          clearAllMutation.mutate({});
                          setConfirmClearAll(false);
                        }}
                        style={{ flex: 1, padding: "8px", background: "var(--error)", color: "white", fontWeight: "bold" }}
                      >
                        NUKE IT
                      </button>
                      <button
                        onClick={() => setConfirmClearAll(false)}
                        style={{ flex: 1, padding: "8px", background: "var(--surface2)" }}
                      >
                        Cancel
                      </button>
                    </div>
                  </AdminCard>
                )}
              </div>
            </div>
          </SiteAdminSection>
        </>
      )}

      {/* SITE CONFIGURATION */}
      {activeSection === "site-config" && (
        <SiteAdminSection
          title="Site Configuration"
          description="Global settings and configuration"
          icon="🔧"
        >
          <AdminCard>
            <p style={{ color: "var(--text-muted)", margin: 0 }}>
              Configuration options coming soon...
            </p>
          </AdminCard>
        </SiteAdminSection>
      )}

      {/* BILLING MANAGEMENT */}
      {activeSection === "billing-manage" && (
        <SiteAdminSection
          title="Billing Management"
          description="Manage subscription metrics and revenue"
          icon="💳"
        >
          <AdminCard>
            <p style={{ color: "var(--text-muted)", margin: 0 }}>
              Billing dashboard coming soon...
            </p>
          </AdminCard>
        </SiteAdminSection>
      )}

      {/* ORGANIZATIONS */}
      {activeSection === "orgs" && (
        <OrgAdminSection
          title="Global Organizations"
          description="Manage all organizations and their quotas"
          icon="🏢"
        >
          {orgsQuery.isPending && <p>Loading organizations...</p>}
          {orgsQuery.isError && (
            <p style={{ color: "var(--error)" }}>Failed to load organizations</p>
          )}
          {orgsQuery.data && orgsQuery.data.length === 0 && (
            <AdminCard>
              <p style={{ color: "var(--text-muted)", margin: 0, textAlign: "center" }}>
                No organizations created yet
              </p>
            </AdminCard>
          )}
          {orgsQuery.data && (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {orgsQuery.data.map((org) => (
                <AdminCard key={org.id}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <h3 style={{ margin: "0 0 4px 0", fontSize: "14px", fontWeight: "bold" }}>
                        {org.name}
                      </h3>
                      <p style={{ margin: "4px 0 0 0", fontSize: "11px", color: "var(--text-muted)" }}>
                        {org.memberCount} members · {org.plan} plan
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        if (confirm(`Delete organization ${org.name}?`)) {
                          deleteOrganization({ data: { id: org.id } });
                        }
                      }}
                      style={{
                        padding: "4px 8px",
                        background: "transparent",
                        color: "var(--error)",
                        border: "1px solid transparent",
                        fontSize: "12px",
                        cursor: "pointer",
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </AdminCard>
              ))}
            </div>
          )}
        </OrgAdminSection>
      )}

      {/* USERS */}
      {activeSection === "users" && (
        <OrgAdminSection
          title="Users Directory"
          description="Manage all users and their plans"
          icon="👥"
        >
          {usersQuery.isPending && <p>Loading users...</p>}
          {usersQuery.isError && (
            <p style={{ color: "var(--error)" }}>Failed to load users</p>
          )}
          {usersQuery.data && usersQuery.data.length === 0 && (
            <AdminCard>
              <p style={{ color: "var(--text-muted)", margin: 0, textAlign: "center" }}>
                No users found
              </p>
            </AdminCard>
          )}
          {usersQuery.data && (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {usersQuery.data.map((user) => (
                <AdminCard key={user.id}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <h3 style={{ margin: "0 0 4px 0", fontSize: "14px", fontWeight: "bold" }}>
                        {user.name}
                      </h3>
                      <p style={{ margin: "4px 0 0 0", fontSize: "11px", color: "var(--text-muted)" }}>
                        {user.email} · {user.plan} · {user.memoryCount} memories
                      </p>
                    </div>
                    <div style={{ display: "flex", gap: "4px" }}>
                      <button
                        style={{
                          padding: "4px 8px",
                          background: "var(--surface2)",
                          border: "1px solid var(--border)",
                          borderRadius: "4px",
                          fontSize: "11px",
                          cursor: "pointer",
                        }}
                      >
                        Edit
                      </button>
                      <button
                        style={{
                          padding: "4px 8px",
                          background: "var(--surface2)",
                          border: "1px solid var(--border)",
                          borderRadius: "4px",
                          fontSize: "11px",
                          cursor: "pointer",
                        }}
                      >
                        Plan
                      </button>
                      {user.id !== adminStatus?.userId && (
                        <button
                          style={{
                            padding: "4px 8px",
                            background: "rgba(239,68,68,0.1)",
                            border: "1px solid rgba(239,68,68,0.2)",
                            color: "var(--error)",
                            borderRadius: "4px",
                            fontSize: "11px",
                            cursor: "pointer",
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                </AdminCard>
              ))}
            </div>
          )}
        </OrgAdminSection>
      )}

      {/* TEAMS */}
      {activeSection === "teams" && (
        <OrgAdminSection
          title="Teams Management"
          description="Manage team structure and permissions"
          icon="👤"
        >
          <AdminCard>
            <p style={{ color: "var(--text-muted)", margin: 0 }}>
              Teams management coming soon...
            </p>
          </AdminCard>
        </OrgAdminSection>
      )}
    </AdminLayout>
  );
}

function AdminGuard() {
  const { data: adminStatus, isLoading, error } = useQuery({
    queryKey: ["admin-status"],
    queryFn: () => getAdminStatus(),
  });

  if (isLoading) return <p style={{ padding: 32, color: "var(--text-muted)" }}>Loading…</p>;

  if (error || !adminStatus?.isAdmin) {
    return (
      <div style={{ padding: 32, textAlign: "center" }}>
        <p style={{ color: "var(--error)", fontSize: 16, fontWeight: 600 }}>403 — Not authorized</p>
        <p style={{ color: "var(--text-muted)", marginTop: 8, fontSize: 13 }}>
          This page is restricted to the admin account.
        </p>
      </div>
    );
  }

  return <AdminPage />;
}

export const Route = createFileRoute("/admin")({
  component: AdminGuard,
});
