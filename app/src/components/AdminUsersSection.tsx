import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "~/components/ui/toast";
import {
  listAllUsersAndDetails, listAllOrgsAndQuotas,
  createUserAdmin, updateUserAdmin, deleteUserAdmin,
  updateUserPlanAdmin, setUserPasswordAdmin, resetUserPasswordAdmin,
  assignUserToOrgAdmin, removeUserFromOrgAdmin,
  type UserDetails,
} from "~/routes/admin";
import { OrgAdminSection } from "~/components/AdminSections";

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

export function AdminUsersSection({ adminUserId }: { adminUserId?: string | null }) {
  const toast = useToast();
  const qc = useQueryClient();

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

  const usersQuery = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => listAllUsersAndDetails(),
    refetchInterval: 30_000,
  });

  const orgsQuery = useQuery({
    queryKey: ["admin-orgs"],
    queryFn: () => listAllOrgsAndQuotas(),
    staleTime: 60_000,
  });

  const refetchUsers = () => qc.invalidateQueries({ queryKey: ["admin-users"] });
  const refetchOrgs = () => qc.invalidateQueries({ queryKey: ["admin-orgs"] });

  const createUserMut = useMutation({
    mutationFn: (data: { name: string; email: string; password?: string; plan?: string }) => createUserAdmin({ data }),
    onSuccess: () => {
      refetchUsers();
      setIsCreateModalOpen(false);
      setCreateName(""); setCreateEmail(""); setCreatePassword(""); setCreatePlan("free");
    },
    onError: (err) => toast.error("Failed to create user: " + String(err)),
  });

  const updateUserMut = useMutation({
    mutationFn: (data: { userId: string; name: string; email: string; emailVerified: boolean }) => updateUserAdmin({ data }),
    onSuccess: () => { refetchUsers(); setIsEditModalOpen(false); },
    onError: (err) => toast.error("Failed to update user: " + String(err)),
  });

  const deleteUserMut = useMutation({
    mutationFn: (userId: string) => deleteUserAdmin({ data: { userId } }),
    onSuccess: () => refetchUsers(),
    onError: (err) => toast.error("Failed to delete user: " + String(err)),
  });

  const updateUserPlanMut = useMutation({
    mutationFn: (data: { userId: string; plan: string }) => updateUserPlanAdmin({ data }),
    onSuccess: () => { refetchUsers(); setIsPlanModalOpen(false); },
    onError: (err) => toast.error("Failed to update user plan: " + String(err)),
  });

  const setUserPasswordMut = useMutation({
    mutationFn: (data: { userId: string; password: string }) => setUserPasswordAdmin({ data }),
    onSuccess: () => { setIsPasswordModalOpen(false); setPasswordValue(""); toast.success("Password set successfully!"); },
    onError: (err) => toast.error("Failed to set password: " + String(err)),
  });

  const resetUserPasswordMut = useMutation({
    mutationFn: (userId: string) => resetUserPasswordAdmin({ data: { userId } }),
    onSuccess: (res) => { setGeneratedPassword(res.password || ""); setIsResetSuccessModalOpen(true); },
    onError: (err) => toast.error("Failed to reset password: " + String(err)),
  });

  const assignUserToOrgMut = useMutation({
    mutationFn: (data: { userId: string; orgId: string; role: "owner" | "admin" | "member" }) => assignUserToOrgAdmin({ data }),
    onSuccess: () => { refetchUsers(); refetchOrgs(); },
    onError: (err) => toast.error("Failed to assign user to organization: " + String(err)),
  });

  const removeUserFromOrgMut = useMutation({
    mutationFn: (data: { userId: string; orgId: string }) => removeUserFromOrgAdmin({ data }),
    onSuccess: () => { refetchUsers(); refetchOrgs(); },
    onError: (err) => toast.error("Failed to remove user from organization: " + String(err)),
  });

  const filteredUsers = (usersQuery.data || []).filter(
    (u) =>
      u.name.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.email.toLowerCase().includes(userSearch.toLowerCase())
  );

  return (
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
                      {user.id === adminUserId && (
                        <span style={{ fontSize: "9px", background: "rgba(168,85,247,0.15)", color: "var(--accent)", padding: "1px 6px", borderRadius: "10px", fontWeight: "bold", display: "inline-block", marginTop: "4px" }}>ADMIN</span>
                      )}
                    </td>
                    <td style={{ padding: "14px 16px" }}>
                      <PlanBadge plan={user.plan} />
                    </td>
                    <td style={{ padding: "14px 16px" }}>
                      {user.organizations.length === 0 ? (
                        <span style={{ fontSize: "11px", color: "var(--text-muted)", fontStyle: "italic" }}>None</span>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                          {user.organizations.map((org) => (
                            <div key={org.id} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              <span style={{ fontSize: "11px", fontWeight: 600 }}>{org.name}</span>
                              <RoleBadge role={org.role} />
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "14px 16px", textAlign: "center", fontWeight: 600, color: "var(--accent)" }}>{user.memoryCount}</td>
                    <td style={{ padding: "14px 16px", fontSize: "12px", color: "var(--text-muted)" }}>{new Date(user.createdAt).toLocaleDateString()}</td>
                    <td style={{ padding: "14px 16px", textAlign: "right" }}>
                      <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end", flexWrap: "wrap" }}>
                        <ActionBtn label="Edit" onClick={() => { setSelectedUser(user); setEditName(user.name); setEditEmail(user.email); setEditEmailVerified(user.emailVerified); setIsEditModalOpen(true); }} />
                        <ActionBtn label="Plan" onClick={() => { setSelectedUser(user); setSelectedPlan(user.plan); setIsPlanModalOpen(true); }} />
                        <ActionBtn label="Orgs" onClick={() => { setSelectedUser(user); setIsOrgsModalOpen(true); setAssignOrgId(""); setAssignRole("member"); }} />
                        <ActionBtn label="Password" onClick={() => { setSelectedUser(user); setPasswordValue(""); setIsPasswordModalOpen(true); }} />
                        <ActionBtn label="Reset" variant="muted" onClick={() => { if (confirm(`Reset password for ${user.name}? A new random password will be generated.`)) resetUserPasswordMut.mutate(user.id); }} />
                        {user.id !== adminUserId && (
                          <ActionBtn label="Delete" variant="danger" onClick={() => { if (confirm(`DELETE user ${user.name}? This will delete all their data permanently.`)) deleteUserMut.mutate(user.id); }} />
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

      {/* ── Modals ── */}

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
                  <FieldLabel>{label}</FieldLabel>
                  <input type={type} value={value} onChange={(e) => setter(e.target.value)} placeholder={placeholder} style={{ width: "100%", padding: "8px 12px" }} />
                </div>
              ))}
              <div>
                <FieldLabel>Personal Pricing Plan</FieldLabel>
                <PlanSelect value={createPlan} onChange={setCreatePlan} />
              </div>
            </div>
            <ModalFooter>
              <button onClick={() => setIsCreateModalOpen(false)} style={{ padding: "8px 16px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-muted)", fontWeight: 600 }}>Cancel</button>
              <button
                onClick={() => {
                  if (!createName || !createEmail) { toast.warning("Name and email are required."); return; }
                  createUserMut.mutate({ name: createName, email: createEmail, password: createPassword || undefined, plan: createPlan });
                }}
                disabled={createUserMut.isPending}
                style={{ padding: "8px 16px", background: "var(--accent)", color: "white", fontWeight: "bold" }}
              >
                {createUserMut.isPending ? "Creating..." : "Create User"}
              </button>
            </ModalFooter>
          </div>
        </div>
      )}

      {isEditModalOpen && selectedUser && (
        <div style={modalOverlay}>
          <div style={modalBox}>
            <h3 style={{ margin: "0 0 16px 0", fontSize: "16px", fontWeight: "bold" }}>Edit User</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div>
                <FieldLabel>Full Name</FieldLabel>
                <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} style={{ width: "100%", padding: "8px 12px" }} />
              </div>
              <div>
                <FieldLabel>Email Address</FieldLabel>
                <input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} style={{ width: "100%", padding: "8px 12px" }} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" }}>
                <input type="checkbox" id="edit-email-verified" checked={editEmailVerified} onChange={(e) => setEditEmailVerified(e.target.checked)} style={{ width: "auto" }} />
                <label htmlFor="edit-email-verified" style={{ fontSize: "13px", fontWeight: 500 }}>Email Verified</label>
              </div>
            </div>
            <ModalFooter>
              <button onClick={() => setIsEditModalOpen(false)} style={{ padding: "8px 16px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-muted)", fontWeight: 600 }}>Cancel</button>
              <button
                onClick={() => {
                  if (!editName || !editEmail) { toast.warning("Name and email are required."); return; }
                  updateUserMut.mutate({ userId: selectedUser.id, name: editName, email: editEmail, emailVerified: editEmailVerified });
                }}
                disabled={updateUserMut.isPending}
                style={{ padding: "8px 16px", background: "var(--accent)", color: "white", fontWeight: "bold" }}
              >
                {updateUserMut.isPending ? "Saving..." : "Save Changes"}
              </button>
            </ModalFooter>
          </div>
        </div>
      )}

      {isPlanModalOpen && selectedUser && (
        <div style={modalOverlay}>
          <div style={{ ...modalBox, maxWidth: "400px" }}>
            <h3 style={{ margin: "0 0 8px 0", fontSize: "16px", fontWeight: "bold" }}>Change Plan</h3>
            <p style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "16px" }}>Assign pricing plan for <strong>{selectedUser.name}</strong>.</p>
            <div>
              <FieldLabel>Plan</FieldLabel>
              <PlanSelect value={selectedPlan} onChange={setSelectedPlan} />
            </div>
            <ModalFooter>
              <button onClick={() => setIsPlanModalOpen(false)} style={{ padding: "8px 16px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-muted)", fontWeight: 600 }}>Cancel</button>
              <button onClick={() => updateUserPlanMut.mutate({ userId: selectedUser.id, plan: selectedPlan })} disabled={updateUserPlanMut.isPending}
                style={{ padding: "8px 16px", background: "var(--accent)", color: "white", fontWeight: "bold" }}>
                {updateUserPlanMut.isPending ? "Updating..." : "Update Plan"}
              </button>
            </ModalFooter>
          </div>
        </div>
      )}

      {isPasswordModalOpen && selectedUser && (
        <div style={modalOverlay}>
          <div style={{ ...modalBox, maxWidth: "400px" }}>
            <h3 style={{ margin: "0 0 8px 0", fontSize: "16px", fontWeight: "bold" }}>Set Password</h3>
            <p style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "16px" }}>Set a manual password for <strong>{selectedUser.name}</strong>.</p>
            <div>
              <FieldLabel>New Password</FieldLabel>
              <input type="password" value={passwordValue} onChange={(e) => setPasswordValue(e.target.value)} placeholder="At least 8 characters" style={{ width: "100%", padding: "8px 12px" }} />
            </div>
            <ModalFooter>
              <button onClick={() => setIsPasswordModalOpen(false)} style={{ padding: "8px 16px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-muted)", fontWeight: 600 }}>Cancel</button>
              <button
                onClick={() => {
                  if (passwordValue.length < 8) { toast.warning("Password must be at least 8 characters."); return; }
                  setUserPasswordMut.mutate({ userId: selectedUser.id, password: passwordValue });
                }}
                disabled={setUserPasswordMut.isPending}
                style={{ padding: "8px 16px", background: "var(--accent)", color: "white", fontWeight: "bold" }}
              >
                {setUserPasswordMut.isPending ? "Setting..." : "Set Password"}
              </button>
            </ModalFooter>
          </div>
        </div>
      )}

      {isResetSuccessModalOpen && (
        <div style={{ ...modalOverlay, zIndex: 1010 }}>
          <div style={modalBox}>
            <h3 style={{ margin: "0 0 12px 0", fontSize: "16px", fontWeight: "bold", color: "var(--success)" }}>Password Reset Success</h3>
            <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "16px" }}>A new temporary password has been generated:</p>
            <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", padding: "12px 16px", borderRadius: "8px", fontFamily: "monospace", fontSize: "18px", textAlign: "center", color: "var(--text)", letterSpacing: "0.08em", fontWeight: "bold", marginBottom: "20px" }}>
              {generatedPassword}
            </div>
            <ModalFooter>
              <button onClick={() => { navigator.clipboard.writeText(generatedPassword); toast.success("Copied to clipboard!"); }}
                style={{ padding: "8px 16px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", fontWeight: 600 }}>Copy Password</button>
              <button onClick={() => { setIsResetSuccessModalOpen(false); setGeneratedPassword(""); }}
                style={{ padding: "8px 16px", background: "var(--accent)", color: "white", fontWeight: "bold" }}>Done</button>
            </ModalFooter>
          </div>
        </div>
      )}

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
                      <button onClick={() => {
                        if (confirm(`Remove ${selectedUser.name} from ${org.name}?`)) {
                          removeUserFromOrgMut.mutate({ userId: selectedUser.id, orgId: org.id });
                          setSelectedUser({ ...selectedUser, organizations: selectedUser.organizations.filter(o => o.id !== org.id) });
                        }
                      }} style={{ padding: "4px 8px", background: "transparent", color: "var(--error)", fontSize: "11px", fontWeight: "bold", cursor: "pointer" }}>Remove</button>
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
                <button
                  onClick={() => {
                    if (!assignOrgId) return;
                    assignUserToOrgMut.mutate({ userId: selectedUser.id, orgId: assignOrgId, role: assignRole });
                    const matchedName = (orgsQuery.data || []).find(o => o.id === assignOrgId)?.name || "New Organization";
                    setSelectedUser({ ...selectedUser, organizations: [...selectedUser.organizations, { id: assignOrgId, name: matchedName, role: assignRole }] });
                    setAssignOrgId("");
                  }}
                  disabled={!assignOrgId || assignUserToOrgMut.isPending}
                  style={{ padding: "8px 16px", background: "var(--accent)", color: "white", fontWeight: "bold", cursor: "pointer" }}
                >Add</button>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "24px" }}>
              <button onClick={() => setIsOrgsModalOpen(false)} style={{ padding: "8px 16px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-muted)", fontWeight: 600 }}>Close</button>
            </div>
          </div>
        </div>
      )}
    </OrgAdminSection>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label style={{ display: "block", fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px", fontWeight: "bold", textTransform: "uppercase" }}>
      {children}
    </label>
  );
}

function ModalFooter({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: "10px", marginTop: "24px", justifyContent: "flex-end" }}>
      {children}
    </div>
  );
}

function PlanSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ width: "100%", padding: "8px 12px" }}>
      <option value="free">Free (Personal)</option>
      <option value="business">Business</option>
      <option value="business_comp">Business (Comp)</option>
      <option value="enterprise">Enterprise</option>
    </select>
  );
}

function PlanBadge({ plan }: { plan: string }) {
  const bg = plan === "enterprise" ? "rgba(16,185,129,0.15)" : plan === "business" ? "rgba(168,85,247,0.15)" : "var(--surface2)";
  const color = plan === "enterprise" ? "#10b981" : plan === "business" ? "var(--accent)" : "var(--text-muted)";
  return (
    <span style={{ fontSize: "10px", background: bg, color, padding: "2px 8px", borderRadius: "20px", fontWeight: "bold", textTransform: "uppercase" }}>
      {plan}
    </span>
  );
}

function RoleBadge({ role }: { role: string }) {
  const bg = role === "owner" ? "rgba(239,68,68,0.1)" : role === "admin" ? "rgba(168,85,247,0.1)" : "var(--surface2)";
  const color = role === "owner" ? "var(--error)" : role === "admin" ? "var(--accent)" : "var(--text-muted)";
  return (
    <span style={{ fontSize: "9px", background: bg, color, padding: "1px 4px", borderRadius: "4px", fontWeight: 600, textTransform: "uppercase" }}>
      {role}
    </span>
  );
}

function ActionBtn({
  label, onClick, variant = "default",
}: {
  label: string; onClick: () => void; variant?: "default" | "muted" | "danger";
}) {
  const styles: React.CSSProperties =
    variant === "danger"
      ? { background: "rgba(239,68,68,0.1)", color: "var(--error)", border: "1px solid rgba(239,68,68,0.2)", fontWeight: "bold" }
      : variant === "muted"
      ? { background: "var(--surface2)", color: "var(--text-muted)", border: "1px solid var(--border)" }
      : { background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--border)", fontWeight: 600 };
  return (
    <button onClick={onClick} style={{ padding: "4px 8px", borderRadius: "var(--radius)", fontSize: "11px", cursor: "pointer", ...styles }}>
      {label}
    </button>
  );
}
