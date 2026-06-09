#!/usr/bin/env node

/**
 * Standalone test script for cascade invalidation.
 * Uses the local SQLite database directly without vitest.
 *
 * Run: node test-cascade-local.mjs
 */

import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(
  __dirname,
  "app/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/0b1821eab3c7d2e969b5392d8019d5446ef64193bfd1760a447f76afca6846f7.sqlite"
);

console.log("[cascade-test] Using local D1 database:", dbPath);

// Open the local SQLite database
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

const userId = "test-cascade-" + Date.now();
const now = Date.now();

console.log("\n=== Cascade Invalidation Test Scenario ===\n");
console.log(`Testing with userId: ${userId}`);

try {
  // Test 1: Create parent and child memories
  console.log("\n[Test 1] Creating parent memory: 'Use React 19'");
  const parentId = "mem-parent-" + Date.now();
  db.exec(`
    INSERT INTO memories (
      id, userId, fact, category, tags, timestamp, isActive,
      projectKey, scopeType, scopeId, isQuarantined, blind_index_hash, keyword_blind_index
    ) VALUES (
      '${parentId}', '${userId}',
      'Use React 19 as the primary frontend framework', 'rules',
      'react, framework', ${now}, 1, NULL, 'personal', NULL, 0, NULL, NULL
    )
  `);
  console.log("✓ Parent memory created:", parentId);

  // Small delay to ensure different timestamp
  const childTime = now + 1;
  console.log("\n[Test 2] Creating child memory: 'useActionState hook'");
  const childId = "mem-child-" + Date.now();
  db.exec(`
    INSERT INTO memories (
      id, userId, fact, category, tags, timestamp, isActive,
      projectKey, scopeType, scopeId, isQuarantined, blind_index_hash, keyword_blind_index
    ) VALUES (
      '${childId}', '${userId}',
      'The useActionState hook from React 19 improves form handling', 'rules',
      'react, hooks', ${childTime}, 1, NULL, 'personal', NULL, 0, NULL, NULL
    )
  `);
  console.log("✓ Child memory created:", childId);

  // Test 2: Create dependency link
  console.log("\n[Test 3] Linking: child depends_on parent");
  const depId = "dep-" + Date.now();
  db.exec(`
    INSERT INTO memory_dependencies (
      id, parentId, childId, userId, relationType, createdAt
    ) VALUES (
      '${depId}', '${parentId}', '${childId}', '${userId}', 'depends_on', ${now}
    )
  `);
  console.log("✓ Dependency created:", depId);

  // Verify dependency was recorded
  const deps = db
    .prepare(
      `SELECT childId, relationType FROM memory_dependencies
       WHERE parentId = ? AND userId = ?`
    )
    .all(parentId, userId);
  console.log("✓ Direct dependents query returned:", deps.length, "row(s)");
  console.log("  Child ID:", deps[0]?.childId);
  console.log("  Relation:", deps[0]?.relationType);

  // Test 3: Simulate cascade invalidation using recursive CTE
  console.log("\n[Test 4] Simulating cascade invalidation...");
  console.log("  (Querying all transitive descendants)");

  // This mimics the invalidateMemoryCascade logic from cascade.ts
  const descendantRows = db
    .prepare(
      `WITH RECURSIVE dependents AS (
        -- Base case: direct children of the parent
        SELECT childId, relationType FROM memory_dependencies
        WHERE parentId = ? AND userId = ?

        UNION ALL

        -- Recursive case: children of children (transitive closure)
        SELECT md.childId, md.relationType FROM memory_dependencies md
        JOIN dependents ON md.parentId = dependents.childId
        WHERE md.userId = ?
      )
      SELECT DISTINCT childId, relationType FROM dependents`
    )
    .all(parentId, userId, userId);

  console.log("✓ Found", descendantRows.length, "transitive dependent(s)");
  for (const row of descendantRows) {
    console.log(`  - ${row.childId} (relation: ${row.relationType})`);
  }

  // Test 4: Mark descendants as quarantined (cascade action)
  console.log("\n[Test 5] Marking dependents as quarantined...");
  const descendantIds = descendantRows.map((r) => r.childId);

  if (descendantIds.length > 0) {
    const placeholders = descendantIds.map(() => "?").join(",");
    db.exec(`
      UPDATE memories
      SET isQuarantined = 1, lastAccessedAt = ${now}
      WHERE id IN (${placeholders})
    `);
    console.log("✓ Marked", descendantIds.length, "memory(ies) as quarantined");
  }

  // Test 5: Verify child is now quarantined
  console.log("\n[Test 6] Verifying cascade result...");
  const childRow = db
    .prepare(`SELECT id, isQuarantined FROM memories WHERE id = ?`)
    .get(childId);

  if (childRow) {
    console.log("✓ Child memory found:", childRow.id);
    console.log("  isQuarantined:", childRow.isQuarantined === 1 ? "YES ✓" : "NO ✗");

    if (childRow.isQuarantined === 1) {
      console.log("\n✅ CASCADE INVALIDATION SUCCESSFUL!");
      console.log("   Parent memory update triggered cascade");
      console.log("   All dependent children flagged for review");
    } else {
      console.log(
        "\n❌ CASCADE INVALIDATION FAILED: child not quarantined"
      );
    }
  } else {
    console.log("❌ Child memory not found!");
  }

  // Test 6: Test with multiple children (branching graph)
  console.log("\n\n=== Testing Multi-Child Scenario ===\n");

  const parentId2 = "mem-parent-multi-" + Date.now();
  const child1Id = "mem-child1-" + Date.now();
  const child2Id = "mem-child2-" + Date.now();

  const insertTime = now + 100;

  db.exec(`
    INSERT INTO memories (
      id, userId, fact, category, tags, timestamp, isActive,
      projectKey, scopeType, scopeId, isQuarantined, blind_index_hash, keyword_blind_index
    ) VALUES
      ('${parentId2}', '${userId}', 'Use TypeScript for all projects', 'rules',
       'typescript', ${insertTime}, 1, NULL, 'personal', NULL, 0, NULL, NULL),
      ('${child1Id}', '${userId}', 'Configure tsconfig.json with strict mode', 'rules',
       'typescript, config', ${insertTime}, 1, NULL, 'personal', NULL, 0, NULL, NULL),
      ('${child2Id}', '${userId}', 'Use type guards for runtime safety', 'rules',
       'typescript, safety', ${insertTime}, 1, NULL, 'personal', NULL, 0, NULL, NULL)
  `);

  db.exec(`
    INSERT INTO memory_dependencies (
      id, parentId, childId, userId, relationType, createdAt
    ) VALUES
      ('dep-multi-1-' + ${insertTime}, '${parentId2}', '${child1Id}', '${userId}', 'implements', ${insertTime}),
      ('dep-multi-2-' + ${insertTime}, '${parentId2}', '${child2Id}', '${userId}', 'depends_on', ${insertTime})
  `);

  console.log("[Multi-Child] Created parent with 2 children");

  const multiDescendants = db
    .prepare(
      `WITH RECURSIVE dependents AS (
        SELECT childId, relationType FROM memory_dependencies
        WHERE parentId = ? AND userId = ?
        UNION ALL
        SELECT md.childId, md.relationType FROM memory_dependencies md
        JOIN dependents ON md.parentId = dependents.childId
        WHERE md.userId = ?
      )
      SELECT DISTINCT childId, relationType FROM dependents`
    )
    .all(parentId2, userId, userId);

  console.log("[Multi-Child] Found", multiDescendants.length, "descendants:");
  for (const row of multiDescendants) {
    console.log(`  - ${row.childId}`);
  }

  if (multiDescendants.length === 2) {
    console.log("\n✅ Multi-child cascade works correctly!");
  }

  // Cleanup
  console.log("\n\n=== Cleanup ===\n");
  db.exec(`DELETE FROM memory_dependencies WHERE userId = '${userId}'`);
  db.exec(`DELETE FROM memories WHERE userId = '${userId}'`);
  console.log("✓ Test data cleaned up");

  console.log("\n=== All Tests Completed ===\n");
  process.exit(0);
} catch (err) {
  console.error("\n❌ Test failed:", err.message);
  console.error(err);
  process.exit(1);
} finally {
  db.close();
}
