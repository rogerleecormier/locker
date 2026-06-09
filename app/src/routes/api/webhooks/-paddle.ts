/**
 * POST /api/webhooks/paddle
 *
 * Paddle billing webhook endpoint for the Locker Cloud managed tier.
 * Validates the Paddle-Signature header, dispatches to the appropriate
 * billing handler, and triggers org provisioning on first successful checkout.
 *
 * Relevant Paddle event types handled:
 *   - transaction.completed   → completed checkout, provision org if new
 *   - subscription.activated  → recurring sub activated, upgrade plan
 *   - subscription.updated    → plan/quantity changes mid-cycle
 *   - subscription.canceled   → downgrade to free
 *
 * Idempotency: each event.event_id is recorded in `stripe_events` (reused table)
 * to prevent double-processing on replay.
 *
 * Env vars required:
 *   PADDLE_WEBHOOK_SECRET  — the Paddle notification secret key (from dashboard)
 */

import type { CloudflareEnv } from "~/types/cloudflare";
import { handlePaddleWebhook } from "~/server/billing";

export default {
  POST: async (request: Request, { env }: { env: CloudflareEnv }) => {
    return handlePaddleWebhook(request, env);
  },
};
