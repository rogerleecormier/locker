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

export function AdminGuard() {
  const { isLoading } = useQuery({
    queryKey: ["admin-status"],
    queryFn: () => getAdminStatus(),
  });

  if (isLoading) return <p style={{ padding: 32, color: "var(--text-muted)" }}>Loading…</p>;

  return <AdminPage />;
}
