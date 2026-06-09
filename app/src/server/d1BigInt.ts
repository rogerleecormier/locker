/**
 * D1 int64 safety wrapper
 *
 * V8 (and by extension Cloudflare Workers) can only represent integers up to
 * 2^53 - 1 (Number.MAX_SAFE_INTEGER) without silent precision loss.  SQLite
 * stores epoch-millisecond timestamps and certain counter values as int64,
 * which can exceed that limit.  When D1 deserialises those values into JS it
 * silently truncates the low bits, corrupting referential integrity.
 *
 * Strategy: rewrite SELECT column lists so every potentially-large INTEGER
 * column is wrapped in SQLite's CAST(col AS TEXT), forcing the DB engine to
 * serialise the value as a decimal string before the wire transfer.  The
 * application layer then parses those strings into native BigInt primitives.
 *
 * Usage:
 *   import { d1All, d1First, parseBigIntFields } from "~/server/d1BigInt";
 *
 *   const rows = await d1All<RawRow>(db, "SELECT id, timestamp FROM foo", []);
 *   const parsed = rows.map(r => parseBigIntFields(r, ["timestamp"]));
 */

import type { D1Database } from "@cloudflare/workers-types";

// ---------------------------------------------------------------------------
// SQL rewriting helpers
// ---------------------------------------------------------------------------

/**
 * Rewrites a bare column reference in a SELECT list to CAST(col AS TEXT).
 *
 * Handles:
 *   "col"           → "CAST(col AS TEXT)"
 *   "tbl.col"       → 'CAST("tbl"."col" AS TEXT)'
 *   '"alias"."col"' → 'CAST("alias"."col" AS TEXT)'
 *
 * If the token already contains "CAST(" it is returned unchanged so the
 * function is safe to call idempotently.
 */
function castColumn(token: string): string {
  const trimmed = token.trim();
  if (/CAST\s*\(/i.test(trimmed)) return trimmed;

  // Quote each dot-separated segment with double quotes.
  const parts = trimmed.split(".").map((p) => {
    const stripped = p.replace(/^["']|["']$/g, "");
    return `"${stripped}"`;
  });
  return `CAST(${parts.join(".")} AS TEXT)`;
}

/**
 * Rewrites column references in a SELECT statement for a given list of column
 * names, wrapping each in CAST(... AS TEXT).
 *
 * The function performs a regex-based token substitution on the SELECT clause
 * only (stopping at the first FROM keyword), so it won't corrupt WHERE
 * conditions that reference the same column names.
 *
 * Limitations:
 * - Does not handle sub-selects in the projection list.
 * - Assumes standard SQL formatting (single space between tokens).
 * - Column names must be simple identifiers or table.column pairs.
 *
 * For complex queries, call `castColumn` manually and build the SQL string
 * with explicit CAST expressions rather than relying on this rewriter.
 */
export function rewriteSelectForBigInt(sql: string, int64Columns: readonly string[]): string {
  if (int64Columns.length === 0) return sql;

  // Isolate the SELECT projection (everything between SELECT and FROM).
  const fromIdx = sql.search(/\bFROM\b/i);
  if (fromIdx === -1) return sql; // no FROM → can't safely rewrite
  const selectClause = sql.slice(0, fromIdx);
  const rest = sql.slice(fromIdx);

  const colSet = new Set(int64Columns.map((c) => c.toLowerCase()));

  // Split on commas that are not inside parentheses to get individual tokens.
  const tokens: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of selectClause) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      tokens.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  tokens.push(current);

  const rewritten = tokens.map((token) => {
    const bare = token.trim().replace(/^["']|["']$/g, "").toLowerCase();
    // Match "col" or "tbl.col" bare forms.
    const simpleName = bare.split(".").pop() ?? bare;
    if (colSet.has(simpleName) || colSet.has(bare)) {
      return castColumn(token);
    }
    return token;
  });

  return rewritten.join(",") + rest;
}

// ---------------------------------------------------------------------------
// Core wrapper functions
// ---------------------------------------------------------------------------

/**
 * Executes a D1 prepared statement returning multiple rows.
 *
 * @param db           Raw D1Database binding from the Worker env.
 * @param sql          SQL query string (SELECT only; mutations should use db directly).
 * @param bindings     Ordered list of bind parameters (?1, ?2 …).
 * @param int64Columns Column names whose raw values must be coerced to TEXT
 *                     before transport to avoid V8 int64 truncation.  When
 *                     provided the SQL is rewritten automatically.
 *
 * @returns Typed array of result rows.  Any column in `int64Columns` will be
 *          a `string` in the returned objects — convert with BigInt(row.col).
 */
export async function d1All<T extends Record<string, unknown>>(
  db: D1Database,
  sql: string,
  bindings: unknown[],
  int64Columns: readonly string[] = [],
): Promise<T[]> {
  const rewritten = rewriteSelectForBigInt(sql, int64Columns);
  const stmt = db.prepare(rewritten);
  const bound = bindings.length > 0 ? stmt.bind(...bindings) : stmt;
  const result = await bound.all<T>();
  return result.results ?? [];
}

/**
 * Executes a D1 prepared statement returning at most one row.
 *
 * @see d1All for parameter documentation.
 * @returns The first matching row, or `null` if none exists.
 */
export async function d1First<T extends Record<string, unknown>>(
  db: D1Database,
  sql: string,
  bindings: unknown[],
  int64Columns: readonly string[] = [],
): Promise<T | null> {
  const rewritten = rewriteSelectForBigInt(sql, int64Columns);
  const stmt = db.prepare(rewritten);
  const bound = bindings.length > 0 ? stmt.bind(...bindings) : stmt;
  return bound.first<T>();
}

// ---------------------------------------------------------------------------
// Application-layer BigInt parser
// ---------------------------------------------------------------------------

/**
 * Accepts a raw D1 result row and converts the nominated fields from their
 * decimal-string representation (produced by CAST(col AS TEXT)) into BigInt.
 *
 * Fields absent from the row or explicitly `null` / `undefined` are kept as-is.
 *
 * @example
 *   const row = { id: "abc", timestamp: "1749340800000" };
 *   const parsed = parseBigIntFields(row, ["timestamp"]);
 *   // → { id: "abc", timestamp: 1749340800000n }
 */
export function parseBigIntFields<
  TRaw extends Record<string, unknown>,
  TField extends keyof TRaw,
>(
  row: TRaw,
  fields: readonly TField[],
): Omit<TRaw, TField> & Record<TField, bigint | null> {
  const out = { ...row } as Record<string, unknown>;
  for (const field of fields) {
    const raw = row[field as string];
    if (raw === null || raw === undefined) {
      out[field as string] = null;
    } else {
      out[field as string] = BigInt(raw as string | number);
    }
  }
  return out as Omit<TRaw, TField> & Record<TField, bigint | null>;
}

/**
 * Convenience: parse an array of raw rows in one call.
 */
export function parseBigIntFieldsAll<
  TRaw extends Record<string, unknown>,
  TField extends keyof TRaw,
>(
  rows: TRaw[],
  fields: readonly TField[],
): Array<Omit<TRaw, TField> & Record<TField, bigint | null>> {
  return rows.map((r) => parseBigIntFields(r, fields));
}

// ---------------------------------------------------------------------------
// Column sets for this project's schema
// ---------------------------------------------------------------------------

/**
 * Integer columns in this schema that store epoch-millisecond timestamps or
 * other values that can exceed Number.MAX_SAFE_INTEGER.
 *
 * Used as a reference when calling d1All / d1First with int64Columns.
 */
export const EPOCH_MS_COLUMNS = [
  "timestamp",
  "createdAt",
  "updatedAt",
  "lastAccessedAt",
  "expiresAt",
  "planActivatedAt",
  "planExpiresAt",
  "jitExpiresAt",
  "reviewedAt",
  "processedAt",
  "revokedAt",
  "verifiedAt",
  "grantedAt",
  "joinedAt",
  "lastUsedAt",
] as const;

/**
 * Columns used as fixed-window keys that store Unix-second epoch values.
 * These are smaller (10 digits) and currently safe, but listed here for
 * future-proofing if the schema ever switches to milliseconds.
 */
export const UNIX_SEC_COLUMNS = ["minuteStart"] as const;
