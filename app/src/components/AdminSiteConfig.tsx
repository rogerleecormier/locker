import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getSystemSettings, updateSystemSetting, type SystemSettingsData } from "~/routes/admin";
import { AdminCard, SiteAdminSection } from "~/components/AdminSections";

function ToggleSwitch({
  checked, onChange, disabled,
}: {
  checked: boolean; onChange: (val: boolean) => void; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      style={{
        position: "relative", width: 44, height: 24, borderRadius: 12,
        background: checked ? "var(--accent)" : "rgba(148,163,184,0.25)",
        border: "none", cursor: disabled ? "not-allowed" : "pointer",
        padding: 0, transition: "background 0.2s ease",
        flexShrink: 0, opacity: disabled ? 0.6 : 1,
      }}
    >
      <span style={{
        position: "absolute", top: 3, left: checked ? 23 : 3,
        width: 18, height: 18, borderRadius: "50%",
        background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
        transition: "left 0.2s ease", display: "block",
      }} />
    </button>
  );
}

const SETTING_ROWS: Array<{
  dataKey: keyof SystemSettingsData;
  settingKey: string;
  label: string;
  desc: string;
  icon: string;
}> = [
  {
    dataKey: "enableSignups",
    settingKey: "enable_signups",
    label: "User Signups",
    desc: "Allow new users to create accounts. Disable during development to prevent unintended registrations. The demo account remains accessible regardless.",
    icon: "👤",
  },
  {
    dataKey: "enableBusinessPlans",
    settingKey: "enable_business_plans",
    label: "Business Plan Upgrades",
    desc: "Allow users to access Business plan features and org-level functionality. When disabled, all Business-tier accounts are effectively downgraded to Free.",
    icon: "🏢",
  },
  {
    dataKey: "enableEnterprisePlans",
    settingKey: "enable_enterprise_plans",
    label: "Enterprise Plan Upgrades",
    desc: "Allow users to access Enterprise plan features. When disabled, Enterprise accounts fall back to Business (or Free if Business is also disabled).",
    icon: "🏗️",
  },
];

export function SiteConfigSection() {
  const { data: settings, isLoading, refetch } = useQuery<SystemSettingsData>({
    queryKey: ["site-settings"],
    queryFn: () => getSystemSettings(),
    refetchInterval: 60_000,
  });

  const saveMutation = useMutation({
    mutationFn: async (update: { key: string; value: string }) => {
      await updateSystemSetting({ data: update });
    },
    onSuccess: () => { refetch(); },
  });

  const [lastSaved, setLastSaved] = useState<string | null>(null);

  async function toggle(settingKey: string, current: boolean) {
    await saveMutation.mutateAsync({ key: settingKey, value: (!current).toString() });
    setLastSaved(settingKey);
    setTimeout(() => setLastSaved(null), 2000);
  }

  return (
    <SiteAdminSection title="Site Configuration" description="Control global access, feature flags, and plan availability" icon="🔧">
      {isLoading ? (
        <AdminCard>
          <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0 }}>Loading site settings…</p>
        </AdminCard>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{
            padding: "12px 16px",
            background: "rgba(168,85,247,0.06)",
            border: "1px solid rgba(168,85,247,0.2)",
            borderRadius: 10, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6,
          }}>
            <strong style={{ color: "var(--accent)" }}>Development Mode Controls</strong> — Changes take effect immediately sitewide without a restart.
          </div>
          {SETTING_ROWS.map((row) => {
            const value = settings?.[row.dataKey] ?? false;
            const justSaved = lastSaved === row.settingKey;
            return (
              <AdminCard key={row.dataKey}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 10,
                    background: value ? "rgba(168,85,247,0.12)" : "rgba(148,163,184,0.08)",
                    border: `1px solid ${value ? "rgba(168,85,247,0.25)" : "var(--border)"}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 18, flexShrink: 0, transition: "background 0.2s, border-color 0.2s",
                  }}>
                    {row.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{row.label}</span>
                        <span style={{
                          padding: "1px 8px", borderRadius: 20, fontSize: 10, fontWeight: 700, letterSpacing: "0.05em",
                          background: value ? "rgba(52,211,153,0.1)" : "rgba(239,68,68,0.1)",
                          border: `1px solid ${value ? "rgba(52,211,153,0.25)" : "rgba(239,68,68,0.2)"}`,
                          color: value ? "#34d399" : "#f87171",
                        }}>
                          {value ? "ENABLED" : "DISABLED"}
                        </span>
                      </div>
                      <ToggleSwitch checked={value} onChange={() => toggle(row.settingKey, value)} disabled={saveMutation.isPending} />
                    </div>
                    <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0, lineHeight: 1.6 }}>{row.desc}</p>
                    {justSaved && (
                      <p style={{ fontSize: 11, color: "#34d399", margin: "6px 0 0", display: "flex", alignItems: "center", gap: 4 }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                        Saved successfully
                      </p>
                    )}
                  </div>
                </div>
              </AdminCard>
            );
          })}
        </div>
      )}
    </SiteAdminSection>
  );
}
