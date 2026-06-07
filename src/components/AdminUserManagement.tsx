import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listAllUsersAndDetails,
  listAllOrgsAndQuotas,
  createUserAdmin,
  updateUserAdmin,
  deleteUserAdmin,
  updateUserPlanAdmin,
  setUserPasswordAdmin,
  resetUserPasswordAdmin,
  assignUserToOrgAdmin,
  removeUserFromOrgAdmin,
  type UserDetails,
} from "~/routes/admin";

// ── Plan colour palette ───────────────────────────────────────────────────────
const PLAN_COLORS: Record<string, string> = {
  free:          "#6b7280",
  business:      "#a855f7",
  business_comp: "#22c55e",
  enterprise:    "#f59e0b",
};
const PLAN_LABELS: Record<string, string> = {
  free:          "Free",
  business:      "Business",
  business_comp: "Business (Comp)",
  enterprise:    "Enterprise",
};

// Admin-assignable plans (all plans including comp; Stripe-billed ones shown with note)
const ASSIGNABLE_PLANS = [
  { id: "free",          label: "Free",                note: "" },
  { id: "business",      label: "Business",            note: "Stripe billed" },
  { id: "business_comp", label: "Business (Comp)",     note: "No Stripe billing – admin grant" },
  { id: "enterprise",    label: "Enterprise",          note: "Stripe billed" },
];

// ── Shared modal primitives ───────────────────────────────────────────────────
const overlay: React.CSSProperties = {
  position: "fixed", inset: 0,
  background: "rgba(10,10,15,0.75)", backdropFilter: "blur(4px)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 1000, padding: 20,
};
const box: React.CSSProperties = {
  background: "var(--surface)", border: "1px solid var(--border)",
  borderRadius: 14, width: "100%", maxWidth: 480,
  boxShadow: "0 20px 40px rgba(0,0,0,0.4)", padding: 28,
  display: "flex", flexDirection: "column", gap: 20,
};
const fieldLabel: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 700,
  color: "var(--text-muted)", textTransform: "uppercase",
  letterSpacing: "0.07em", marginBottom: 6,
};
const input: React.CSSProperties = {
  width: "100%", padding: "9px 12px", fontSize: 13,
  background: "var(--surface2)", border: "1px solid var(--border)",
  borderRadius: 8, color: "var(--text)", boxSizing: "border-box",
  outline: "none",
};
const select: React.CSSProperties = { ...input };
const btnPrimary: React.CSSProperties = {
  padding: "9px 20px", background: "var(--accent)", color: "#fff",
  border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700,
  cursor: "pointer",
};
const btnDanger: React.CSSProperties = {
  padding: "9px 20px", background: "rgba(239,68,68,0.12)",
  color: "var(--error)", border: "1px solid rgba(239,68,68,0.3)",
  borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer",
};
const btnGhost: React.CSSProperties = {
  padding: "9px 20px", background: "transparent",
  color: "var(--text-muted)", border: "1px solid var(--border)",
  borderRadius: 8, fontSize: 13, cursor: "pointer",
};

function ModalHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{title}</h3>
      <button onClick={onClose} style={{ background: "transparent", border: "none", color: "var(--text-muted)", fontSize: 20, cursor: "pointer", lineHeight: 1 }}>✕</button>
    </div>
  );
}

// ── Plan badge ────────────────────────────────────────────────────────────────
function PlanBadge({ plan }: { plan: string }) {
  const color = PLAN_COLORS[plan] ?? "#6b7280";
  return (
    <span style={{
      fontSize: 10, padding: "2px 8px", borderRadius: 20,
      background: `${color}20`, border: `1px solid ${color}40`,
      color, fontWeight: 700, whiteSpace: "nowrap",
    }}>
      {PLAN_LABELS[plan] ?? plan}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function UserManagementSection() {
  const qc = useQueryClient();

  const usersQ  = useQuery({ queryKey: ["admin-users-mgmt"], queryFn: () => listAllUsersAndDetails() });
  const orgsQ   = useQuery({ queryKey: ["admin-orgs-mgmt"],  queryFn: () => listAllOrgsAndQuotas() });

  // ── Filters & search ─────────────────────────────────────────────────────
  const [search,    setSearch]    = useState("");
  const [planFilter, setPlanFilter] = useState("all");
  const [sortField,  setSortField]  = useState<"name" | "email" | "plan" | "createdAt" | "memoryCount">("createdAt");
  const [sortDir,    setSortDir]    = useState<"asc" | "desc">("desc");

  // ── Modal state ───────────────────────────────────────────────────────────
  const [modal, setModal] = useState<
    | { type: "create" }
    | { type: "edit";    user: UserDetails }
    | { type: "plan";    user: UserDetails }
    | { type: "password";user: UserDetails }
    | { type: "orgs";    user: UserDetails }
    | { type: "delete";  user: UserDetails }
    | { type: "reset-success"; password: string }
    | null
  >(null);

  // Create form
  const [cName,  setCName]  = useState("");
  const [cEmail, setCEmail] = useState("");
  const [cPass,  setCPass]  = useState("");
  const [cPlan,  setCPlan]  = useState("free");

  // Edit form
  const [eName,     setEName]     = useState("");
  const [eEmail,    setEEmail]    = useState("");
  const [eVerified, setEVerified] = useState(false);

  // Plan picker
  const [pickedPlan, setPickedPlan] = useState("free");

  // Password
  const [pwValue, setPwValue] = useState("");

  // Org assign
  const [orgAssignId,   setOrgAssignId]   = useState("");
  const [orgAssignRole, setOrgAssignRole] = useState<"owner" | "admin" | "member">("member");

  const openEdit = (u: UserDetails) => {
    setEName(u.name); setEEmail(u.email); setEVerified(u.emailVerified);
    setModal({ type: "edit", user: u });
  };
  const openPlan = (u: UserDetails) => { setPickedPlan(u.plan); setModal({ type: "plan", user: u }); };

  // ── Mutations ─────────────────────────────────────────────────────────────
  const refetch = () => usersQ.refetch();

  const createMut = useMutation({
    mutationFn: (d: { name: string; email: string; password?: string; plan?: string }) => createUserAdmin({ data: d }),
    onSuccess: () => { refetch(); setModal(null); setCName(""); setCEmail(""); setCPass(""); setCPlan("free"); },
    onError: (e: Error) => alert(e.message),
  });
  const editMut = useMutation({
    mutationFn: (d: { userId: string; name: string; email: string; emailVerified: boolean }) => updateUserAdmin({ data: d }),
    onSuccess: () => { refetch(); setModal(null); },
    onError: (e: Error) => alert(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: (userId: string) => deleteUserAdmin({ data: { userId } }),
    onSuccess: () => { refetch(); setModal(null); },
    onError: (e: Error) => alert(e.message),
  });
  const planMut = useMutation({
    mutationFn: (d: { userId: string; plan: string }) => updateUserPlanAdmin({ data: d }),
    onSuccess: () => { refetch(); setModal(null); },
    onError: (e: Error) => alert(e.message),
  });
  const setPwMut = useMutation({
    mutationFn: (d: { userId: string; password: string }) => setUserPasswordAdmin({ data: d }),
    onSuccess: () => { setModal(null); setPwValue(""); },
    onError: (e: Error) => alert(e.message),
  });
  const resetPwMut = useMutation({
    mutationFn: (userId: string) => resetUserPasswordAdmin({ data: { userId } }),
    onSuccess: (res) => { setModal({ type: "reset-success", password: res.password ?? "" }); },
    onError: (e: Error) => alert(e.message),
  });
  const assignOrgMut = useMutation({
    mutationFn: (d: { userId: string; orgId: string; role: "owner" | "admin" | "member" }) => assignUserToOrgAdmin({ data: d }),
    onSuccess: () => { refetch(); orgsQ.refetch(); },
    onError: (e: Error) => alert(e.message),
  });
  const removeOrgMut = useMutation({
    mutationFn: (d: { userId: string; orgId: string }) => removeUserFromOrgAdmin({ data: d }),
    onSuccess: () => { refetch(); orgsQ.refetch(); },
    onError: (e: Error) => alert(e.message),
  });

  // ── Derived list ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = usersQ.data ?? [];
    if (search)           list = list.filter((u) => u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase()));
    if (planFilter !== "all") list = list.filter((u) => u.plan === planFilter);
    list = [...list].sort((a, b) => {
      let av: string | number, bv: string | number;
      if (sortField === "createdAt")   { av = a.createdAt; bv = b.createdAt; }
      else if (sortField === "memoryCount") { av = a.memoryCount; bv = b.memoryCount; }
      else { av = a[sortField].toLowerCase(); bv = b[sortField].toLowerCase(); }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return list;
  }, [usersQ.data, search, planFilter, sortField, sortDir]);

  const sortToggle = (field: typeof sortField) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("asc"); }
  };
  const SortHeader = ({ label, field }: { label: string; field: typeof sortField }) => (
    <th
      onClick={() => sortToggle(field)}
      style={{ textAlign: "left", padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
    >
      {label} {sortField === field ? (sortDir === "asc" ? "↑" : "↓") : ""}
    </th>
  );

  const allOrgs   = orgsQ.data ?? [];
  const planCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const u of usersQ.data ?? []) m[u.plan] = (m[u.plan] ?? 0) + 1;
    return m;
  }, [usersQ.data]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "var(--text)" }}>User Management</h2>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-muted)" }}>
            {usersQ.data?.length ?? 0} users · Full CRUD + subscription control
          </p>
        </div>
        <button onClick={() => setModal({ type: "create" })} style={{ ...btnPrimary, display: "flex", alignItems: "center", gap: 8 }}>
          + Create User
        </button>
      </div>

      {/* ── Plan summary chips ── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {Object.entries(planCounts).map(([plan, count]) => (
          <button
            key={plan}
            onClick={() => setPlanFilter(planFilter === plan ? "all" : plan)}
            style={{
              fontSize: 11, padding: "4px 12px", borderRadius: 20, cursor: "pointer",
              background: planFilter === plan ? `${PLAN_COLORS[plan] ?? "#6b7280"}25` : "var(--surface2)",
              border: `1px solid ${planFilter === plan ? (PLAN_COLORS[plan] ?? "#6b7280") : "var(--border)"}`,
              color: planFilter === plan ? (PLAN_COLORS[plan] ?? "#6b7280") : "var(--text-muted)",
              fontWeight: 600,
            }}
          >
            {PLAN_LABELS[plan] ?? plan} <span style={{ opacity: 0.7 }}>{count}</span>
          </button>
        ))}
        {planFilter !== "all" && (
          <button onClick={() => setPlanFilter("all")} style={{ fontSize: 11, padding: "4px 12px", borderRadius: 20, background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)", cursor: "pointer" }}>
            Clear filter ✕
          </button>
        )}
      </div>

      {/* ── Search ── */}
      <div style={{ position: "relative" }}>
        <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }}>🔍</span>
        <input
          type="search"
          aria-label="Search users"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or email…"
          style={{ ...input, paddingLeft: 36 }}
        />
      </div>

      {/* ── Table ── */}
      {usersQ.isPending && <div style={{ color: "var(--text-muted)", textAlign: "center", padding: 40 }}>Loading users…</div>}
      {usersQ.isError && <div style={{ color: "var(--error)" }}>Failed to load users.</div>}
      {!usersQ.isPending && (
        <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead style={{ background: "var(--surface2)" }}>
              <tr>
                <SortHeader label="Name"    field="name" />
                <SortHeader label="Email"   field="email" />
                <SortHeader label="Plan"    field="plan" />
                <SortHeader label="Memories" field="memoryCount" />
                <SortHeader label="Joined"  field="createdAt" />
                <th style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u, i) => (
                <tr key={u.id} style={{ borderTop: "1px solid var(--border)", background: i % 2 === 0 ? "var(--surface)" : "var(--surface2)" }}>
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ fontWeight: 600, color: "var(--text)" }}>{u.name}</div>
                    {!u.emailVerified && (
                      <span style={{ fontSize: 9, color: "#f59e0b", fontWeight: 700 }}>UNVERIFIED</span>
                    )}
                  </td>
                  <td style={{ padding: "10px 12px", color: "var(--text-muted)", fontFamily: "monospace", fontSize: 12 }}>{u.email}</td>
                  <td style={{ padding: "10px 12px" }}><PlanBadge plan={u.plan} /></td>
                  <td style={{ padding: "10px 12px", color: "var(--text-muted)", textAlign: "center" }}>{u.memoryCount}</td>
                  <td style={{ padding: "10px 12px", color: "var(--text-muted)", fontSize: 12 }}>
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                      <ActionBtn label="Edit"  color="#a855f7" onClick={() => openEdit(u)} />
                      <ActionBtn label="Plan"  color="#22c55e" onClick={() => openPlan(u)} />
                      <ActionBtn label="🔑 PW"  color="#f59e0b" onClick={() => { setPwValue(""); setModal({ type: "password", user: u }); }} />
                      <ActionBtn label="Orgs"  color="#3b82f6" onClick={() => setModal({ type: "orgs", user: u })} />
                      <ActionBtn label="Delete" color="#ef4444" onClick={() => setModal({ type: "delete", user: u })} danger />
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: "32px", textAlign: "center", color: "var(--text-muted)" }}>
                    No users match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Create User Modal ── */}
      {modal?.type === "create" && (
        <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) setModal(null); }}>
          <div style={box}>
            <ModalHeader title="Create User" onClose={() => setModal(null)} />
            <div>
              <label style={fieldLabel}>Name</label>
              <input style={input} value={cName} onChange={(e) => setCName(e.target.value)} placeholder="Full name" />
            </div>
            <div>
              <label style={fieldLabel}>Email</label>
              <input style={input} type="email" value={cEmail} onChange={(e) => setCEmail(e.target.value)} placeholder="user@example.com" />
            </div>
            <div>
              <label style={fieldLabel}>Password (optional)</label>
              <input style={input} type="password" value={cPass} onChange={(e) => setCPass(e.target.value)} placeholder="Leave blank to skip" />
            </div>
            <div>
              <label style={fieldLabel}>Plan</label>
              <select style={select} value={cPlan} onChange={(e) => setCPlan(e.target.value)}>
                {ASSIGNABLE_PLANS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}{p.note ? ` — ${p.note}` : ""}</option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button style={btnGhost} onClick={() => setModal(null)}>Cancel</button>
              <button
                style={btnPrimary}
                disabled={createMut.isPending || !cName.trim() || !cEmail.trim()}
                onClick={() => createMut.mutate({ name: cName, email: cEmail, password: cPass || undefined, plan: cPlan })}
              >
                {createMut.isPending ? "Creating…" : "Create User"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit User Modal ── */}
      {modal?.type === "edit" && (
        <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) setModal(null); }}>
          <div style={box}>
            <ModalHeader title={`Edit — ${modal.user.name}`} onClose={() => setModal(null)} />
            <div>
              <label style={fieldLabel}>Name</label>
              <input style={input} value={eName} onChange={(e) => setEName(e.target.value)} />
            </div>
            <div>
              <label style={fieldLabel}>Email</label>
              <input style={input} type="email" value={eEmail} onChange={(e) => setEEmail(e.target.value)} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input type="checkbox" id="ev" checked={eVerified} onChange={(e) => setEVerified(e.target.checked)} style={{ accentColor: "var(--accent)" }} />
              <label htmlFor="ev" style={{ fontSize: 13, color: "var(--text-muted)", cursor: "pointer" }}>Email verified</label>
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button style={btnGhost} onClick={() => setModal(null)}>Cancel</button>
              <button
                style={btnPrimary}
                disabled={editMut.isPending}
                onClick={() => editMut.mutate({ userId: modal.user.id, name: eName, email: eEmail, emailVerified: eVerified })}
              >
                {editMut.isPending ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Plan Modal ── */}
      {modal?.type === "plan" && (
        <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) setModal(null); }}>
          <div style={box}>
            <ModalHeader title={`Change Plan — ${modal.user.name}`} onClose={() => setModal(null)} />
            <div style={{ padding: "12px 16px", borderRadius: 8, background: "rgba(168,85,247,0.06)", border: "1px solid rgba(168,85,247,0.2)", fontSize: 13, color: "var(--text-muted)" }}>
              Current plan: <PlanBadge plan={modal.user.plan} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {ASSIGNABLE_PLANS.map((p) => (
                <label
                  key={p.id}
                  style={{
                    display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 16px",
                    borderRadius: 8, cursor: "pointer",
                    background: pickedPlan === p.id ? `${PLAN_COLORS[p.id] ?? "#6b7280"}12` : "var(--surface2)",
                    border: `1px solid ${pickedPlan === p.id ? (PLAN_COLORS[p.id] ?? "#6b7280") : "var(--border)"}`,
                    transition: "all 0.15s",
                  }}
                >
                  <input type="radio" name="plan" value={p.id} checked={pickedPlan === p.id} onChange={() => setPickedPlan(p.id)} style={{ marginTop: 2, accentColor: PLAN_COLORS[p.id] ?? "var(--accent)" }} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>{p.label}</div>
                    {p.note && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{p.note}</div>}
                    {p.id === "business_comp" && (
                      <div style={{ fontSize: 11, color: "#22c55e", marginTop: 4, fontWeight: 600 }}>
                        ✓ Full Business features — no Stripe subscription required
                      </div>
                    )}
                    {(p.id === "business" || p.id === "enterprise") && (
                      <div style={{ fontSize: 11, color: "#f59e0b", marginTop: 4 }}>
                        ⚠ Stripe subscription must be active for this plan to bill correctly
                      </div>
                    )}
                  </div>
                </label>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button style={btnGhost} onClick={() => setModal(null)}>Cancel</button>
              <button
                style={{ ...btnPrimary, background: PLAN_COLORS[pickedPlan] ?? "var(--accent)" }}
                disabled={planMut.isPending || pickedPlan === modal.user.plan}
                onClick={() => planMut.mutate({ userId: modal.user.id, plan: pickedPlan })}
              >
                {planMut.isPending ? "Updating…" : "Apply Plan"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Password Modal ── */}
      {modal?.type === "password" && (
        <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) setModal(null); }}>
          <div style={box}>
            <ModalHeader title={`Password — ${modal.user.name}`} onClose={() => setModal(null)} />
            <div>
              <label style={fieldLabel}>Set New Password</label>
              <input style={input} type="password" value={pwValue} onChange={(e) => setPwValue(e.target.value)} placeholder="At least 8 characters" />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                style={{ ...btnPrimary, flex: 1 }}
                disabled={setPwMut.isPending || pwValue.length < 8}
                onClick={() => setPwMut.mutate({ userId: modal.user.id, password: pwValue })}
              >
                {setPwMut.isPending ? "Setting…" : "Set Password"}
              </button>
              <button
                style={{ ...btnGhost, flex: 1 }}
                disabled={resetPwMut.isPending}
                onClick={() => resetPwMut.mutate(modal.user.id)}
              >
                {resetPwMut.isPending ? "Generating…" : "Auto-generate"}
              </button>
            </div>
            <button style={btnGhost} onClick={() => setModal(null)}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── Reset success ── */}
      {modal?.type === "reset-success" && (
        <div style={overlay}>
          <div style={box}>
            <ModalHeader title="Temporary Password Generated" onClose={() => setModal(null)} />
            <div style={{ padding: "14px 16px", borderRadius: 8, background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.3)", fontSize: 13, color: "var(--text)" }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>Temporary password — share securely and ask user to change it:</div>
              <code style={{ fontSize: 16, fontWeight: 700, color: "#22c55e", letterSpacing: "0.05em" }}>{modal.password}</code>
            </div>
            <button style={btnPrimary} onClick={() => setModal(null)}>Done</button>
          </div>
        </div>
      )}

      {/* ── Orgs Modal ── */}
      {modal?.type === "orgs" && (
        <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) setModal(null); }}>
          <div style={{ ...box, maxWidth: 560 }}>
            <ModalHeader title={`Organizations — ${modal.user.name}`} onClose={() => setModal(null)} />

            {/* Current memberships */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>Current Memberships</div>
              {modal.user.organizations.length === 0 && (
                <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Not a member of any organization.</div>
              )}
              {modal.user.organizations.map((org) => (
                <div key={org.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderRadius: 8, background: "var(--surface2)", border: "1px solid var(--border)", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>{org.name}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{org.role}</div>
                  </div>
                  <button
                    onClick={() => removeOrgMut.mutate({ userId: modal.user.id, orgId: org.id })}
                    disabled={removeOrgMut.isPending}
                    style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "var(--error)", cursor: "pointer", fontWeight: 600 }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>

            {/* Assign to org */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>Add to Organization</div>
              <div style={{ display: "flex", gap: 8 }}>
                <select style={{ ...select, flex: 2 }} value={orgAssignId} onChange={(e) => setOrgAssignId(e.target.value)}>
                  <option value="">Select org…</option>
                  {allOrgs.filter((o) => !modal.user.organizations.some((m) => m.id === o.id)).map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
                <select style={{ ...select, flex: 1 }} value={orgAssignRole} onChange={(e) => setOrgAssignRole(e.target.value as "owner" | "admin" | "member")}>
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                  <option value="owner">owner</option>
                </select>
              </div>
              <button
                style={{ ...btnPrimary, marginTop: 10, width: "100%" }}
                disabled={!orgAssignId || assignOrgMut.isPending}
                onClick={() => {
                  if (!orgAssignId) return;
                  assignOrgMut.mutate({ userId: modal.user.id, orgId: orgAssignId, role: orgAssignRole });
                  setOrgAssignId("");
                }}
              >
                {assignOrgMut.isPending ? "Assigning…" : "Add to Org"}
              </button>
            </div>

            <button style={btnGhost} onClick={() => setModal(null)}>Close</button>
          </div>
        </div>
      )}

      {/* ── Delete Confirm ── */}
      {modal?.type === "delete" && (
        <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) setModal(null); }}>
          <div style={box}>
            <ModalHeader title="Confirm Delete" onClose={() => setModal(null)} />
            <div style={{ padding: "12px 16px", borderRadius: 8, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", fontSize: 13, color: "var(--text)" }}>
              This will permanently delete <strong>{modal.user.name}</strong> ({modal.user.email}) and all their memories, sessions, tokens, and credentials. This action cannot be undone.
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button style={btnGhost} onClick={() => setModal(null)}>Cancel</button>
              <button
                style={btnDanger}
                disabled={deleteMut.isPending}
                onClick={() => deleteMut.mutate(modal.user.id)}
              >
                {deleteMut.isPending ? "Deleting…" : "Delete User"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tiny action button helper ─────────────────────────────────────────────────
function ActionBtn({ label, color, onClick, danger = false }: { label: string; color: string; onClick: () => void; danger?: boolean }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        fontSize: 11, padding: "3px 9px", borderRadius: 6, cursor: "pointer",
        background: hov ? (danger ? "rgba(239,68,68,0.15)" : `${color}20`) : "transparent",
        border: `1px solid ${hov ? color : "var(--border)"}`,
        color: hov ? color : "var(--text-muted)",
        fontWeight: 600, transition: "all 0.12s", whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}
