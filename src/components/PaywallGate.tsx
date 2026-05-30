import { PLANS, PLAN_ORDER, FEATURE_DESCRIPTIONS, type PlanId, type PlanFeatures } from "~/lib/plans";
import { useState, useEffect, useRef } from "react";

export function PlanBadge({ plan }: { plan: PlanId }) {
  const styles: Record<PlanId, React.CSSProperties> = {
    free: { color: "var(--text-muted)", background: "var(--surface2)", border: "1px solid var(--border)" },
    business: { color: "#a855f7", background: "rgba(168,85,247,0.12)", border: "1px solid rgba(168,85,247,0.3)" },
    enterprise: { color: "#f59e0b", background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)" },
  };
  const labels: Record<PlanId, string> = {
    free: "Personal",
    business: "Business",
    enterprise: "Enterprise",
  };
  return (
    <span style={{
      fontSize: 10,
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: "0.06em",
      padding: "3px 8px",
      borderRadius: 20,
      ...styles[plan],
    }}>
      {labels[plan]}
    </span>
  );
}

export function RequiredPlanChip({ plan }: { plan: PlanId }) {
  if (plan === "free") return null;
  const colors: Record<PlanId, string> = {
    free: "transparent",
    business: "#a855f7",
    enterprise: "#f59e0b",
  };
  return (
    <span style={{
      fontSize: 9,
      fontWeight: 800,
      textTransform: "uppercase",
      letterSpacing: "0.08em",
      padding: "2px 6px",
      borderRadius: 20,
      color: "#fff",
      background: colors[plan],
      marginLeft: 4,
      verticalAlign: "middle",
    }}>
      {plan === "business" ? "Business" : "Enterprise"}
    </span>
  );
}

type PaywallGateProps = {
  feature: keyof PlanFeatures;
  currentPlan: PlanId;
  requiredPlan: PlanId;
  children: React.ReactNode;
  compact?: boolean;
};

export function PaywallGate({ feature, currentPlan, requiredPlan, children, compact = false }: PaywallGateProps) {
  const hasAccess = PLAN_ORDER.indexOf(currentPlan) >= PLAN_ORDER.indexOf(requiredPlan);
  const requiredPlanObj = PLANS[requiredPlan];
  const featureInfo = FEATURE_DESCRIPTIONS[feature];

  if (hasAccess) return <>{children}</>;

  if (compact) {
    return (
      <div style={{
        padding: "12px 16px",
        background: "rgba(168,85,247,0.06)",
        border: "1px solid rgba(168,85,247,0.2)",
        borderRadius: "var(--radius)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontSize: 13,
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <span style={{ color: "var(--text-muted)" }}>
          <strong style={{ color: "var(--text)" }}>{featureInfo.label}</strong> is available on the{" "}
          <strong style={{ color: "var(--accent)" }}>{requiredPlanObj.label}</strong> plan.
        </span>
        <ComingSoonChip plan={requiredPlan} />
      </div>
    );
  }

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "60px 24px",
      textAlign: "center",
      minHeight: 300,
    }}>
      <div style={{
        width: 56,
        height: 56,
        borderRadius: 16,
        background: "rgba(168,85,247,0.1)",
        border: "1px solid rgba(168,85,247,0.3)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 20,
      }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </div>
      <h3 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>
        {featureInfo.label}
      </h3>
      <p style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 380, lineHeight: 1.6, marginBottom: 20 }}>
        {featureInfo.description}
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 28 }}>
        <PlanBadge plan={currentPlan} />
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2">
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>
        <PlanBadge plan={requiredPlan} />
      </div>
      <UpgradeButton requiredPlan={requiredPlan} />
    </div>
  );
}

function ComingSoonChip({ plan }: { plan: PlanId }) {
  const planObj = PLANS[plan];
  if (planObj.available) return null;
  return (
    <span style={{
      fontSize: 9,
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: "0.06em",
      padding: "2px 7px",
      borderRadius: 20,
      color: "var(--text-muted)",
      background: "var(--surface2)",
      border: "1px solid var(--border)",
      whiteSpace: "nowrap",
    }}>
      Coming Soon
    </span>
  );
}

function UpgradeButton({ requiredPlan }: { requiredPlan: PlanId }) {
  const planObj = PLANS[requiredPlan];
  if (!planObj.available) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        <div style={{
          padding: "10px 24px",
          background: "rgba(168,85,247,0.08)",
          border: "1px solid rgba(168,85,247,0.2)",
          borderRadius: 10,
          color: "var(--text-muted)",
          fontSize: 13,
          fontWeight: 500,
        }}>
          {planObj.label} Plan – Coming Soon
        </div>
        <p style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {planObj.price !== "Custom" ? `${planObj.price} ${planObj.priceNote}` : "Contact us for pricing"}
        </p>
      </div>
    );
  }

  return (
    <a
      href="/billing"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 24px",
        background: "var(--accent)",
        color: "#fff",
        fontWeight: 600,
        fontSize: 13,
        borderRadius: 10,
        textDecoration: "none",
      }}
    >
      Upgrade to {planObj.label}
    </a>
  );
}

export function AdminUpgradeButton({
  label = "Enterprise Admin",
  style,
}: {
  label?: string;
  style?: React.CSSProperties;
}) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<any>(null);

  const show = () => {
    setVisible(true);
    if (timerRef.current) clearTimeout(timerRef.current);
  };

  const hide = () => {
    timerRef.current = setTimeout(() => {
      setVisible(false);
    }, 500);
  };

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setVisible(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setVisible(false);
    }, 3000);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div style={{ position: "relative", width: style?.width || "100%", display: "inline-block" }}>
      <button
        type="button"
        onMouseEnter={show}
        onMouseLeave={hide}
        onClick={handleClick}
        style={{
          width: "100%",
          padding: "10px 0",
          background: "var(--surface2)",
          border: "1px solid var(--border)",
          color: "var(--text-muted)",
          fontWeight: 600,
          fontSize: 13,
          borderRadius: 8,
          cursor: "not-allowed",
          opacity: 0.8,
          transition: "background 0.15s, border-color 0.15s",
          ...style,
        }}
      >
        {label}
      </button>
      {visible && (
        <div
          style={{
            position: "absolute",
            bottom: "125%",
            left: "50%",
            transform: "translateX(-50%)",
            background: "#1e1b4b",
            color: "#e0e7ff",
            border: "1px solid #4338ca",
            borderRadius: 6,
            padding: "8px 12px",
            fontSize: 12,
            lineHeight: 1.4,
            fontWeight: 500,
            width: 220,
            textAlign: "center",
            boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
            zIndex: 999,
            pointerEvents: "none",
          }}
        >
          <div style={{ fontWeight: 700, color: "#a5b4fc", marginBottom: 3 }}>Enterprise Admin</div>
          You are an Admin. This grants you full Enterprise features with infinity amounts.
          <div
            style={{
              position: "absolute",
              top: "100%",
              left: "50%",
              transform: "translateX(-50%)",
              width: 0,
              height: 0,
              borderLeft: "6px solid transparent",
              borderRight: "6px solid transparent",
              borderTop: "6px solid #4338ca",
            }}
          />
        </div>
      )}
    </div>
  );
}

export function PlanCard({
  plan,
  isCurrentPlan,
  onSelect,
  isAdmin = false,
}: {
  plan: typeof PLANS[PlanId];
  isCurrentPlan: boolean;
  onSelect?: () => void;
  isAdmin?: boolean;
}) {
  const featureList: Array<{ key: keyof PlanFeatures; included: boolean }> = [
    { key: "organizations", included: plan.features.organizations },
    { key: "teams", included: plan.features.teams },
    { key: "sharedVault", included: plan.features.sharedVault },
    { key: "auditLogs", included: plan.features.auditLogs },
    { key: "usageAnalytics", included: plan.features.usageAnalytics },
    { key: "customProjectKeys", included: plan.features.customProjectKeys },
    { key: "crossWorkspaceSearch", included: plan.features.crossWorkspaceSearch },
    { key: "bulkExport", included: plan.features.bulkExport },
  ];

  const isBusiness = plan.id === "business";

  return (
    <div style={{
      background: "var(--surface)",
      border: isBusiness
        ? "2px solid rgba(168,85,247,0.5)"
        : "1px solid var(--border)",
      borderRadius: 12,
      padding: "24px 22px",
      display: "flex",
      flexDirection: "column",
      gap: 16,
      position: "relative",
    }}>
      {isBusiness && (
        <div style={{
          position: "absolute",
          top: -10,
          left: "50%",
          transform: "translateX(-50%)",
          background: "var(--accent)",
          color: "#fff",
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          padding: "3px 12px",
          borderRadius: 20,
          whiteSpace: "nowrap",
        }}>
          Recommended
        </div>
      )}

      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <PlanBadge plan={plan.id} />
          {isCurrentPlan && (
            <span style={{ fontSize: 10, color: "var(--success)", fontWeight: 600, letterSpacing: "0.04em" }}>
              CURRENT
            </span>
          )}
        </div>
        <div style={{ fontSize: 28, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.03em", marginTop: 8 }}>
          {plan.price}
          {plan.price !== "Free" && plan.price !== "Custom" && (
            <span style={{ fontSize: 13, fontWeight: 400, color: "var(--text-muted)" }}>/seat/mo</span>
          )}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{plan.priceNote}</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>Limits</div>
        {[
          ["Memories", plan.limits.maxMemories === Infinity ? "Unlimited" : plan.limits.maxMemories.toLocaleString()],
          ["Monthly Recalls", plan.limits.maxMonthlyRecalls === Infinity ? "Unlimited" : plan.limits.maxMonthlyRecalls.toLocaleString()],
          ["API Tokens", plan.limits.maxApiTokens === Infinity ? "Unlimited" : plan.limits.maxApiTokens],
          ...(plan.id !== "free" ? [["Org Members", plan.limits.maxOrgMembers === Infinity ? "Unlimited" : String(plan.limits.maxOrgMembers)]] : []),
        ].map(([label, value]) => (
          <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
            <span style={{ color: "var(--text-muted)" }}>{label}</span>
            <span style={{ color: "var(--text)", fontWeight: 600 }}>{value}</span>
          </div>
        ))}
      </div>

      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 7 }}>
        {featureList.map(({ key, included }) => (
          <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            {included ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--border)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            )}
            <span style={{ color: included ? "var(--text)" : "var(--text-muted)", opacity: included ? 1 : 0.5 }}>
              {FEATURE_DESCRIPTIONS[key].label}
            </span>
            {!plan.available && included && <ComingSoonChip plan={plan.id} />}
          </div>
        ))}
      </div>

      {!isCurrentPlan && (
        <div style={{ marginTop: 4 }}>
          {isAdmin ? (
            <AdminUpgradeButton label={`Upgrade to ${plan.label}`} />
          ) : plan.available ? (
            <button
              onClick={onSelect}
              style={{
                width: "100%",
                padding: "10px 0",
                background: isBusiness ? "var(--accent)" : "transparent",
                border: isBusiness ? "none" : "1px solid var(--border)",
                color: isBusiness ? "#fff" : "var(--text-muted)",
                fontWeight: 600,
                fontSize: 13,
                borderRadius: 8,
                cursor: "pointer",
              }}
            >
              Upgrade to {plan.label}
            </button>
          ) : (
            <button
              disabled
              style={{
                width: "100%",
                padding: "10px 0",
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                color: "var(--text-muted)",
                fontWeight: 500,
                fontSize: 13,
                borderRadius: 8,
                cursor: "not-allowed",
                opacity: 0.6,
              }}
            >
              Coming Soon
            </button>
          )}
        </div>
      )}
    </div>
  );
}
