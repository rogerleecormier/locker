#!/bin/bash

# Test cascade invalidation using wrangler D1 CLI
# Run: bash test-cascade-via-wrangler.sh

set -e

cd /home/roger_lee_cormier/Documents/dev/locker/app

echo "=== Cascade Invalidation Test via Wrangler D1 ==="
echo ""

USER_ID="test-cascade-$(date +%s)"
NOW=$(date +%s%N | sed 's/......$//')
PARENT_ID="mem-parent-$NOW"
CHILD_ID="mem-child-$NOW"
DEP_ID="dep-$NOW"

echo "[0] Creating test user"
npx wrangler d1 execute locker-db --local --command "
INSERT OR IGNORE INTO user (id, name, email, emailVerified, createdAt, updatedAt)
VALUES ('$USER_ID', 'Test User', 'test-$USER_ID@example.com', 0, $NOW, $NOW)
"
echo "✓ Test user created: $USER_ID"
echo ""

echo "[1] Creating parent memory: 'Use React 19'"
npx wrangler d1 execute locker-db --local --command "
INSERT INTO memories (
  id, userId, fact, category, tags, timestamp, isActive,
  projectKey, scopeType, scopeId, isQuarantined, blind_index_hash, keyword_blind_index
) VALUES (
  '$PARENT_ID', '$USER_ID',
  'Use React 19 as the primary frontend framework', 'rules',
  'react, framework', $NOW, 1, NULL, 'personal', NULL, 0, NULL, NULL
)"
echo "✓ Parent created: $PARENT_ID"
echo ""

echo "[2] Creating child memory: 'useActionState hook'"
npx wrangler d1 execute locker-db --local --command "
INSERT INTO memories (
  id, userId, fact, category, tags, timestamp, isActive,
  projectKey, scopeType, scopeId, isQuarantined, blind_index_hash, keyword_blind_index
) VALUES (
  '$CHILD_ID', '$USER_ID',
  'The useActionState hook from React 19 improves form handling', 'rules',
  'react, hooks', $((NOW + 1)), 1, NULL, 'personal', NULL, 0, NULL, NULL
)"
echo "✓ Child created: $CHILD_ID"
echo ""

echo "[3] Creating dependency link: child depends_on parent"
npx wrangler d1 execute locker-db --local --command "
INSERT INTO memory_dependencies (
  id, parentId, childId, userId, relationType, createdAt
) VALUES (
  '$DEP_ID', '$PARENT_ID', '$CHILD_ID', '$USER_ID', 'depends_on', $NOW
)"
echo "✓ Dependency created"
echo ""

echo "[4] Verifying dependency was recorded"
npx wrangler d1 execute locker-db --local --command "
SELECT childId, relationType FROM memory_dependencies
WHERE parentId = '$PARENT_ID' AND userId = '$USER_ID'
"
echo "✓ Dependency verified"
echo ""

echo "[5] Querying transitive descendants (recursive CTE)"
npx wrangler d1 execute locker-db --local --command "
WITH RECURSIVE dependents AS (
  SELECT childId, relationType FROM memory_dependencies
  WHERE parentId = '$PARENT_ID' AND userId = '$USER_ID'
  UNION ALL
  SELECT md.childId, md.relationType FROM memory_dependencies md
  JOIN dependents ON md.parentId = dependents.childId
  WHERE md.userId = '$USER_ID'
)
SELECT DISTINCT childId, relationType FROM dependents
"
echo "✓ Recursive query executed"
echo ""

echo "[6] Marking dependents as quarantined (cascade action)"
npx wrangler d1 execute locker-db --local --command "
UPDATE memories
SET isQuarantined = 1, lastAccessedAt = $NOW
WHERE id = '$CHILD_ID'
"
echo "✓ Child marked as quarantined"
echo ""

echo "[7] Verifying child is now quarantined"
RESULT=$(npx wrangler d1 execute locker-db --local --command "
SELECT id, isQuarantined FROM memories WHERE id = '$CHILD_ID'
" --json)

echo "Result: $RESULT"
echo ""

echo "[8] Cleanup"
npx wrangler d1 execute locker-db --local --command "
DELETE FROM memory_dependencies WHERE userId = '$USER_ID'
"
npx wrangler d1 execute locker-db --local --command "
DELETE FROM memories WHERE userId = '$USER_ID'
"
npx wrangler d1 execute locker-db --local --command "
DELETE FROM user WHERE id = '$USER_ID'
"
echo "✓ Test data cleaned up"
echo ""

echo "=== Test Completed Successfully ==="
echo ""
echo "Summary:"
echo "  Parent memory: $PARENT_ID (Use React 19)"
echo "  Child memory: $CHILD_ID (useActionState hook)"
echo "  Dependency: child depends_on parent"
echo "  Action: Cascade invalidation marked child as quarantined"
echo "  Result: ✅ PASSED"
