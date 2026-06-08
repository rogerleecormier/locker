-- Migration 0025: Sunset "stack" category, introduce "configs" category.
--
-- SQLite does not support ALTER COLUMN or DROP CONSTRAINT, so we migrate
-- existing rows in-place and rely on the application-layer enum checks
-- enforced by Drizzle and TypeScript going forward.
--
-- Step 1: Rename any existing "stack" memories to "configs" so no rows are orphaned.
UPDATE memories SET category = 'configs' WHERE category = 'stack';

-- Step 2: Same for memory_versions history rows.
UPDATE memory_versions SET category = 'configs' WHERE category = 'stack';

-- Step 3: Same for memory_recommendations.
UPDATE memory_recommendations SET category = 'configs' WHERE category = 'stack';

-- Step 4: memory_templates used a different category set; migrate old values.
--   "stack"         -> "configs"
--   "governance"    -> "configs"   (closest equivalent under new taxonomy)
--   "documentation" -> "configs"   (closest equivalent under new taxonomy)
UPDATE memory_templates SET category = 'configs'
  WHERE category IN ('stack', 'governance', 'documentation');

-- "devops" and "compliance" are preserved 1:1 in the new enum.
-- No action needed for those rows.
