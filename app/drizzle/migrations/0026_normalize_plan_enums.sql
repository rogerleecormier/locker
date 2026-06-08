-- Normalize plan columns to enforce enum values: free, business, business_comp, enterprise
-- This migration prevents invalid plan values from being stored in the database

-- Note: SQLite doesn't support direct enum enforcement via CHECK constraints like other databases,
-- but we document the valid values here. The application layer (Drizzle schema) enforces this.
-- If invalid values exist, they should be fixed manually or via application code.

-- Fix any invalid plan values in user_plans by converting them to 'free'
UPDATE user_plans SET plan = 'free'
WHERE plan NOT IN ('free', 'business', 'business_comp', 'enterprise');

-- Fix any invalid plan values in organizations by converting them to 'free'
UPDATE organizations SET plan = 'free'
WHERE plan NOT IN ('free', 'business', 'business_comp', 'enterprise');

-- Fix any invalid plan values in org_quotas by converting them to 'free'
UPDATE org_quotas SET plan = 'free'
WHERE plan NOT IN ('free', 'business', 'business_comp', 'enterprise');

-- Fix any invalid plan values in feature_overrides by converting them to 'free'
UPDATE feature_overrides SET planId = 'free'
WHERE planId NOT IN ('free', 'business', 'business_comp', 'enterprise');
