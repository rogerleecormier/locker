-- Grant business_comp plan to admin accounts
-- This migration ensures admin users have the proper complimentary plan tier

-- First, delete any feature_overrides for the admin user that would conflict
DELETE FROM feature_overrides
WHERE userId = (
  SELECT id FROM user WHERE email = 'rogerleecormier@gmail.com'
);

-- Update existing user_plans record if it exists
UPDATE user_plans
SET plan = 'business_comp',
    planActivatedAt = CAST((julianday('now') - 2440587.5) * 86400000.0 AS INTEGER),
    updatedAt = CAST((julianday('now') - 2440587.5) * 86400000.0 AS INTEGER)
WHERE userId = (
  SELECT id FROM user WHERE email = 'rogerleecormier@gmail.com'
);

-- Insert new record if it doesn't exist
INSERT INTO user_plans (userId, plan, planActivatedAt, createdAt, updatedAt)
SELECT id, 'business_comp',
       CAST((julianday('now') - 2440587.5) * 86400000.0 AS INTEGER),
       CAST((julianday('now') - 2440587.5) * 86400000.0 AS INTEGER),
       CAST((julianday('now') - 2440587.5) * 86400000.0 AS INTEGER)
FROM user
WHERE email = 'rogerleecormier@gmail.com'
  AND id NOT IN (SELECT userId FROM user_plans);
