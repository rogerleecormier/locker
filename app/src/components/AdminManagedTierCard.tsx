import { useQuery } from "@tanstack/react-query";
import { getManagedTierInfo, type ManagedTierInfo } from "~/routes/admin";

interface AdminManagedTierCardProps {
  orgId: string;
  orgName: string;
}

export function AdminManagedTierCard({ orgId, orgName }: AdminManagedTierCardProps) {
  const { data: tierInfo, isLoading, isError } = useQuery({
    queryKey: ["managed-tier", orgId],
    queryFn: () => getManagedTierInfo({ data: { orgId } }),
  });

  if (isLoading || isError || !tierInfo) {
    return null;
  }

  const isProvisioned = !!tierInfo.vaultId;

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 18px" }}>
      <h4 style={{ margin: "0 0 12px 0", fontSize: 14, fontWeight: "bold" }}>Managed Tier Settings</h4>

      {!isProvisioned ? (
        <div style={{ padding: "12px", background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.3)", borderRadius: 8, color: "var(--text-muted)", fontSize: 12 }}>
          This organization has not been provisioned as a managed tier. Provisioning occurs automatically on successful Paddle checkout.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Vault Status */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4, fontWeight: 600 }}>
                Vault ID
              </div>
              <code style={{ fontSize: 12, color: "var(--accent)", wordBreak: "break-all" }}>
                {tierInfo.vaultId}
              </code>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4, fontWeight: 600 }}>
                Vault Status
              </div>
              <div style={{
                display: "inline-block",
                padding: "2px 8px",
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 600,
                background: tierInfo.vaultStatus === "active" ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)",
                color: tierInfo.vaultStatus === "active" ? "#10b981" : "#ef4444",
              }}>
                {tierInfo.vaultStatus}
              </div>
            </div>
          </div>

          {/* Provisioning Date */}
          {tierInfo.provisionedAt && (
            <div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4, fontWeight: 600 }}>
                Provisioned
              </div>
              <div style={{ fontSize: 12 }}>
                {new Date(tierInfo.provisionedAt).toLocaleString()}
              </div>
            </div>
          )}

          {/* KEK Reference */}
          {tierInfo.masterKekRef && (
            <div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4, fontWeight: 600 }}>
                Master KEK Reference
              </div>
              <code style={{ fontSize: 11, color: "var(--text-muted)", background: "var(--surface2)", padding: "4px 6px", borderRadius: 4, display: "inline-block" }}>
                {tierInfo.masterKekRef}
              </code>
            </div>
          )}

          {/* Billing Info */}
          {(tierInfo.billingCustomerId || tierInfo.billingSubscriptionId) && (
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Billing
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {tierInfo.billingCustomerId && (
                  <div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 2 }}>Customer ID</div>
                    <code style={{ fontSize: 11, color: "var(--accent)" }}>
                      {tierInfo.billingCustomerId}
                    </code>
                  </div>
                )}
                {tierInfo.billingSubscriptionId && (
                  <div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 2 }}>Subscription ID</div>
                    <code style={{ fontSize: 11, color: "var(--accent)" }}>
                      {tierInfo.billingSubscriptionId}
                    </code>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Plan Badge */}
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6, fontWeight: 600 }}>
              Billing Plan
            </div>
            <span style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "4px 10px",
              borderRadius: 6,
              textTransform: "uppercase",
              background: tierInfo.billingPlan === "enterprise" ? "rgba(16,185,129,0.15)" : tierInfo.billingPlan === "business" ? "rgba(168,85,247,0.15)" : "var(--surface2)",
              color: tierInfo.billingPlan === "enterprise" ? "#10b981" : tierInfo.billingPlan === "business" ? "var(--accent)" : "var(--text-muted)",
            }}>
              {tierInfo.billingPlan}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
