import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { requireSession } from "~/server/session";
import { grantAdminBusinessComp } from "~/server/admin";
import { users, userPlans, organizations, organizationMembers } from "~/db/schema";
import type { CloudflareEnv } from "~/types/cloudflare";
import { PageContainer } from "~/components/PageContainer";
import { PageHeader } from "~/components/PageHeader";

type CFContext = { cloudflare: { env: CloudflareEnv; ctx: ExecutionContext } };

/**
 * Grant or revoke admin business_comp plan access.
 * Only callable by the system owner.
 */
export const grantAdminPlan = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { email: string; action: "grant" | "revoke" } => {
    const d = data as any;
    if (!d.email || !d.action) throw new Error("Missing email or action");
    if (!["grant", "revoke"].includes(d.action)) throw new Error("Invalid action");
    return { email: d.email, action: d.action };
  })
  .handler(async ({ data, context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = drizzle(env.DB, { schema: { users, userPlans, organizations, organizationMembers } });

    // Simple owner check: only allow if user is in the system owner list (in practice, check env.OWNER_EMAIL or similar)
    const ownerEmail = env.OWNER_EMAIL || "rogerleecormier@gmail.com";
    if (user.email !== ownerEmail) {
      throw new Error("Forbidden: Only the owner can grant admin plans");
    }

    // Find target user
    const targetUser = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.email, data.email))
      .limit(1)
      .all();

    if (targetUser.length === 0) {
      throw new Error(`User not found: ${data.email}`);
    }

    const targetUserId = targetUser[0].id;

    if (data.action === "grant") {
      await grantAdminBusinessComp(db, targetUserId, user.id, "admin_grant");
      return { success: true, message: `Granted business_comp to ${data.email}` };
    } else {
      // Revoke: reset to free
      await db
        .update(userPlans)
        .set({
          plan: "free",
          updatedAt: new Date(),
        })
        .where(eq(userPlans.userId, targetUserId))
        .run();
      return { success: true, message: `Revoked business_comp from ${data.email}` };
    }
  });

export const Route = createFileRoute("/admin/grants")({
  component: AdminGrantsPage,
});

function AdminGrantsPage() {
  return (
    <div className="flex-1 min-h-screen bg-background">
      <PageHeader
        title="Admin Plan Grants"
        description="Manage complimentary business_comp plan access for admin accounts."
      />
      <PageContainer>
        <div className="max-w-2xl">
          <section className="bg-surface border border-border rounded-2xl p-5 flex flex-col gap-4 shadow-xs">
            <p className="text-xs text-text-muted leading-relaxed">
              Use the API to grant or revoke business_comp (complimentary Business plan) access:
            </p>
            <div className="bg-surface2 border border-border rounded-lg p-4 font-mono text-[11px] text-text-muted overflow-auto">
              <div className="text-accent mb-2">POST /admin/grants</div>
              <div className="text-text">
                {`{
  "email": "admin@example.com",
  "action": "grant" // or "revoke"
}`}
              </div>
            </div>
            <p className="text-xs text-text-muted leading-relaxed mt-2">
              This endpoint is only callable by the system owner and will immediately update the user's plan tier in the database.
            </p>
          </section>
        </div>
      </PageContainer>
    </div>
  );
}
