import { eq, inArray } from "drizzle-orm";
import { userPlans, featureOverrides, organizationMembers } from "~/db/schema";
import type { PlanId } from "~/lib/plans";

/**
 * Grant a complimentary business plan to an admin user.
 * Sets the userPlans.plan to 'business_comp' directly.
 * Revokes any existing featureOverrides for this user.
 */
export async function grantAdminBusinessComp(
  db: any,
  userId: string,
  grantedByUserId: string,
  reason = "admin"
): Promise<void> {
  const now = Date.now();

  // Revoke any existing feature overrides
  await db
    .delete(featureOverrides)
    .where(eq(featureOverrides.userId, userId))
    .run();

  // Check if userPlans record exists
  const existingPlan = await db
    .select()
    .from(userPlans)
    .where(eq(userPlans.userId, userId))
    .limit(1)
    .all();

  if (existingPlan.length > 0) {
    // Update existing
    await db
      .update(userPlans)
      .set({
        plan: "business_comp",
        planActivatedAt: now,
        updatedAt: new Date(),
      })
      .where(eq(userPlans.userId, userId))
      .run();
  } else {
    // Create new
    await db
      .insert(userPlans)
      .values({
        userId,
        plan: "business_comp",
        planActivatedAt: now,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
  }

  console.log(`[admin] Granted business_comp plan to user ${userId} (reason: ${reason})`);
}

/**
 * Audit all admin accounts and ensure they have business_comp plan set.
 * Returns a report of what was fixed.
 */
export async function auditAdminPlans(db: any): Promise<{
  totalAdmins: number;
  alreadyCorrect: number;
  upgraded: number;
  created: number;
}> {
  // Collect distinct userIds with owner or admin role across all organizations
  const adminMembers = await db
    .select({ userId: organizationMembers.userId })
    .from(organizationMembers)
    .where(inArray(organizationMembers.role, ["owner", "admin"]))
    .all();

  const adminUserIds = [...new Set(adminMembers.map((m: { userId: string }) => m.userId))];
  const totalAdmins = adminUserIds.length;

  if (totalAdmins === 0) {
    return { totalAdmins: 0, alreadyCorrect: 0, upgraded: 0, created: 0 };
  }

  // Fetch existing plan records for these users
  const existingPlans = await db
    .select({ userId: userPlans.userId, plan: userPlans.plan })
    .from(userPlans)
    .where(inArray(userPlans.userId, adminUserIds))
    .all();

  const planByUser = new Map(existingPlans.map((p: { userId: string; plan: string }) => [p.userId, p.plan]));

  let alreadyCorrect = 0;
  let upgraded = 0;
  let created = 0;

  for (const userId of adminUserIds) {
    const plan = planByUser.get(userId);

    if (plan === "business_comp" || plan === "enterprise") {
      alreadyCorrect++;
      continue;
    }

    await grantAdminBusinessComp(db, userId, "system", "admin_audit");

    if (plan === undefined) {
      created++;
    } else {
      upgraded++;
    }
  }

  return { totalAdmins, alreadyCorrect, upgraded, created };
}
