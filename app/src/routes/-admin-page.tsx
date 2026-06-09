import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { planHasFeature, type PlanId } from "~/lib/plans";
import { AdminLayout, type AdminSection } from "~/components/AdminLayout";
import { SiteAdminSection, OrgAdminSection, AdminCard } from "~/components/AdminSections";
import { SystemOverviewSection } from "~/components/AdminSystemOverview";
import { UserManagementSection } from "~/components/AdminUserManagement";
import { UnifiedActivitySection } from "~/components/AdminActivitySection";
import { AdminUsersSection } from "~/components/AdminUsersSection";
import { AdminOrgsSection } from "~/components/AdminOrgsSection";
import { AdminTeamsSection } from "~/components/AdminTeamsSection";
import { BYOKSetup } from "~/components/Vault/BYOKSetup";
import { AdminDbTools } from "~/components/AdminDbTools";
import { SiteConfigSection } from "~/components/AdminSiteConfig";
import { getAdminStatus } from "~/routes/admin";
import { MyUsageSection, MyBillingSection, OrgBillingSection, useBillingData } from "~/routes/billing";
import {
  ProfileSection, ApiTokensSection, McpEndpointSection,
  TwoFactorSection, PasscodeSection, SessionsSection, WebhookSecretsSection,
} from "~/routes/-_settings-components";

function AdminPage() {
  const [activeSection, setActiveSection] = useState<AdminSection>("personal-account");

  const { data: adminStatus } = useQuery({
    queryKey: ["admin-status"],
    queryFn: () => getAdminStatus(),
  });

  const { data: billingData } = useBillingData();
  const userPlan = (billingData?.personalPlanId ?? "free") as PlanId;
  const canAccessOrgs = (billingData?.managedOrgs?.length ?? 0) > 0 || planHasFeature(userPlan, "organizations");
  const isOrgAdmin = canAccessOrgs;
  const isSiteAdmin = adminStatus?.isAdmin ?? false;

  return (
    <AdminLayout
      activeSection={activeSection}
      onSectionChange={setActiveSection}
      isOrgAdmin={isOrgAdmin}
      isSiteAdmin={isSiteAdmin}
    >
      {/* ── Personal ──────────────────────────────────────────────────────── */}
      {activeSection === "personal-account" && <ProfileSection />}

      {activeSection === "personal-security" && (
        <div className="flex flex-col gap-6">
          <TwoFactorSection />
          <PasscodeSection />
        </div>
      )}

      {activeSection === "personal-sessions" && <SessionsSection />}
      {activeSection === "personal-tokens" && <ApiTokensSection />}
      {activeSection === "personal-mcp" && <McpEndpointSection />}
      {activeSection === "personal-usage" && <MyUsageSection />}
      {activeSection === "personal-billing" && <MyBillingSection />}
      {activeSection === "personal-activity" && <UnifiedActivitySection scope="personal" />}
      {activeSection === "personal-webhooks" && <WebhookSecretsSection scopeType="personal" />}

      {/* ── System (site admin) ───────────────────────────────────────────── */}
      {activeSection === "system" && (
        <>
          <SystemOverviewSection />
          <details style={{ marginTop: 16 }}>
            <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 700, color: "var(--text-muted)", padding: "8px 0", userSelect: "none" }}>
              ⚙️ Database & Vector Tools
            </summary>
            <div style={{ marginTop: 12 }}>
              <AdminDbTools />
            </div>
          </details>
        </>
      )}

      {/* ── User management (site admin) ──────────────────────────────────── */}
      {activeSection === "user-management" && <UserManagementSection />}

      {/* ── Site config (site admin) ──────────────────────────────────────── */}
      {activeSection === "site-config" && <SiteConfigSection />}

      {/* ── Billing management (site admin) ───────────────────────────────── */}
      {activeSection === "billing-manage" && (
        <SiteAdminSection title="Billing Management" description="Manage subscription metrics and revenue" icon="💳">
          <AdminCard>
            <p style={{ color: "var(--text-muted)", margin: 0 }}>Billing dashboard coming soon...</p>
          </AdminCard>
        </SiteAdminSection>
      )}

      {/* ── Orgs ─────────────────────────────────────────────────────────── */}
      {activeSection === "orgs" && <AdminOrgsSection />}

      {/* ── Org Security (BYOK + SSO) ─────────────────────────────────────── */}
      {activeSection === "org-security" && (
        <OrgSecuritySection managedOrgs={billingData?.managedOrgs ?? []} />
      )}

      {/* ── Org billing ──────────────────────────────────────────────────── */}
      {activeSection === "org-billing" && <OrgBillingSection />}

      {/* ── Org audit logs ───────────────────────────────────────────────── */}
      {activeSection === "org-audit-logs" && (
        <OrgAdminSection title="Org Activity" description="All actions taken within your organization" icon="📋">
          <UnifiedActivitySection scope="org" />
        </OrgAdminSection>
      )}

      {/* ── Org webhooks ─────────────────────────────────────────────────── */}
      {activeSection === "org-webhooks" && (
        <OrgAdminSection title="Org Webhooks" description="Configure GitHub and Linear webhook signing secrets" icon="🔗">
          <WebhookSecretsSection scopeType="org" />
        </OrgAdminSection>
      )}

      {/* ── Users directory (site admin) ─────────────────────────────────── */}
      {activeSection === "users" && <AdminUsersSection adminUserId={adminStatus?.userId} />}

      {/* ── Teams ────────────────────────────────────────────────────────── */}
      {activeSection === "teams" && <AdminTeamsSection />}

      {/* ── Site audit logs (site admin) ─────────────────────────────────── */}
      {activeSection === "site-audit-logs" && (
        <SiteAdminSection title="Site Activity" description="All organization activity — site admin access only" icon="🔒">
          <UnifiedActivitySection scope="site" />
        </SiteAdminSection>
      )}
    </AdminLayout>
  );
}

// ── Org Security Section ──────────────────────────────────────────────────────

function OrgSecuritySection({ managedOrgs }: { managedOrgs: any[] }) {
  const [selectedOrgId, setSelectedOrgId] = useState<string>(
    managedOrgs[0]?.id ?? "",
  );

  const selectedOrg = managedOrgs.find((o) => o.id === selectedOrgId);

  if (managedOrgs.length === 0) {
    return (
      <OrgAdminSection title="Org Security" description="BYOK encryption and SSO configuration" icon="🔐">
        <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
          You are not an admin of any organization.
        </p>
      </OrgAdminSection>
    );
  }

  return (
    <OrgAdminSection title="Org Security" description="Bring Your Own Key (BYOK) encryption and Enterprise SSO" icon="🔐">
      {/* Org picker — only shown when the admin manages multiple orgs */}
      {managedOrgs.length > 1 && (
        <div style={{ marginBottom: 24 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 6 }}>
            Organization
          </label>
          <select
            value={selectedOrgId}
            onChange={(e) => setSelectedOrgId(e.target.value)}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--surface2)",
              color: "var(--text)",
              fontSize: 13,
              cursor: "pointer",
              minWidth: 240,
            }}
          >
            {managedOrgs.map((org: any) => (
              <option key={org.id} value={org.id}>
                {org.name} ({org.plan})
              </option>
            ))}
          </select>
        </div>
      )}

      {selectedOrg && (
        <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
          {/* ── BYOK ── */}
          <div>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>
              End-to-End Encryption (BYOK)
            </h3>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
              Memories are encrypted in your browser before leaving your device.
              The server only stores the ciphertext — it never sees plaintext.
              Available on all plans; external KMS requires Enterprise.
            </p>
            <BYOKSetup orgId={selectedOrg.id} />
          </div>

          {/* ── SSO ── */}
          <div>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}>
              Single Sign-On (SSO)
              {selectedOrg.plan !== "enterprise" && (
                <span style={{ fontSize: 10, fontWeight: 700, background: "var(--accent)", color: "white", padding: "2px 6px", borderRadius: 4 }}>
                  Enterprise
                </span>
              )}
            </h3>
            {selectedOrg.plan === "enterprise" ? (
              <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
                Contact{" "}
                <a href="mailto:support@locker.app" style={{ color: "var(--accent)" }}>
                  support@locker.app
                </a>{" "}
                to provision your SAML/OIDC IdP. Supported providers: Okta,
                Microsoft Entra ID, Google Workspace, PingFederate, and any
                OIDC-compliant IdP. Once provisioned, your ACS URL and SP
                entity ID will appear here for activation.
              </p>
            ) : (
              <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
                Upgrade <strong>{selectedOrg.name}</strong> to the Enterprise
                plan to configure SAML or OIDC single sign-on.
              </p>
            )}
          </div>
        </div>
      )}
    </OrgAdminSection>
  );
}

export function AdminGuard() {
  const { isLoading } = useQuery({
    queryKey: ["admin-status"],
    queryFn: () => getAdminStatus(),
  });

  if (isLoading) return <p style={{ padding: 32, color: "var(--text-muted)" }}>Loading…</p>;

  return <AdminPage />;
}
