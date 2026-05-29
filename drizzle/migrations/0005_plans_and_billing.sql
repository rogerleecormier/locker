-- Migration: 0005_plans_and_billing.sql
-- Adds user-level plan overrides and updates orgQuotas for business plan tracking.
-- Run with: wrangler d1 migrations apply locker-db --remote

-- ── user_plans: per-user plan assignment (future: billing provider integration) ──
CREATE TABLE IF NOT EXISTS `user_plans` (
  `userId` text PRIMARY KEY NOT NULL,
  `plan` text NOT NULL DEFAULT 'free',
  `billingCustomerId` text,           -- Stripe customer ID (future)
  `billingSubscriptionId` text,       -- Stripe subscription ID (future)
  `planActivatedAt` integer,          -- when the current plan was activated
  `planExpiresAt` integer,            -- null = no expiry / lifetime
  `createdAt` integer NOT NULL,
  `updatedAt` integer NOT NULL,
  FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

-- ── plan_events: audit trail of plan changes ──────────────────────────────────
CREATE TABLE IF NOT EXISTS `plan_events` (
  `id` text PRIMARY KEY NOT NULL,
  `userId` text NOT NULL,
  `fromPlan` text NOT NULL DEFAULT 'free',
  `toPlan` text NOT NULL,
  `reason` text,                      -- 'upgrade', 'downgrade', 'trial', 'admin'
  `metadata` text,                    -- JSON (billing event data)
  `timestamp` integer NOT NULL,
  FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

-- ── waitlist: collect emails for business plan launch ──────────────────────────
CREATE TABLE IF NOT EXISTS `waitlist` (
  `id` text PRIMARY KEY NOT NULL,
  `email` text NOT NULL UNIQUE,
  `plan` text NOT NULL DEFAULT 'business',
  `notes` text,
  `createdAt` integer NOT NULL
);
--> statement-breakpoint

-- Update orgQuotas with business-appropriate defaults for existing orgs
-- This is safe to run multiple times (only updates rows with 'free' plan
-- that have the old default limits, indicating they were created before this migration).
UPDATE `org_quotas`
SET
  `plan` = 'business',
  `monthlyMemories` = 10000,
  `monthlyRecalls` = 50000,
  `monthlyCommits` = 10000
WHERE
  `plan` = 'free'
  AND `monthlyMemories` = 100;
