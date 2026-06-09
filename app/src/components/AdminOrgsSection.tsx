import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "~/components/ui/toast";
import { listAllOrgsAndQuotas, updateOrgQuota, deleteOrganization } from "~/routes/admin";
import {
  getUserOrgsAndTeams, createOrganizationSelfServe,
  addOrgMemberByEmail, updateOrgMemberRole, removeOrgMember,
  MemberRow, InviteForm, CreateOrgModal,
} from "~/routes/organization";
import { OrgAdminSection } from "~/components/AdminSections";

export function AdminOrgsSection() {
  const toast = useToast();
  const qc = useQueryClient();

  const [selectedOrgKey, setSelectedOrgKey] = useState<string>("");
  const [orgInviteEmail, setOrgInviteEmail] = useState("");
  const [orgInviteRole, setOrgInviteRole] = useState<"admin" | "member">("member");
  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [editingOrgQuotaId, setEditingOrgQuotaId] = useState<string | null>(null);
  const [editMemories, setEditMemories] = useState(100);
  const [editRecalls, setEditRecalls] = useState(1000);
  const [editCommits, setEditCommits] = useState(500);

  const orgTeamQuery = useQuery({
    queryKey: ["admin-orgs-teams"],
    queryFn: () => getUserOrgsAndTeams(),
    refetchInterval: 30_000,
  });

  const orgsQuery = useQuery({
    queryKey: ["admin-orgs"],
    queryFn: () => listAllOrgsAndQuotas(),
    refetchInterval: 30_000,
  });

  const refetch = () => {
    qc.invalidateQueries({ queryKey: ["admin-orgs-teams"] });
    qc.invalidateQueries({ queryKey: ["admin-orgs"] });
  };
  const mutOpts = { onSuccess: refetch, onError: (err: Error) => toast.error(err.message) };

  const createOrgMut = useMutation({
    mutationFn: (name: string) => createOrganizationSelfServe({ data: { name } }),
    onSuccess: (res) => { setShowCreateOrg(false); setNewOrgName(""); setSelectedOrgKey(`org:${res.orgId}`); refetch(); },
    onError: (err: Error) => toast.error(err.message),
  });

  const addOrgMemberMut = useMutation({
    mutationFn: (data: { orgId: string; email: string; role: "admin" | "member" }) => addOrgMemberByEmail({ data }),
    onSuccess: () => { setOrgInviteEmail(""); refetch(); },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateOrgRoleMut = useMutation({
    mutationFn: (data: { orgId: string; userId: string; role: "owner" | "admin" | "member" }) => updateOrgMemberRole({ data }),
    ...mutOpts,
  });

  const removeOrgMemberMut = useMutation({
    mutationFn: (data: { orgId: string; userId: string }) => removeOrgMember({ data }),
    ...mutOpts,
  });

  const updateQuotaMut = useMutation({
    mutationFn: (data: { orgId: string; monthlyMemories: number; monthlyRecalls: number; monthlyCommits: number }) => updateOrgQuota({ data }),
    onSuccess: () => { setEditingOrgQuotaId(null); refetch(); },
    onError: (err) => toast.error("Failed to update quota: " + String(err)),
  });

  const deleteOrgMut = useMutation({
    mutationFn: (id: string) => deleteOrganization({ data: { id } }),
    onSuccess: () => refetch(),
    onError: (err) => toast.error("Failed to delete org: " + String(err)),
  });

  const allOrgs = orgTeamQuery.data?.organizations ?? [];
  const activeOrg = allOrgs.find((o) => o.id === selectedOrgKey) ?? allOrgs[0];
  const orgQuotaData = orgsQuery.data?.find((o) => o.id === activeOrg?.id);

  return (
    <OrgAdminSection title="Organizations" description="Create organizations and manage members" icon="🏢">
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
                  <OrgPlanBadge plan={activeOrg.plan} />
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  ID: <code style={{ color: "var(--accent)" }}>{activeOrg.id}</code> · {activeOrg.members.length} member(s) · {activeOrg.teams.length} team(s)
                </div>
              </div>
              <button
                onClick={() => { if (confirm(`Delete ${activeOrg.name}? This removes all members, teams and quotas.`)) deleteOrgMut.mutate(activeOrg.id); }}
                style={{ padding: "4px 10px", background: "transparent", color: "var(--error)", border: "1px solid transparent", borderRadius: "var(--radius)", cursor: "pointer", fontSize: 12 }}
                onMouseEnter={(e) => { (e.target as HTMLElement).style.background = "rgba(239,68,68,0.1)"; (e.target as HTMLElement).style.borderColor = "rgba(239,68,68,0.2)"; }}
                onMouseLeave={(e) => { (e.target as HTMLElement).style.background = "transparent"; (e.target as HTMLElement).style.borderColor = "transparent"; }}
              >
                Delete
              </button>
            </div>

            {/* Members + invite */}
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "18px", display: "flex", flexDirection: "column", gap: 12 }}>
              <h4 style={{ margin: 0, fontSize: 14, fontWeight: "bold" }}>Members</h4>
              <InviteForm
                label="Add Member by Email"
                email={orgInviteEmail} setEmail={setOrgInviteEmail}
                role={orgInviteRole} setRole={(v) => setOrgInviteRole(v as "admin" | "member")}
                roles={["member", "admin"]}
                onSubmit={() => addOrgMemberMut.mutate({ orgId: activeOrg.id, email: orgInviteEmail, role: orgInviteRole })}
                loading={addOrgMemberMut.isPending}
              />
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
                  <button
                    onClick={() => { setEditingOrgQuotaId(activeOrg.id); setEditMemories(orgQuotaData?.monthlyMemories ?? 100); setEditRecalls(orgQuotaData?.monthlyRecalls ?? 1000); setEditCommits(orgQuotaData?.monthlyCommits ?? 500); }}
                    style={{ padding: "4px 8px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: 11, cursor: "pointer", color: "var(--text-muted)" }}>
                    Edit Quotas
                  </button>
                ) : (
                  <div style={{ display: "flex", gap: 5 }}>
                    <button
                      onClick={() => updateQuotaMut.mutate({ orgId: activeOrg.id, monthlyMemories: editMemories, monthlyRecalls: editRecalls, monthlyCommits: editCommits })}
                      disabled={updateQuotaMut.isPending}
                      style={{ padding: "4px 8px", background: "var(--accent)", color: "white", border: "none", borderRadius: "var(--radius)", fontSize: 11, cursor: "pointer", fontWeight: "bold" }}>
                      {updateQuotaMut.isPending ? "Saving..." : "Save"}
                    </button>
                    <button onClick={() => setEditingOrgQuotaId(null)} style={{ padding: "4px 8px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: 11, cursor: "pointer", color: "var(--text-muted)" }}>Cancel</button>
                  </div>
                )}
              </div>
              {!isEditing ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                  {([["Memories", orgQuotaData?.monthlyMemories], ["Recalls", orgQuotaData?.monthlyRecalls], ["Commits", orgQuotaData?.monthlyCommits]] as [string, number | undefined][]).map(([label, val]) => (
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
        <CreateOrgModal
          onClose={() => setShowCreateOrg(false)}
          onSubmit={(name) => createOrgMut.mutate(name)}
          loading={createOrgMut.isPending}
          nameValue={newOrgName}
          onNameChange={setNewOrgName}
        />
      )}
    </OrgAdminSection>
  );
}

function OrgPlanBadge({ plan }: { plan: string }) {
  const bg = plan === "enterprise" ? "rgba(16,185,129,0.15)" : plan === "business" ? "rgba(168,85,247,0.15)" : "var(--surface2)";
  const color = plan === "enterprise" ? "#10b981" : plan === "business" ? "var(--accent)" : "var(--text-muted)";
  return (
    <span style={{ fontSize: 10, background: bg, color, padding: "2px 8px", borderRadius: 20, fontWeight: "bold", textTransform: "uppercase" }}>
      {plan}
    </span>
  );
}
