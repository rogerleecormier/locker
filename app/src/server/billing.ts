/**
 * Paddle Billing Integration
 *
 * Locker uses Paddle for all billing operations:
 * - Checkout handling
 * - Subscription management
 * - Tax/VAT compliance (handled by Paddle)
 * - Webhook processing for org provisioning
 *
 * Paddle replaces Stripe for better global scalability, reduced tax compliance burden,
 * and built-in support for multiple currencies and VAT.
 */

import { createServerFn } from "@tanstack/react-start";
import { drizzle } from "drizzle-orm/d1";
import { eq, and, sql } from "drizzle-orm";
import { requireSession } from "./session";
import {
  userPlans,
  organizations,
  organizationMembers,
  orgQuotas,
  vaults,
  users,
  billingEvents,
} from "~/db/schema";
import { getOrCreateVaultKey } from "./crypto";
import type { CloudflareEnv } from "~/types/cloudflare";

type CFContext = { cloudflare: { env: CloudflareEnv; ctx: ExecutionContext } };

// ── Paddle Checkout ───────────────────────────────────────────────────────────

/**
 * Initiates a Paddle checkout session.
 * Returns the Paddle checkout URL for the user to complete payment.
 */
export const createPaddleCheckout = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { orgId?: string; plan?: "business" | "enterprise" } => {
    const d = data as { orgId?: string; plan?: string };
    return { orgId: d?.orgId, plan: (d?.plan as any) ?? "business" };
  })
  .handler(async ({ data, context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = drizzle(env.DB, {
      schema: { organizations, organizationMembers, users },
    });

    if (!env.PADDLE_CHECKOUT_URL) {
      throw new Error("Paddle checkout is not configured");
    }

    if (data.orgId) {
      const memberRow = await db
        .select({ role: organizationMembers.role })
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.orgId, data.orgId),
            eq(organizationMembers.userId, user.id)
          )
        )
        .limit(1)
        .all();

      if (memberRow.length === 0 || !["owner", "admin"].includes(memberRow[0].role)) {
        throw new Error("Forbidden: Only org owners/admins can upgrade");
      }

      const orgRow = await db
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, data.orgId))
        .limit(1)
        .all();

      const seatRow = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(organizationMembers)
        .where(eq(organizationMembers.orgId, data.orgId))
        .all();

      const orgName: string = orgRow[0]?.name ?? "Organization";
      const seatCount = Math.max(1, Number(seatRow[0]?.count ?? 1));

      const url = new URL(env.PADDLE_CHECKOUT_URL);
      url.searchParams.set("orgId", data.orgId ?? "");
      url.searchParams.set("orgName", orgName);
      url.searchParams.set("seats", String(seatCount));
      url.searchParams.set("plan", data.plan ?? "business");
      url.searchParams.set("userId", user.id ?? "");

      return { url: url.toString() };
    }

    const url = new URL(env.PADDLE_CHECKOUT_URL);
    url.searchParams.set("plan", data.plan ?? "business");
    url.searchParams.set("userId", user.id ?? "");

    return { url: url.toString() };
  });

// ── Compatibility Wrappers (Stripe → Paddle) ──────────────────────────────────

/**
 * Legacy wrapper for backwards compatibility with billing.tsx.
 * Aliases createPaddleCheckout for personal/org upgrades.
 */
export const createCheckoutSession = createPaddleCheckout;

/**
 * Legacy wrapper for customer portal access.
 * Paddle doesn't have a direct portal URL yet, so we return the checkout URL.
 */
export const createPortalSession = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { orgId?: string; plan?: "business" | "enterprise" } => {
    const d = data as { orgId?: string; plan?: string };
    return { orgId: d?.orgId, plan: (d?.plan as any) ?? "business" };
  })
  .handler(async ({ data, context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = drizzle(env.DB, {
      schema: { organizations, organizationMembers, users },
    });

    if (!env.PADDLE_CHECKOUT_URL) {
      throw new Error("Paddle checkout is not configured");
    }

    // For Paddle, the portal is the checkout URL with the customer's info
    if (data.orgId) {
      const orgRow = await db
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, data.orgId))
        .limit(1)
        .all();

      const seatRow = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(organizationMembers)
        .where(eq(organizationMembers.orgId, data.orgId))
        .all();

      const orgName: string = orgRow[0]?.name ?? "Organization";
      const seatCount = Math.max(1, Number(seatRow[0]?.count ?? 1));

      const url = new URL(env.PADDLE_CHECKOUT_URL);
      url.searchParams.set("orgId", data.orgId ?? "");
      url.searchParams.set("orgName", orgName);
      url.searchParams.set("seats", String(seatCount));
      url.searchParams.set("plan", data.plan ?? "business");
      url.searchParams.set("userId", user.id ?? "");

      return { url: url.toString() };
    }

    const url = new URL(env.PADDLE_CHECKOUT_URL);
    url.searchParams.set("plan", data.plan ?? "business");
    url.searchParams.set("userId", user.id ?? "");

    return { url: url.toString() };
  });

// ── Paddle Webhook Handler ───────────────────────────────────────────────────

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

export async function handlePaddleWebhook(request: Request, env: any): Promise<Response> {
  if (!env.PADDLE_WEBHOOK_SECRET) {
    console.error("[paddle-webhook] PADDLE_WEBHOOK_SECRET not configured");
    return new Response("Paddle webhook secret not configured", { status: 500 });
  }

  const bodyText = await request.text();
  const signatureHeader = request.headers.get("Paddle-Signature") ?? "";

  const parts = Object.fromEntries(
    signatureHeader.split(";").map((p) => p.split("=") as [string, string]),
  );
  const ts = parts["ts"];
  const h1 = parts["h1"];

  if (!ts || !h1) {
    return new Response("Missing or malformed Paddle-Signature header", { status: 400 });
  }

  const enc = new TextEncoder();
  const keyBytes = enc.encode(env.PADDLE_WEBHOOK_SECRET);
  const msgBytes = enc.encode(`${ts}:${bodyText}`);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBytes = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, msgBytes));
  const computed = Array.from(sigBytes).map((b) => b.toString(16).padStart(2, "0")).join("");

  if (!timingSafeEqual(computed, h1)) {
    console.error("[paddle-webhook] Signature mismatch");
    return new Response("Paddle webhook signature mismatch", { status: 401 });
  }

  const tsMs = Number(ts) * 1000;
  if (Math.abs(Date.now() - tsMs) > 5 * 60 * 1000) {
    return new Response("Paddle webhook timestamp too old", { status: 400 });
  }

  let event: PaddleEvent;
  try {
    event = JSON.parse(bodyText) as PaddleEvent;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const db = drizzle(env.DB, { schema: { organizations, orgQuotas, users, billingEvents } });

  const eventId = event.event_id;
  if (eventId) {
    const existing = await db
      .select({ id: billingEvents.id })
      .from(billingEvents)
      .where(eq(billingEvents.id, eventId))
      .limit(1)
      .all();
    if (existing.length > 0) {
      console.log(`[paddle-webhook] event already processed: ${eventId}`);
      return new Response("OK", { status: 200 });
    }
  }

  console.log(`[paddle-webhook] received event: ${event.event_type} id: ${eventId}`);

  try {
    switch (event.event_type) {
      case "transaction.completed": {
        const txn = event.data as PaddleTransaction;
        const customData = txn.custom_data ?? {};
        const userId = customData.userId;
        const orgName = customData.orgName ?? "My Organization";
        const existingOrgId = customData.orgId;
        const plan = (customData.plan as "business" | "enterprise") ?? "business";

        if (!userId) {
          console.error("[paddle-webhook] transaction.completed missing userId");
          return new Response("Missing userId", { status: 400 });
        }

        if (!(await userExists(db, userId))) {
          console.error(`[paddle-webhook] userId does not exist: ${userId}`);
          return new Response("Invalid userId", { status: 400 });
        }

        const orgId = existingOrgId ?? crypto.randomUUID();
        const billingCustomerId = txn.customer_id;
        const billingSubscriptionId = txn.subscription_id;

        await provisionManagedOrg(env, {
          orgId,
          orgName,
          ownerUserId: userId,
          plan,
          billingCustomerId,
          billingSubscriptionId,
        });

        await upsertUserPlan(db, userId, plan, billingCustomerId);
        break;
      }

      case "subscription.activated":
      case "subscription.updated": {
        const sub = event.data as PaddleSubscription;
        const customData = sub.custom_data ?? {};
        const userId = customData.userId;
        const orgId = customData.orgId;
        const status = sub.status;
        const plan = (status === "active" || status === "trialing") ? "business" : "free";

        if (!userId) break;
        if (!(await userExists(db, userId))) break;

        await upsertUserPlan(db, userId, plan, sub.customer_id);

        if (orgId && (await orgExists(db, orgId))) {
          await db
            .update(organizations)
            .set({ plan, billingSubscriptionId: sub.id, planActivatedAt: plan === "business" ? Date.now() : null })
            .where(eq(organizations.id, orgId));

          await db.update(orgQuotas).set({
            plan,
            monthlyMemories: plan === "business" ? 10000 : 100,
            monthlyRecalls: plan === "business" ? 50000 : 1000,
            monthlyCommits: plan === "business" ? 10000 : 500,
          }).where(eq(orgQuotas.orgId, orgId));
        }
        break;
      }

      case "subscription.canceled": {
        const sub = event.data as PaddleSubscription;
        const customData = sub.custom_data ?? {};
        const userId = customData.userId;
        const orgId = customData.orgId;

        if (!userId) break;
        if (!(await userExists(db, userId))) break;

        await db.update(userPlans).set({
          plan: "free",
          billingSubscriptionId: null,
          planExpiresAt: Date.now(),
          updatedAt: new Date(),
        }).where(eq(userPlans.userId, userId));

        if (orgId && (await orgExists(db, orgId))) {
          await db.update(organizations).set({
            plan: "free",
            billingSubscriptionId: null,
            planExpiresAt: Date.now(),
          }).where(eq(organizations.id, orgId));

          await db.update(orgQuotas).set({
            plan: "free",
            monthlyMemories: 100,
            monthlyRecalls: 1000,
            monthlyCommits: 500,
          }).where(eq(orgQuotas.orgId, orgId));
        }
        break;
      }
    }
  } catch (err: any) {
    console.error(`[paddle-webhook] processing error: ${err.message}`);
    return new Response(`Webhook error: ${err.message}`, { status: 500 });
  }

  if (eventId) {
    await db
      .insert(billingEvents)
      .values({ id: eventId, type: event.event_type, processedAt: Date.now() })
      .catch((e) => console.error(`[paddle-webhook] failed to record: ${e.message}`));
  }

  return new Response("OK", { status: 200 });
}

// ── Org Provisioning ──────────────────────────────────────────────────────────

export type TenantData = {
  orgId: string;
  orgName: string;
  ownerUserId: string;
  plan?: "business" | "enterprise";
  billingCustomerId?: string;
  billingSubscriptionId?: string;
};

export async function provisionManagedOrg(
  env: any,
  tenant: TenantData,
): Promise<{ orgId: string; vaultId: string }> {
  const db = drizzle(env.DB, {
    schema: { organizations, organizationMembers, orgQuotas, vaults },
  });

  const plan = tenant.plan ?? "business";
  const now = Date.now();
  const vaultId = `org:${tenant.orgId}`;

  const existingOrg = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, tenant.orgId))
    .limit(1)
    .all();

  if (existingOrg.length === 0) {
    await db.insert(organizations).values({
      id: tenant.orgId,
      name: tenant.orgName,
      plan,
      billingCustomerId: tenant.billingCustomerId ?? null,
      billingSubscriptionId: tenant.billingSubscriptionId ?? null,
      planActivatedAt: now,
      createdAt: now,
    });
  } else {
    await db
      .update(organizations)
      .set({
        plan,
        billingCustomerId: tenant.billingCustomerId ?? undefined,
        billingSubscriptionId: tenant.billingSubscriptionId ?? undefined,
        planActivatedAt: now,
      })
      .where(eq(organizations.id, tenant.orgId));
  }

  const existingMember = await db
    .select({ userId: organizationMembers.userId })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.orgId, tenant.orgId),
        eq(organizationMembers.userId, tenant.ownerUserId),
      ),
    )
    .limit(1)
    .all();

  if (existingMember.length === 0) {
    await db.insert(organizationMembers).values({
      orgId: tenant.orgId,
      userId: tenant.ownerUserId,
      role: "owner",
      joinedAt: now,
    });
  }

  const quotaValues =
    plan === "enterprise"
      ? { monthlyMemories: 500000, monthlyRecalls: 1000000, monthlyCommits: 200000 }
      : { monthlyMemories: 10000, monthlyRecalls: 50000, monthlyCommits: 10000 };

  const existingQuota = await db
    .select({ orgId: orgQuotas.orgId })
    .from(orgQuotas)
    .where(eq(orgQuotas.orgId, tenant.orgId))
    .limit(1)
    .all();

  if (existingQuota.length === 0) {
    await db.insert(orgQuotas).values({ orgId: tenant.orgId, plan, ...quotaValues });
  } else {
    await db.update(orgQuotas).set({ plan, ...quotaValues }).where(eq(orgQuotas.orgId, tenant.orgId));
  }

  await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);

  const masterKekRef = `kek:${vaultId}`;
  const existingVault = await db
    .select({ id: vaults.id })
    .from(vaults)
    .where(eq(vaults.orgId, tenant.orgId))
    .limit(1)
    .all();

  if (existingVault.length === 0) {
    const { randomUUID } = await import("node:crypto");
    await db.insert(vaults).values({
      id: randomUUID(),
      orgId: tenant.orgId,
      vaultId,
      masterKekRef,
      provisionedAt: now,
      status: "active",
    });
  }

  console.log(`[provision] Org ${tenant.orgId} (${plan}) provisioned. vault=${vaultId}`);
  return { orgId: tenant.orgId, vaultId };
}

// ── Subscription Seat Sync (no-op for Paddle) ─────────────────────────────────
// Paddle handles seat count changes automatically; this is kept for backwards compat
export async function updateSubscriptionSeats(db: any, env: CloudflareEnv, orgId: string): Promise<void> {
  console.log(`[paddle-sync] Paddle handles subscription seat syncing automatically`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function upsertUserPlan(
  db: ReturnType<typeof drizzle>,
  userId: string,
  plan: "free" | "business" | "enterprise",
  billingCustomerId?: string,
): Promise<void> {
  const existing = await db
    .select({ userId: userPlans.userId })
    .from(userPlans)
    .where(eq(userPlans.userId, userId))
    .limit(1)
    .all();

  if (existing.length > 0) {
    await db.update(userPlans).set({
      plan,
      billingCustomerId: billingCustomerId ?? undefined,
      planActivatedAt: Date.now(),
      updatedAt: new Date(),
    }).where(eq(userPlans.userId, userId));
  } else {
    await db.insert(userPlans).values({
      userId,
      plan,
      billingCustomerId: billingCustomerId ?? null,
      planActivatedAt: Date.now(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
}

type PaddleEvent = {
  event_id?: string;
  event_type: string;
  data: unknown;
};

type PaddleTransaction = {
  id: string;
  customer_id?: string;
  subscription_id?: string;
  custom_data?: Record<string, string>;
};

type PaddleSubscription = {
  id: string;
  customer_id?: string;
  status: string;
  custom_data?: Record<string, string>;
};
