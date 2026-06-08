import { createServerFn } from "@tanstack/react-start";
import { drizzle } from "drizzle-orm/d1";
import { eq, and, sql } from "drizzle-orm";
import Stripe from "stripe";
import { requireSession } from "./session";
import {
  userPlans,
  organizations,
  organizationMembers,
  orgQuotas,
  users,
  stripeEvents,
} from "~/db/schema";
import type { CloudflareEnv } from "~/types/cloudflare";

type CFContext = { cloudflare: { env: CloudflareEnv; ctx: ExecutionContext } };

async function verifyOrgAdmin(db: any, userId: string, orgId: string): Promise<boolean> {
  const row = await db
    .select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, userId)))
    .limit(1)
    .all();
  if (row.length === 0) return false;
  return row[0].role === "owner" || row[0].role === "admin";
}

export const createCheckoutSession = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { orgId?: string } => {
    const d = data as { orgId?: string };
    return { orgId: d?.orgId };
  })
  .handler(async ({ data, context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = drizzle(env.DB, {
      schema: { userPlans, organizations, organizationMembers, orgQuotas, users },
    });

    let quantity = 1;
    let productName = "Locker Business Plan (Personal)";
    let description = "Unlock unlimited memories, custom keys, and advanced API access.";

    if (data.orgId) {
      const isOrgAdmin = await verifyOrgAdmin(db, user.id, data.orgId);
      if (!isOrgAdmin) {
        throw new Error("Forbidden: Not an organization owner/admin");
      }

      // Count organization members to determine seats
      const membersCount = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(organizationMembers)
        .where(eq(organizationMembers.orgId, data.orgId))
        .all();
      quantity = Math.max(1, Number(membersCount[0]?.count ?? 1));

      // Get organization name
      const orgRow = await db
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, data.orgId))
        .limit(1)
        .all();
      const orgName = orgRow[0]?.name ?? "Organization";
      productName = `Locker Business Plan (${orgName})`;
      description = `Business subscription for ${quantity} organization member seat(s).`;
    }

    if (!env.STRIPE_SECRET_KEY) {
      throw new Error("Stripe secret key is not configured.");
    }

    const stripe = new Stripe(env.STRIPE_SECRET_KEY);

    let customerId: string | undefined = undefined;
    if (data.orgId) {
      const orgRow = await db
        .select({ billingCustomerId: organizations.billingCustomerId })
        .from(organizations)
        .where(eq(organizations.id, data.orgId))
        .limit(1)
        .all();
      if (orgRow[0]?.billingCustomerId) {
        customerId = orgRow[0].billingCustomerId;
      }
    } else {
      const userPlanRow = await db
        .select({ billingCustomerId: userPlans.billingCustomerId })
        .from(userPlans)
        .where(eq(userPlans.userId, user.id))
        .limit(1)
        .all();
      if (userPlanRow[0]?.billingCustomerId) {
        customerId = userPlanRow[0].billingCustomerId;
      }
    }

    const origin = env.BETTER_AUTH_URL || "http://localhost:5173";
    const successUrl = `${origin}/billing?success=true`;
    const cancelUrl = `${origin}/billing?cancelled=true`;

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: productName,
              description,
            },
            unit_amount: 1200, // $12.00
            recurring: {
              interval: "month",
            },
          },
          quantity,
        },
      ],
      mode: "subscription",
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        userId: user.id,
        orgId: data.orgId || "",
      },
      subscription_data: {
        metadata: {
          userId: user.id,
          orgId: data.orgId || "",
        },
      },
    });

    return { url: session.url };
  });

export const createPortalSession = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { orgId?: string } => {
    const d = data as { orgId?: string };
    return { orgId: d?.orgId };
  })
  .handler(async ({ data, context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = drizzle(env.DB, { schema: { userPlans, organizations, organizationMembers } });

    let customerId: string | undefined = undefined;
    if (data.orgId) {
      const isOrgAdmin = await verifyOrgAdmin(db, user.id, data.orgId);
      if (!isOrgAdmin) {
        throw new Error("Forbidden: Not an organization owner/admin");
      }
      const orgRow = await db
        .select({ billingCustomerId: organizations.billingCustomerId })
        .from(organizations)
        .where(eq(organizations.id, data.orgId))
        .limit(1)
        .all();
      customerId = orgRow[0]?.billingCustomerId ?? undefined;
    } else {
      const userPlanRow = await db
        .select({ billingCustomerId: userPlans.billingCustomerId })
        .from(userPlans)
        .where(eq(userPlans.userId, user.id))
        .limit(1)
        .all();
      customerId = userPlanRow[0]?.billingCustomerId ?? undefined;
    }

    if (!customerId) {
      throw new Error("No billing history found. Please upgrade first.");
    }

    if (!env.STRIPE_SECRET_KEY) {
      throw new Error("Stripe secret key is not configured.");
    }

    const stripe = new Stripe(env.STRIPE_SECRET_KEY);
    const origin = env.BETTER_AUTH_URL || "http://localhost:5173";

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/billing`,
    });

    return { url: session.url };
  });

async function userExists(db: any, userId: string): Promise<boolean> {
  const row = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .all();
  return row.length > 0;
}

async function orgExists(db: any, orgId: string): Promise<boolean> {
  const row = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1)
    .all();
  return row.length > 0;
}

export async function handleStripeWebhook(request: Request, env: CloudflareEnv): Promise<Response> {
  if (!env.STRIPE_SECRET_KEY) {
    return new Response("Stripe not configured", { status: 500 });
  }

  const stripe = new Stripe(env.STRIPE_SECRET_KEY);
  const signature = request.headers.get("stripe-signature") || "";
  const bodyText = await request.text();

  if (!env.STRIPE_WEBHOOK_SECRET) {
    return new Response("STRIPE_WEBHOOK_SECRET not configured", { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(bodyText, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (err: any) {
    console.error(`Webhook signature verification failed: ${err.message}`);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  const db = drizzle(env.DB, { schema: { userPlans, organizations, orgQuotas, users, stripeEvents } });

  console.log(`[stripe-webhook] received event: ${event.type} id: ${event.id}`);

  // Idempotency guard: check if we've already processed this event
  const existingEvent = await db
    .select({ id: stripeEvents.id })
    .from(stripeEvents)
    .where(eq(stripeEvents.id, event.id))
    .limit(1)
    .all();

  if (existingEvent.length > 0) {
    console.log(`[stripe-webhook] event already processed: ${event.id}`);
    return new Response("OK", { status: 200 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;
        const orgId = session.metadata?.orgId;
        const billingCustomerId = session.customer as string;
        const billingSubscriptionId = session.subscription as string;

        if (!userId) {
          console.error("[stripe-webhook] missing userId in session metadata");
          return new Response("Missing userId metadata", { status: 400 });
        }

        // Verify userId actually exists in the database
        if (!(await userExists(db, userId))) {
          console.error("[stripe-webhook] userId does not exist in database: " + userId);
          return new Response("Invalid userId", { status: 400 });
        }

        // Verify orgId exists if provided
        if (orgId && !(await orgExists(db, orgId))) {
          console.error("[stripe-webhook] orgId does not exist in database: " + orgId);
          return new Response("Invalid orgId", { status: 400 });
        }

        // Upsert user plans table
        const existingUserPlan = await db
          .select()
          .from(userPlans)
          .where(eq(userPlans.userId, userId))
          .limit(1)
          .all();

        if (existingUserPlan.length > 0) {
          await db
            .update(userPlans)
            .set({
              plan: "business",
              billingCustomerId,
              billingSubscriptionId,
              planActivatedAt: Date.now(),
              updatedAt: new Date(),
            })
            .where(eq(userPlans.userId, userId));
        } else {
          await db
            .insert(userPlans)
            .values({
              userId,
              plan: "business",
              billingCustomerId,
              billingSubscriptionId,
              planActivatedAt: Date.now(),
              createdAt: new Date(),
              updatedAt: new Date(),
            });
        }

        // If organization ID metadata exists, upgrade the organization
        if (orgId) {
          await db
            .update(organizations)
            .set({
              plan: "business",
              billingCustomerId,
              billingSubscriptionId,
              planActivatedAt: Date.now(),
            })
            .where(eq(organizations.id, orgId));

          const existingQuota = await db
            .select()
            .from(orgQuotas)
            .where(eq(orgQuotas.orgId, orgId))
            .limit(1)
            .all();

          if (existingQuota.length > 0) {
            await db
              .update(orgQuotas)
              .set({
                plan: "business",
                monthlyMemories: 10000,
                monthlyRecalls: 50000,
                monthlyCommits: 10000,
              })
              .where(eq(orgQuotas.orgId, orgId));
          } else {
            await db
              .insert(orgQuotas)
              .values({
                orgId,
                plan: "business",
                monthlyMemories: 10000,
                monthlyRecalls: 50000,
                monthlyCommits: 10000,
              });
          }
          console.log(`[stripe-webhook] Upgraded org ${orgId} to Business plan by user ${userId}`);
        } else {
          console.log(`[stripe-webhook] Upgraded user ${userId} to Business plan`);
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const billingSubscriptionId = subscription.id;
        const billingCustomerId = subscription.customer as string;
        const userId = subscription.metadata?.userId;
        const orgId = subscription.metadata?.orgId;
        const status = subscription.status;

        if (!userId) {
          console.error("[stripe-webhook] missing userId in subscription metadata");
          break;
        }

        // Verify userId actually exists in the database
        if (!(await userExists(db, userId))) {
          console.error("[stripe-webhook] userId does not exist in database: " + userId);
          break;
        }

        // Verify orgId exists if provided
        if (orgId && !(await orgExists(db, orgId))) {
          console.error("[stripe-webhook] orgId does not exist in database: " + orgId);
          break;
        }

        // Verify that this subscription is either the active one or we are transitioning a new active subscription
        const currentPlanRow = await db
          .select({ billingSubscriptionId: userPlans.billingSubscriptionId })
          .from(userPlans)
          .where(eq(userPlans.userId, userId))
          .limit(1)
          .all();
        
        const isSelf = currentPlanRow.length > 0 && currentPlanRow[0].billingSubscriptionId === billingSubscriptionId;
        const isEmpty = currentPlanRow.length === 0 || !currentPlanRow[0].billingSubscriptionId;

        if (isSelf || isEmpty) {
          const plan = (status === "active" || status === "trialing") ? "business" : "free";

          // Update user plans table
          await db
            .update(userPlans)
            .set({
              plan,
              billingCustomerId,
              billingSubscriptionId,
              updatedAt: new Date(),
            })
            .where(eq(userPlans.userId, userId));

          // Update organization if metadata exists
          if (orgId) {
            await db
              .update(organizations)
              .set({
                plan,
                billingCustomerId,
                billingSubscriptionId,
                planActivatedAt: (status === "active" || status === "trialing") ? Date.now() : null,
              })
              .where(eq(organizations.id, orgId));

            await db
              .update(orgQuotas)
              .set({
                plan,
                monthlyMemories: plan === "business" ? 10000 : 100,
                monthlyRecalls: plan === "business" ? 50000 : 1000,
                monthlyCommits: plan === "business" ? 10000 : 500,
              })
              .where(eq(orgQuotas.orgId, orgId));
          }

          console.log(`[stripe-webhook] Subscription updated for user ${userId} (org: ${orgId ?? "none"}), status is now: ${status}`);
        } else {
          console.log(`[stripe-webhook] Ignored subscription update for user ${userId} (active subscription does not match)`);
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const userId = subscription.metadata?.userId;
        const orgId = subscription.metadata?.orgId;
        const billingSubscriptionId = subscription.id;

        if (!userId) {
          console.error("[stripe-webhook] missing userId in subscription metadata");
          break;
        }

        // Verify userId actually exists in the database
        if (!(await userExists(db, userId))) {
          console.error("[stripe-webhook] userId does not exist in database: " + userId);
          break;
        }

        // Verify orgId exists if provided
        if (orgId && !(await orgExists(db, orgId))) {
          console.error("[stripe-webhook] orgId does not exist in database: " + orgId);
          break;
        }

        // Verify that this subscription is indeed the active one for the user
        const currentPlanRow = await db
          .select({ billingSubscriptionId: userPlans.billingSubscriptionId })
          .from(userPlans)
          .where(eq(userPlans.userId, userId))
          .limit(1)
          .all();

        if (currentPlanRow.length > 0 && currentPlanRow[0].billingSubscriptionId === billingSubscriptionId) {
          await db
            .update(userPlans)
            .set({
              plan: "free",
              billingSubscriptionId: null,
              planExpiresAt: Date.now(),
              updatedAt: new Date(),
            })
            .where(eq(userPlans.userId, userId));

          if (orgId) {
            await db
              .update(organizations)
              .set({
                plan: "free",
                billingSubscriptionId: null,
                planExpiresAt: Date.now(),
              })
              .where(eq(organizations.id, orgId));

            await db
              .update(orgQuotas)
              .set({
                plan: "free",
                monthlyMemories: 100,
                monthlyRecalls: 1000,
                monthlyCommits: 500,
              })
              .where(eq(orgQuotas.orgId, orgId));
          }
          console.log(`[stripe-webhook] Subscription deleted for user ${userId} (org: ${orgId ?? "none"})`);
        } else {
          console.log(`[stripe-webhook] Ignored subscription deletion for user ${userId} (active subscription does not match)`);
        }
        break;
      }
    }
  } catch (err: any) {
    console.error(`[stripe-webhook] processing error: ${err.message}`);
    return new Response(`Webhook Error: ${err.message}`, { status: 500 });
  }

  // Record event as processed
  await db
    .insert(stripeEvents)
    .values({
      id: event.id,
      type: event.type,
      processedAt: Date.now(),
    })
    .catch((err) => console.error(`[stripe-webhook] failed to record event: ${err.message}`));

  return new Response("OK", { status: 200 });
}

export async function updateSubscriptionSeats(db: any, env: CloudflareEnv, orgId: string): Promise<void> {
  if (!env.STRIPE_SECRET_KEY) {
    console.warn("[stripe-sync] Stripe is not configured, skipping seat sync.");
    return;
  }

  const syncDb = drizzle(env.DB, { schema: { organizations, organizationMembers } });

  try {
    // 1. Get organization subscription information
    const orgRow = await syncDb
      .select({
        plan: organizations.plan,
        billingSubscriptionId: organizations.billingSubscriptionId,
      })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1)
      .all();

    const org = orgRow[0];
    if (!org || org.plan !== "business" || !org.billingSubscriptionId) {
      console.log(`[stripe-sync] Org ${orgId} is not on an active business subscription, skipping seat sync.`);
      return;
    }

    // 2. Count current active members in organization
    const membersCountResult = await syncDb
      .select({ count: sql<number>`COUNT(*)` })
      .from(organizationMembers)
      .where(eq(organizationMembers.orgId, orgId))
      .all();
    const quantity = Math.max(1, Number(membersCountResult[0]?.count ?? 1));

    // 3. Update Stripe subscription item quantity
    const stripe = new Stripe(env.STRIPE_SECRET_KEY);
    const subscription = await stripe.subscriptions.retrieve(org.billingSubscriptionId);
    const item = subscription.items.data[0];
    if (item) {
      if (item.quantity !== quantity) {
        await stripe.subscriptionItems.update(item.id, {
          quantity,
          proration_behavior: "always_invoice",
        });
        console.log(`[stripe-sync] Synced Stripe subscription ${org.billingSubscriptionId} for org ${orgId} to quantity ${quantity}`);
      } else {
        console.log(`[stripe-sync] Stripe subscription quantity already matches member count (${quantity})`);
      }
    } else {
      console.warn(`[stripe-sync] No items found on Stripe subscription ${org.billingSubscriptionId}`);
    }
  } catch (err: any) {
    console.error(`[stripe-sync] Failed to sync subscription seats for org ${orgId}: ${err.message}`);
  }
}

