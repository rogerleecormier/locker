/**
 * Tests for src/server/billing.ts
 *
 * The two `createServerFn` exports (createCheckoutSession, createPortalSession)
 * require a live Cloudflare execution context and Stripe credentials, so they
 * are integration-layer concerns. This file covers the independently testable
 * pure logic inside handleStripeWebhook.
 *
 * Coverage:
 *   1. handleStripeWebhook — missing env vars return 500
 *   2. handleStripeWebhook — invalid signature returns 400
 *   3. handleStripeWebhook — idempotency: already-processed event returns 200
 *   4. checkout.session.completed — missing userId → 400
 *   5. checkout.session.completed — unknown userId → 400
 *   6. checkout.session.completed — unknown orgId → 400
 *   7. checkout.session.completed — upgrades user plan (insert path)
 *   8. checkout.session.completed — upgrades user plan (update path)
 *   9. checkout.session.completed — upgrades org + orgQuotas (insert path)
 *  10. checkout.session.completed — upgrades org + orgQuotas (update path)
 *  11. customer.subscription.updated — active status sets business
 *  12. customer.subscription.updated — past_due status sets free
 *  13. customer.subscription.updated — mismatched subscriptionId is ignored
 *  14. customer.subscription.deleted — downgrades user to free
 *  15. customer.subscription.deleted — ignored when subscriptionId does not match
 *  16. unknown event type returns 200 (silently ignored)
 *
 * Stripe is mocked at the module level — no network calls are made.
 *
 * Run: npx vitest run src/server/billing.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleStripeWebhook } from "./billing";

// ─── Stripe mock ──────────────────────────────────────────────────────────────

const mockConstructEventAsync = vi.fn();

vi.mock("stripe", () => {
  const MockStripe = function (this: any) {
    this.webhooks = { constructEventAsync: mockConstructEventAsync };
  };
  return { default: MockStripe };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEnv(overrides: Record<string, string | undefined> = {}): any {
  return {
    STRIPE_SECRET_KEY: "sk_test_fake",
    STRIPE_WEBHOOK_SECRET: "whsec_fake",
    DB: {} as any,
    ...overrides,
  };
}

function makeRequest(body = "{}", signature = "valid-sig"): Request {
  return new Request("https://example.com/webhook", {
    method: "POST",
    headers: { "stripe-signature": signature },
    body,
  });
}

type Row = Record<string, unknown>;

// Sequential DB: each .all() / .run() call consumes the next response in the list.
function makeDb(responses: (Row[] | undefined)[] = []) {
  let call = 0;
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    all: vi.fn().mockImplementation(() => responses[call++] ?? []),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    run: vi.fn().mockResolvedValue(undefined),
    catch: vi.fn().mockReturnThis(),
  };
  return chain;
}

// Build a minimal Stripe Event object
function makeEvent(type: string, data: Record<string, unknown>, id = "evt_test_1"): any {
  return { id, type, data: { object: data } };
}

// ─── DB used by drizzle(env.DB) inside handleStripeWebhook ───────────────────
// handleStripeWebhook calls drizzle() internally, so we mock drizzle/d1.

vi.mock("drizzle-orm/d1", () => ({
  drizzle: vi.fn(),
}));

import { drizzle } from "drizzle-orm/d1";

const mockedDrizzle = vi.mocked(drizzle);

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: env guard
// ─────────────────────────────────────────────────────────────────────────────

describe("handleStripeWebhook — env guards", () => {
  it("returns 500 when STRIPE_SECRET_KEY is missing", async () => {
    const res = await handleStripeWebhook(makeRequest(), makeEnv({ STRIPE_SECRET_KEY: undefined }));
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("Stripe not configured");
  });

  it("returns 500 when STRIPE_WEBHOOK_SECRET is missing", async () => {
    mockConstructEventAsync.mockRejectedValue(new Error("no secret"));
    const db = makeDb([]);
    mockedDrizzle.mockReturnValue(db);
    const res = await handleStripeWebhook(
      makeRequest(),
      makeEnv({ STRIPE_WEBHOOK_SECRET: undefined })
    );
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("STRIPE_WEBHOOK_SECRET");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: signature verification
// ─────────────────────────────────────────────────────────────────────────────

describe("handleStripeWebhook — signature verification", () => {
  it("returns 400 when signature verification fails", async () => {
    mockConstructEventAsync.mockRejectedValue(new Error("signature mismatch"));
    const res = await handleStripeWebhook(makeRequest("{}", "bad-sig"), makeEnv());
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Webhook Error");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: idempotency
// ─────────────────────────────────────────────────────────────────────────────

describe("handleStripeWebhook — idempotency", () => {
  it("returns 200 immediately when the event id was already processed", async () => {
    const event = makeEvent("checkout.session.completed", {});
    mockConstructEventAsync.mockResolvedValue(event);
    const db = makeDb([
      [{ id: "evt_test_1" }], // stripeEvents lookup — already exists
    ]);
    mockedDrizzle.mockReturnValue(db);

    const res = await handleStripeWebhook(makeRequest(), makeEnv());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("OK");
    // insert for business upgrade should NOT have been called
    expect(db.insert).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4-10: checkout.session.completed
// ─────────────────────────────────────────────────────────────────────────────

describe("checkout.session.completed", () => {
  function makeCheckoutEvent(meta: Record<string, string>, overrides: Record<string, unknown> = {}) {
    return makeEvent("checkout.session.completed", {
      metadata: meta,
      customer: "cus_test",
      subscription: "sub_test",
      ...overrides,
    });
  }

  it("returns 400 when userId is missing from metadata", async () => {
    const event = makeCheckoutEvent({});
    mockConstructEventAsync.mockResolvedValue(event);
    const db = makeDb([
      [],  // stripeEvents (not processed)
    ]);
    mockedDrizzle.mockReturnValue(db);

    const res = await handleStripeWebhook(makeRequest(), makeEnv());
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Missing userId");
  });

  it("returns 400 when userId does not exist in the database", async () => {
    const event = makeCheckoutEvent({ userId: "ghost-user", orgId: "" });
    mockConstructEventAsync.mockResolvedValue(event);
    const db = makeDb([
      [],             // stripeEvents (not processed)
      [],             // users lookup → not found
    ]);
    mockedDrizzle.mockReturnValue(db);

    const res = await handleStripeWebhook(makeRequest(), makeEnv());
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Invalid userId");
  });

  it("returns 400 when orgId is provided but does not exist in the database", async () => {
    const event = makeCheckoutEvent({ userId: "user-1", orgId: "org-ghost" });
    mockConstructEventAsync.mockResolvedValue(event);
    const db = makeDb([
      [],                         // stripeEvents (not processed)
      [{ id: "user-1" }],         // users → found
      [],                         // organizations → not found
    ]);
    mockedDrizzle.mockReturnValue(db);

    const res = await handleStripeWebhook(makeRequest(), makeEnv());
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Invalid orgId");
  });

  it("inserts a new userPlan row when none exists", async () => {
    const event = makeCheckoutEvent({ userId: "user-1", orgId: "" });
    mockConstructEventAsync.mockResolvedValue(event);
    const db = makeDb([
      [],                   // stripeEvents
      [{ id: "user-1" }],   // users
      [],                   // userPlans → no existing row → insert path
    ]);
    mockedDrizzle.mockReturnValue(db);

    const res = await handleStripeWebhook(makeRequest(), makeEnv());
    expect(res.status).toBe(200);
    expect(db.insert).toHaveBeenCalled();
  });

  it("updates the existing userPlan row when one exists", async () => {
    const event = makeCheckoutEvent({ userId: "user-1", orgId: "" });
    mockConstructEventAsync.mockResolvedValue(event);
    const db = makeDb([
      [],                          // stripeEvents
      [{ id: "user-1" }],          // users
      [{ userId: "user-1", plan: "free" }], // userPlans → existing → update path
    ]);
    mockedDrizzle.mockReturnValue(db);

    const res = await handleStripeWebhook(makeRequest(), makeEnv());
    expect(res.status).toBe(200);
    expect(db.update).toHaveBeenCalled();
    const setArgs = db.set.mock.calls[0][0];
    expect(setArgs.plan).toBe("business");
  });

  it("inserts orgQuotas row when org upgrade has no existing quota", async () => {
    const event = makeCheckoutEvent({ userId: "user-1", orgId: "org-1" });
    mockConstructEventAsync.mockResolvedValue(event);
    const db = makeDb([
      [],                               // stripeEvents
      [{ id: "user-1" }],               // users
      [{ id: "org-1" }],                // organizations
      [{ userId: "user-1", plan: "free" }], // userPlans (update path)
      [],                               // orgQuotas → not found → insert
    ]);
    mockedDrizzle.mockReturnValue(db);

    const res = await handleStripeWebhook(makeRequest(), makeEnv());
    expect(res.status).toBe(200);
    // Should have called insert for both userPlans update and orgQuotas insert
    expect(db.insert).toHaveBeenCalled();
  });

  it("updates orgQuotas row when one already exists", async () => {
    const event = makeCheckoutEvent({ userId: "user-1", orgId: "org-1" });
    mockConstructEventAsync.mockResolvedValue(event);
    const db = makeDb([
      [],
      [{ id: "user-1" }],
      [{ id: "org-1" }],
      [{ userId: "user-1", plan: "free" }], // userPlans
      [{ orgId: "org-1", plan: "free" }],   // orgQuotas → exists → update
    ]);
    mockedDrizzle.mockReturnValue(db);

    const res = await handleStripeWebhook(makeRequest(), makeEnv());
    expect(res.status).toBe(200);
    expect(db.update).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 11-13: customer.subscription.updated
// ─────────────────────────────────────────────────────────────────────────────

describe("customer.subscription.updated", () => {
  function makeSubEvent(meta: Record<string, string>, status: string, subId = "sub_active") {
    return makeEvent("customer.subscription.updated", {
      id: subId,
      customer: "cus_test",
      status,
      metadata: meta,
    });
  }

  it("sets plan to business when subscription status is active", async () => {
    const event = makeSubEvent({ userId: "user-1", orgId: "" }, "active");
    mockConstructEventAsync.mockResolvedValue(event);
    const db = makeDb([
      [],                          // stripeEvents
      [{ id: "user-1" }],          // users
      // orgId is empty string — no org exists check
      [{ billingSubscriptionId: "sub_active" }], // userPlans — matches
    ]);
    mockedDrizzle.mockReturnValue(db);

    await handleStripeWebhook(makeRequest(), makeEnv());
    const setArgs = db.set.mock.calls[0][0];
    expect(setArgs.plan).toBe("business");
  });

  it("sets plan to free when subscription status is past_due", async () => {
    const event = makeSubEvent({ userId: "user-1", orgId: "" }, "past_due");
    mockConstructEventAsync.mockResolvedValue(event);
    const db = makeDb([
      [],
      [{ id: "user-1" }],
      [{ billingSubscriptionId: "sub_active" }],
    ]);
    mockedDrizzle.mockReturnValue(db);

    await handleStripeWebhook(makeRequest(), makeEnv());
    const setArgs = db.set.mock.calls[0][0];
    expect(setArgs.plan).toBe("free");
  });

  it("ignores the event when the subscriptionId does not match the stored one", async () => {
    const event = makeSubEvent({ userId: "user-1", orgId: "" }, "active", "sub_different");
    mockConstructEventAsync.mockResolvedValue(event);
    const db = makeDb([
      [],
      [{ id: "user-1" }],
      [{ billingSubscriptionId: "sub_active" }], // stored sub is different
    ]);
    mockedDrizzle.mockReturnValue(db);

    await handleStripeWebhook(makeRequest(), makeEnv());
    // update should NOT have been called
    expect(db.update).not.toHaveBeenCalled();
  });

  it("sets plan to business when subscription status is trialing", async () => {
    const event = makeSubEvent({ userId: "user-1", orgId: "" }, "trialing", "sub_trial");
    mockConstructEventAsync.mockResolvedValue(event);
    const db = makeDb([
      [],
      [{ id: "user-1" }],
      [{ billingSubscriptionId: "sub_trial" }],
    ]);
    mockedDrizzle.mockReturnValue(db);

    await handleStripeWebhook(makeRequest(), makeEnv());
    const setArgs = db.set.mock.calls[0][0];
    expect(setArgs.plan).toBe("business");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 14-15: customer.subscription.deleted
// ─────────────────────────────────────────────────────────────────────────────

describe("customer.subscription.deleted", () => {
  function makeDeleteEvent(meta: Record<string, string>, subId = "sub_active") {
    return makeEvent("customer.subscription.deleted", {
      id: subId,
      metadata: meta,
    });
  }

  it("downgrades user to free when the subscriptionId matches", async () => {
    const event = makeDeleteEvent({ userId: "user-1", orgId: "" });
    mockConstructEventAsync.mockResolvedValue(event);
    const db = makeDb([
      [],
      [{ id: "user-1" }],
      [{ billingSubscriptionId: "sub_active" }],
    ]);
    mockedDrizzle.mockReturnValue(db);

    await handleStripeWebhook(makeRequest(), makeEnv());
    const setArgs = db.set.mock.calls[0][0];
    expect(setArgs.plan).toBe("free");
    expect(setArgs.billingSubscriptionId).toBeNull();
  });

  it("ignores deletion when subscriptionId does not match the stored one", async () => {
    const event = makeDeleteEvent({ userId: "user-1", orgId: "" }, "sub_other");
    mockConstructEventAsync.mockResolvedValue(event);
    const db = makeDb([
      [],
      [{ id: "user-1" }],
      [{ billingSubscriptionId: "sub_active" }], // different
    ]);
    mockedDrizzle.mockReturnValue(db);

    await handleStripeWebhook(makeRequest(), makeEnv());
    expect(db.update).not.toHaveBeenCalled();
  });

  it("downgrades org and orgQuotas to free when orgId is in metadata", async () => {
    const event = makeDeleteEvent({ userId: "user-1", orgId: "org-1" });
    mockConstructEventAsync.mockResolvedValue(event);
    const db = makeDb([
      [],
      [{ id: "user-1" }],
      [{ id: "org-1" }],                          // orgExists
      [{ billingSubscriptionId: "sub_active" }],  // userPlans
    ]);
    mockedDrizzle.mockReturnValue(db);

    await handleStripeWebhook(makeRequest(), makeEnv());
    // update called at least twice: userPlans + organizations + orgQuotas
    expect(db.update.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 16: unknown event type
// ─────────────────────────────────────────────────────────────────────────────

describe("handleStripeWebhook — unknown event type", () => {
  it("returns 200 for an unhandled event type", async () => {
    const event = makeEvent("invoice.payment_succeeded", { id: "inv_1" });
    mockConstructEventAsync.mockResolvedValue(event);
    const db = makeDb([
      [],  // stripeEvents
    ]);
    mockedDrizzle.mockReturnValue(db);

    const res = await handleStripeWebhook(makeRequest(), makeEnv());
    expect(res.status).toBe(200);
  });
});
