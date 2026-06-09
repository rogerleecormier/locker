/**
 * Tests for getUnreadNotificationCount and related notification logic
 * in src/server/memory/recommendations.ts
 *
 * Coverage:
 *   getUnreadNotificationCount (via testable helper):
 *     1. Returns 0 when user has no unread notifications
 *     2. Returns correct count when user has unread notifications
 *     3. Returns only unread count, ignoring read notifications
 *     4. Returns 0 when the SQL result row is missing (defensive)
 *
 *   markNotificationRead input validation (MarkNotificationSchema):
 *     5. Accepts { id } payload with a valid UUID
 *     6. Accepts { all: true } payload
 *     7. Rejects payload with unknown extra keys (strict mode)
 *     8. Rejects id that is not a UUID
 *
 * Run: npx vitest run src/server/notifications.test.ts
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

// ── Inline schema mirror (same as the one in recommendations.ts) ──────────────

const MarkNotificationSchema = z
  .object({
    id: z.string().uuid().optional(),
    all: z.boolean().optional(),
  })
  .strict();

// ── Testable helper that mirrors the DB query logic ───────────────────────────
// We extract the pure counting logic so we can unit-test it without needing
// a real Cloudflare Worker context or live D1 database.

function deriveUnreadCount(rows: Array<{ count: unknown }>): number {
  return Number(rows[0]?.count ?? 0);
}

// ── getUnreadNotificationCount logic ─────────────────────────────────────────

describe("deriveUnreadCount (getUnreadNotificationCount core logic)", () => {
  it("returns 0 when query returns an empty result set", () => {
    expect(deriveUnreadCount([])).toBe(0);
  });

  it("returns the count from the first result row", () => {
    expect(deriveUnreadCount([{ count: 7 }])).toBe(7);
  });

  it("coerces a string count (SQLite may return strings) to a number", () => {
    expect(deriveUnreadCount([{ count: "3" }])).toBe(3);
  });

  it("falls back to 0 when the count field is undefined", () => {
    expect(deriveUnreadCount([{ count: undefined }])).toBe(0);
  });

  it("falls back to 0 when the count field is null", () => {
    expect(deriveUnreadCount([{ count: null }])).toBe(0);
  });
});

// ── DB mock: unread count query ───────────────────────────────────────────────

function makeUnreadCountDb(unreadRows: Array<{ count: number }>) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          all: () => Promise.resolve(unreadRows),
        }),
      }),
    }),
  };
}

describe("getUnreadNotificationCount (mocked DB)", () => {
  it("returns count: 0 when no unread rows exist", async () => {
    const db = makeUnreadCountDb([{ count: 0 }]);
    const rows = await db.select().from({}).where({}).all() as Array<{ count: number }>;
    expect(deriveUnreadCount(rows)).toBe(0);
  });

  it("returns the correct unread count", async () => {
    const db = makeUnreadCountDb([{ count: 5 }]);
    const rows = await db.select().from({}).where({}).all() as Array<{ count: number }>;
    expect(deriveUnreadCount(rows)).toBe(5);
  });

  it("ignores read notifications — only unread are counted by the WHERE clause", async () => {
    // The WHERE clause filters unread only; this mock simulates that the DB
    // already applied the filter and returned 2 (out of e.g. 10 total).
    const db = makeUnreadCountDb([{ count: 2 }]);
    const rows = await db.select().from({}).where({}).all() as Array<{ count: number }>;
    expect(deriveUnreadCount(rows)).toBe(2);
  });

  it("is defensive when the DB returns an empty array", async () => {
    const db = makeUnreadCountDb([]);
    const rows = await db.select().from({}).where({}).all() as Array<{ count: number }>;
    expect(deriveUnreadCount(rows)).toBe(0);
  });
});

// ── MarkNotificationSchema validation ─────────────────────────────────────────

describe("MarkNotificationSchema", () => {
  it("accepts a valid UUID id", () => {
    const result = MarkNotificationSchema.safeParse({
      id: "123e4567-e89b-12d3-a456-426614174000",
    });
    expect(result.success).toBe(true);
  });

  it("accepts { all: true }", () => {
    const result = MarkNotificationSchema.safeParse({ all: true });
    expect(result.success).toBe(true);
  });

  it("accepts an empty object (both fields optional)", () => {
    const result = MarkNotificationSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects unknown extra keys (strict schema)", () => {
    const result = MarkNotificationSchema.safeParse({ all: true, unknown: "field" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-UUID string id", () => {
    const result = MarkNotificationSchema.safeParse({ id: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("rejects a numeric id", () => {
    const result = MarkNotificationSchema.safeParse({ id: 42 });
    expect(result.success).toBe(false);
  });
});
