/**
 * Tests for src/server/setup.ts
 *
 * Coverage:
 *   ensureClaudeOAuthClient
 *     1. skips when CLAUDE_CLIENT_ID is absent
 *     2. creates a new row when none exists
 *     3. skips the UPDATE when existing row matches (the new read-before-write guard)
 *     4. updates when redirectUris differ
 *     5. updates when scopes differ
 *     6. updates when clientSecret differs
 *
 *   ensureDemoUser
 *     7.  skips when DEMO_EMAIL is absent
 *     8.  skips when DEMO_PASSWORD is absent
 *     9.  skips when user already exists
 *     10. creates user, plan, account, and memories when none exist
 *
 *   runSetup
 *     11. returns skipped/skipped when env vars are absent
 *     12. surfaces individual errors as skipped without crashing the orchestrator
 *
 * Run: npx vitest run src/server/setup.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ensureClaudeOAuthClient, ensureDemoUser, runSetup } from "./setup";

// ── Module mocks ──────────────────────────────────────────────────────────────

// better-auth/crypto — hashPassword is only used in ensureDemoUser's create path
vi.mock("better-auth/crypto", () => ({
  hashPassword: vi.fn().mockResolvedValue("hashed-pw"),
}));

// crypto module — getOrCreateVaultKey + encrypt used in ensureDemoUser
vi.mock("~/server/crypto", () => ({
  getOrCreateVaultKey: vi.fn().mockResolvedValue("vault-key"),
  encrypt: vi.fn().mockResolvedValue("encrypted-fact"),
}));

// persistChunkedVectors — vectorize call, fire-and-forget
vi.mock("~/server/memory/_shared", () => ({
  persistChunkedVectors: vi.fn().mockResolvedValue(undefined),
}));

// drizzle — intercepted only in runSetup tests; unit tests receive db directly
vi.mock("drizzle-orm/d1", () => ({
  drizzle: vi.fn().mockReturnValue(makeMockDb({ existing: null })),
}));

// ── DB mock factory ───────────────────────────────────────────────────────────

const EXPECTED_REDIRECT_URIS = JSON.stringify(["https://claude.ai/api/mcp/auth_callback"]);
const EXPECTED_SCOPES = JSON.stringify([
  "openid",
  "profile",
  "email",
  "offline_access",
  "openid:mcp:recall",
  "openid:mcp:commit",
  "openid:mcp:update",
  "openid:mcp:delete",
]);

function makeMockDb(opts: {
  existing: Record<string, unknown> | null;
  insertFn?: ReturnType<typeof vi.fn>;
  updateFn?: ReturnType<typeof vi.fn>;
}) {
  const insertMock = opts.insertFn ?? vi.fn().mockReturnValue({
    values: vi.fn().mockResolvedValue(undefined),
  });
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const updateMock = opts.updateFn
    ? opts.updateFn
    : vi.fn().mockReturnValue({ set: updateSet });

  return {
    query: {
      oauthClients: {
        findFirst: vi.fn().mockResolvedValue(opts.existing),
      },
      users: {
        findFirst: vi.fn().mockResolvedValue(opts.existing),
      },
    },
    insert: insertMock,
    update: updateMock,
    _updateSet: updateSet,
    _updateWhere: updateWhere,
  } as any;
}

function makeBaseEnv(overrides: Record<string, unknown> = {}): any {
  return {
    CLAUDE_CLIENT_ID: "test-client-id",
    CLAUDE_CLIENT_SECRET: null,
    DEMO_EMAIL: undefined,
    DEMO_PASSWORD: undefined,
    DB: {} as any,
    ENCRYPTION_KEY: "enc-key",
    AI: {} as any,
    VECTOR_INDEX: {} as any,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ensureClaudeOAuthClient
// ─────────────────────────────────────────────────────────────────────────────

describe("ensureClaudeOAuthClient", () => {
  it("returns skipped when CLAUDE_CLIENT_ID is absent", async () => {
    const db = makeMockDb({ existing: null });
    const env = makeBaseEnv({ CLAUDE_CLIENT_ID: undefined });
    const result = await ensureClaudeOAuthClient(db, env);
    expect(result).toEqual({ status: "skipped" });
    expect(db.query.oauthClients.findFirst).not.toHaveBeenCalled();
  });

  it("inserts and returns created when no existing row", async () => {
    const insertValues = vi.fn().mockResolvedValue(undefined);
    const insertMock = vi.fn().mockReturnValue({ values: insertValues });
    const db = makeMockDb({ existing: null, insertFn: insertMock });
    const env = makeBaseEnv();

    const result = await ensureClaudeOAuthClient(db, env);

    expect(result).toEqual({ status: "created" });
    expect(insertMock).toHaveBeenCalledOnce();
    expect(insertValues).toHaveBeenCalledOnce();
    const inserted = insertValues.mock.calls[0][0];
    expect(inserted.clientId).toBe("test-client-id");
    expect(inserted.redirectUris).toBe(EXPECTED_REDIRECT_URIS);
    expect(inserted.scopes).toBe(EXPECTED_SCOPES);
  });

  it("returns skipped WITHOUT updating when existing row is identical", async () => {
    const existingRow = {
      clientId: "test-client-id",
      clientSecret: null,
      redirectUris: EXPECTED_REDIRECT_URIS,
      scopes: EXPECTED_SCOPES,
    };
    const updateMock = vi.fn();
    const db = makeMockDb({ existing: existingRow, updateFn: updateMock });
    const env = makeBaseEnv({ CLAUDE_CLIENT_SECRET: null });

    const result = await ensureClaudeOAuthClient(db, env);

    expect(result).toEqual({ status: "skipped" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("updates and returns updated when redirectUris differ", async () => {
    const existingRow = {
      clientId: "test-client-id",
      clientSecret: null,
      redirectUris: JSON.stringify(["https://old.example.com/callback"]),
      scopes: EXPECTED_SCOPES,
    };
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    const updateMock = vi.fn().mockReturnValue({ set: updateSet });
    const db = makeMockDb({ existing: existingRow, updateFn: updateMock });
    const env = makeBaseEnv({ CLAUDE_CLIENT_SECRET: null });

    const result = await ensureClaudeOAuthClient(db, env);

    expect(result).toEqual({ status: "updated" });
    expect(updateMock).toHaveBeenCalledOnce();
    expect(updateSet).toHaveBeenCalledOnce();
    const setArg = updateSet.mock.calls[0][0];
    expect(setArg.redirectUris).toBe(EXPECTED_REDIRECT_URIS);
  });

  it("updates and returns updated when scopes differ", async () => {
    const existingRow = {
      clientId: "test-client-id",
      clientSecret: null,
      redirectUris: EXPECTED_REDIRECT_URIS,
      scopes: JSON.stringify(["openid"]),
    };
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    const updateMock = vi.fn().mockReturnValue({ set: updateSet });
    const db = makeMockDb({ existing: existingRow, updateFn: updateMock });
    const env = makeBaseEnv({ CLAUDE_CLIENT_SECRET: null });

    const result = await ensureClaudeOAuthClient(db, env);

    expect(result).toEqual({ status: "updated" });
    expect(updateMock).toHaveBeenCalledOnce();
    const setArg = updateSet.mock.calls[0][0];
    expect(setArg.scopes).toBe(EXPECTED_SCOPES);
  });

  it("updates and returns updated when clientSecret differs", async () => {
    const existingRow = {
      clientId: "test-client-id",
      clientSecret: "old-secret",
      redirectUris: EXPECTED_REDIRECT_URIS,
      scopes: EXPECTED_SCOPES,
    };
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    const updateMock = vi.fn().mockReturnValue({ set: updateSet });
    const db = makeMockDb({ existing: existingRow, updateFn: updateMock });
    const env = makeBaseEnv({ CLAUDE_CLIENT_SECRET: "new-secret" });

    const result = await ensureClaudeOAuthClient(db, env);

    expect(result).toEqual({ status: "updated" });
    expect(updateMock).toHaveBeenCalledOnce();
    const setArg = updateSet.mock.calls[0][0];
    expect(setArg.clientSecret).toBe("new-secret");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ensureDemoUser
// ─────────────────────────────────────────────────────────────────────────────

describe("ensureDemoUser", () => {
  it("returns skipped when DEMO_EMAIL is absent", async () => {
    const db = makeMockDb({ existing: null });
    const env = makeBaseEnv({ DEMO_EMAIL: undefined, DEMO_PASSWORD: "pw" });
    const result = await ensureDemoUser(db, env);
    expect(result).toEqual({ status: "skipped" });
    expect(db.query.users.findFirst).not.toHaveBeenCalled();
  });

  it("returns skipped when DEMO_PASSWORD is absent", async () => {
    const db = makeMockDb({ existing: null });
    const env = makeBaseEnv({ DEMO_EMAIL: "demo@example.com", DEMO_PASSWORD: undefined });
    const result = await ensureDemoUser(db, env);
    expect(result).toEqual({ status: "skipped" });
    expect(db.query.users.findFirst).not.toHaveBeenCalled();
  });

  it("returns skipped when user already exists", async () => {
    const existingUser = { id: "demo_user_id_locker_dev", email: "demo@example.com" };
    const insertMock = vi.fn();
    const db = makeMockDb({ existing: existingUser, insertFn: insertMock });
    const env = makeBaseEnv({ DEMO_EMAIL: "demo@example.com", DEMO_PASSWORD: "secret" });

    const result = await ensureDemoUser(db, env);

    expect(result).toEqual({ status: "skipped" });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("creates user, plan, account, and memories when none exist", async () => {
    const insertValues = vi.fn().mockResolvedValue(undefined);
    const insertMock = vi.fn().mockReturnValue({ values: insertValues });
    // findFirst returns null → user does not exist yet
    const db = {
      query: {
        users: { findFirst: vi.fn().mockResolvedValue(null) },
      },
      insert: insertMock,
    } as any;

    const env = makeBaseEnv({
      DEMO_EMAIL: "demo@example.com",
      DEMO_PASSWORD: "secret",
    });

    const result = await ensureDemoUser(db, env);

    expect(result).toEqual({ status: "created" });

    // insert should be called for: users, userPlans, accounts, and 3× memories
    expect(insertMock.mock.calls.length).toBeGreaterThanOrEqual(4);

    // First insert call must be for the user row
    const firstCallArg = insertMock.mock.calls[0][0];
    // The schema table object is passed — we can't deep-equal it, but values() was called
    expect(insertValues).toHaveBeenCalled();
    const userInsert = insertValues.mock.calls[0][0];
    expect(userInsert.email).toBe("demo@example.com");
    expect(userInsert.id).toBe("demo_user_id_locker_dev");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// runSetup
// ─────────────────────────────────────────────────────────────────────────────

describe("runSetup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns skipped/skipped when required env vars are absent", async () => {
    // drizzle mock returns a db that findFirst → null for both
    const { drizzle } = await import("drizzle-orm/d1");
    vi.mocked(drizzle).mockReturnValue(makeMockDb({ existing: null }) as any);

    const env = makeBaseEnv({
      CLAUDE_CLIENT_ID: undefined,
      DEMO_EMAIL: undefined,
      DEMO_PASSWORD: undefined,
    });

    const result = await runSetup(env);
    expect(result.claudeOAuthClient).toEqual({ status: "skipped" });
    expect(result.demoUser).toEqual({ status: "skipped" });
  });

  it("surfaces individual task errors as skipped without crashing", async () => {
    const { drizzle } = await import("drizzle-orm/d1");
    // Make the db throw on oauthClients.findFirst
    const badDb = {
      query: {
        oauthClients: { findFirst: vi.fn().mockRejectedValue(new Error("D1 connection failed")) },
        users: { findFirst: vi.fn().mockResolvedValue({ id: "existing" }) },
      },
      insert: vi.fn(),
      update: vi.fn(),
    } as any;
    vi.mocked(drizzle).mockReturnValue(badDb);

    const env = makeBaseEnv({
      CLAUDE_CLIENT_ID: "some-id",
      DEMO_EMAIL: "demo@example.com",
      DEMO_PASSWORD: "pw",
    });

    const result = await runSetup(env);
    // OAuth task threw → surfaced as skipped
    expect(result.claudeOAuthClient).toEqual({ status: "skipped" });
    // Demo user task: existing user → skipped normally
    expect(result.demoUser).toEqual({ status: "skipped" });
  });
});
