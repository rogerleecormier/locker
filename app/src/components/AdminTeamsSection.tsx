import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "~/components/ui/toast";
import {
  getUserOrgsAndTeams, createTeam, deleteTeam,
  addTeamMemberByEmail, updateTeamMemberRole, removeTeamMember,
  MemberRow, InviteForm,
} from "~/routes/organization";
import { OrgAdminSection, AdminCard } from "~/components/AdminSections";

export function AdminTeamsSection() {
  const toast = useToast();
  const qc = useQueryClient();

  const [selectedOrgKey, setSelectedOrgKey] = useState<string>("");
  const [selectedTeamKey, setSelectedTeamKey] = useState<string>("");
  const [teamInviteEmail, setTeamInviteEmail] = useState("");
  const [teamInviteRole, setTeamInviteRole] = useState("member");
  const [newTeamName, setNewTeamName] = useState("");

  const orgTeamQuery = useQuery({
    queryKey: ["admin-orgs-teams"],
    queryFn: () => getUserOrgsAndTeams(),
    refetchInterval: 30_000,
  });

  const refetch = () => qc.invalidateQueries({ queryKey: ["admin-orgs-teams"] });
  const mutOpts = { onSuccess: refetch, onError: (err: Error) => toast.error(err.message) };

  const createTeamMut = useMutation({
    mutationFn: (data: { orgId: string; name: string }) => createTeam({ data }),
    onSuccess: () => { setNewTeamName(""); refetch(); },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteTeamMut = useMutation({
    mutationFn: (teamId: string) => deleteTeam({ data: { teamId } }),
    onSuccess: () => { setSelectedTeamKey(""); refetch(); },
    onError: (err: Error) => toast.error(err.message),
  });

  const addTeamMemberMut = useMutation({
    mutationFn: (data: { teamId: string; email: string; role: string }) => addTeamMemberByEmail({ data }),
    onSuccess: () => { setTeamInviteEmail(""); refetch(); },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateTeamRoleMut = useMutation({
    mutationFn: (data: { teamId: string; userId: string; role: string }) => updateTeamMemberRole({ data }),
    ...mutOpts,
  });

  const removeTeamMemberMut = useMutation({
    mutationFn: (data: { teamId: string; userId: string }) => removeTeamMember({ data }),
    ...mutOpts,
  });

  const allOrgs = orgTeamQuery.data?.organizations ?? [];
  const allTeams = orgTeamQuery.data?.teams ?? [];
  const activeTeam = allTeams.find((t) => t.id === selectedTeamKey);

  return (
    <OrgAdminSection title="Teams" description="Create teams within organizations and manage members" icon="👤">
      {orgTeamQuery.isPending && <p style={{ color: "var(--text-muted)" }}>Loading...</p>}
      {orgTeamQuery.isError && <p style={{ color: "var(--error)" }}>Failed to load teams.</p>}

      {allOrgs.length > 0 && (
        <AdminCard>
          <h4 style={{ margin: "0 0 12px 0", fontSize: 14, fontWeight: "bold" }}>Create New Team</h4>
          <div style={{ display: "flex", gap: 8 }}>
            <select
              value={selectedOrgKey || allOrgs[0]?.id}
              onChange={(e) => setSelectedOrgKey(e.target.value)}
              style={{ padding: "7px 10px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: 13 }}
            >
              {allOrgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <input type="text" placeholder="Team name" value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)}
              style={{ flex: 1, padding: "7px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: 13 }} />
            <button
              onClick={() => { const orgId = selectedOrgKey || allOrgs[0]?.id; if (orgId && newTeamName.trim()) createTeamMut.mutate({ orgId, name: newTeamName }); }}
              disabled={createTeamMut.isPending || !newTeamName.trim()}
              style={{ padding: "7px 16px", background: "var(--accent)", color: "white", border: "none", borderRadius: "var(--radius)", fontWeight: 600, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}
            >
              {createTeamMut.isPending ? "Creating..." : "+ Create Team"}
            </button>
          </div>
        </AdminCard>
      )}

      {allTeams.length === 0 && !orgTeamQuery.isPending && (
        <div style={{ textAlign: "center", padding: "40px", border: "1px dashed var(--border)", borderRadius: "var(--radius)", color: "var(--text-muted)" }}>
          No teams yet. Create one above.
        </div>
      )}

      {allTeams.length > 0 && (
        <>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8 }}>
            <select
              value={activeTeam?.id ?? allTeams[0]?.id}
              onChange={(e) => setSelectedTeamKey(e.target.value)}
              style={{ flex: 1, padding: "8px 12px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontWeight: 600 }}
            >
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
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                      {team.orgName} · {team.members.length} members · Role: <strong>{team.role}</strong>
                    </div>
                  </div>
                  {team.role !== "member" && (
                    <button
                      onClick={() => { if (confirm(`Delete team "${team.name}"?`)) deleteTeamMut.mutate(team.id); }}
                      disabled={deleteTeamMut.isPending}
                      style={{ padding: "5px 12px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "var(--error)", fontSize: 12, cursor: "pointer", borderRadius: "var(--radius)" }}
                    >
                      Delete Team
                    </button>
                  )}
                </div>

                <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
                  <h4 style={{ margin: 0, fontSize: 14, fontWeight: "bold" }}>Members</h4>
                  {team.role !== "member" && (
                    <InviteForm
                      label="Add Member by Email"
                      email={teamInviteEmail} setEmail={setTeamInviteEmail}
                      role={teamInviteRole} setRole={setTeamInviteRole}
                      roles={["member", "admin"]}
                      onSubmit={() => addTeamMemberMut.mutate({ teamId: team.id, email: teamInviteEmail, role: teamInviteRole })}
                      loading={addTeamMemberMut.isPending}
                    />
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
  );
}
