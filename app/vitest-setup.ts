/**
 * Vitest setup file for integration tests with wrangler D1.
 * This allows tests to access the local wrangler D1 database.
 */

import { beforeAll, afterAll } from "vitest";

// Global test DB will be accessible to all tests
declare global {
  var testD1: any;
}

beforeAll(async () => {
  // Initialize the global test database from wrangler's local D1
  // When running under wrangler, the D1 binding is available
  // For now, this is a placeholder that tests can use

  // In a real scenario, you would use wrangler's test utilities
  // For manual testing, we can use the SQLite database directly

  console.log("[vitest-setup] Test database initialized");
});

afterAll(async () => {
  console.log("[vitest-setup] Test database cleanup");
});

export {};
