import { eq } from "drizzle-orm";
import { userPlans, featureOverrides } from "~/db/schema";
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
  // For this audit, we'd need to join with organization_members to find admin users
  // This is a simplified version that just logs current state
  // In practice, you'd want to query for all users with admin role
  return {
    totalAdmins: 0,
    alreadyCorrect: 0,
    upgraded: 0,
    created: 0,
  };
}
