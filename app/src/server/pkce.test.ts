import { describe, it, expect } from "vitest";
import { validateAuthorizeRequest, validateTokenRequest } from "./pkce";

// A valid S256 code_challenge: 43-char Base64URL string
const VALID_CHALLENGE = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
// A valid code_verifier matching the above challenge (any 43-128 char Base64URL string)
const VALID_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

// ─── validateAuthorizeRequest ─────────────────────────────────────────────────

describe("validateAuthorizeRequest", () => {
  function makeUrl(params: Record<string, string | undefined>): URL {
    const u = new URL("https://example.com/authorize");
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) u.searchParams.set(k, v);
    }
    return u;
  }

  it("accepts a valid S256 code_challenge", () => {
    const url = makeUrl({
      response_type: "code",
      client_id: "test-client",
      code_challenge: VALID_CHALLENGE,
      code_challenge_method: "S256",
    });
    const result = validateAuthorizeRequest(url);
    expect(result.ok).toBe(true);
  });

  it("rejects a request missing code_challenge", async () => {
    const url = makeUrl({
      response_type: "code",
      client_id: "test-client",
      code_challenge_method: "S256",
      // no code_challenge
    });
    const result = validateAuthorizeRequest(url);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      const body = await result.response.json() as { error: string };
      expect(body.error).toBe("invalid_request");
    }
  });

  it("rejects a request with code_challenge_method=plain", async () => {
    const url = makeUrl({
      code_challenge: VALID_CHALLENGE,
      code_challenge_method: "plain",
    });
    const result = validateAuthorizeRequest(url);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      const body = await result.response.json() as { error: string };
      expect(body.error).toBe("invalid_request");
    }
  });

  it("rejects a request with no code_challenge_method", async () => {
    const url = makeUrl({ code_challenge: VALID_CHALLENGE });
    const result = validateAuthorizeRequest(url);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
    }
  });

  it("rejects a code_challenge that is too short (< 43 chars)", async () => {
    const url = makeUrl({
      code_challenge: "short",
      code_challenge_method: "S256",
    });
    const result = validateAuthorizeRequest(url);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
    }
  });

  it("rejects a code_challenge that is too long (> 128 chars)", async () => {
    const url = makeUrl({
      code_challenge: "A".repeat(129),
      code_challenge_method: "S256",
    });
    const result = validateAuthorizeRequest(url);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
    }
  });

  it("rejects a code_challenge containing standard Base64 padding (=)", async () => {
    const url = makeUrl({
      code_challenge: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk=",
      code_challenge_method: "S256",
    });
    const result = validateAuthorizeRequest(url);
    expect(result.ok).toBe(false);
  });

  it("rejects a code_challenge containing forbidden chars (+, /)", async () => {
    const url = makeUrl({
      code_challenge: "dBjftJeZ4CVP+mB92K27uhbUJU1p1r/wW1gFWFOEjXk",
      code_challenge_method: "S256",
    });
    const result = validateAuthorizeRequest(url);
    expect(result.ok).toBe(false);
  });

  it("accepts a code_challenge of exactly 43 characters", () => {
    const url = makeUrl({
      code_challenge: "A".repeat(43),
      code_challenge_method: "S256",
    });
    expect(validateAuthorizeRequest(url).ok).toBe(true);
  });

  it("accepts a code_challenge of exactly 128 characters", () => {
    const url = makeUrl({
      code_challenge: "A".repeat(128),
      code_challenge_method: "S256",
    });
    expect(validateAuthorizeRequest(url).ok).toBe(true);
  });
});

// ─── validateTokenRequest ─────────────────────────────────────────────────────

describe("validateTokenRequest", () => {
  function makeParams(pairs: Record<string, string>): URLSearchParams {
    return new URLSearchParams(pairs);
  }

  it("accepts a valid authorization_code grant with code_verifier", () => {
    const params = makeParams({
      grant_type: "authorization_code",
      code: "some-auth-code",
      code_verifier: VALID_VERIFIER,
    });
    expect(validateTokenRequest(params).ok).toBe(true);
  });

  it("rejects an authorization_code grant missing code_verifier", async () => {
    const params = makeParams({
      grant_type: "authorization_code",
      code: "some-auth-code",
      // no code_verifier
    });
    const result = validateTokenRequest(params);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      const body = await result.response.json() as { error: string };
      expect(body.error).toBe("invalid_request");
    }
  });

  it("rejects an authorization_code grant with a short code_verifier", async () => {
    const params = makeParams({
      grant_type: "authorization_code",
      code: "some-auth-code",
      code_verifier: "short",
    });
    const result = validateTokenRequest(params);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
    }
  });

  it("rejects a code_verifier containing standard Base64 padding", async () => {
    const params = makeParams({
      grant_type: "authorization_code",
      code: "some-auth-code",
      code_verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk=",
    });
    const result = validateTokenRequest(params);
    expect(result.ok).toBe(false);
  });

  it("skips PKCE check for refresh_token grants", () => {
    const params = makeParams({
      grant_type: "refresh_token",
      refresh_token: "some-refresh-token",
      // no code_verifier — should be fine for refresh
    });
    expect(validateTokenRequest(params).ok).toBe(true);
  });

  it("skips PKCE check for client_credentials grants", () => {
    const params = makeParams({
      grant_type: "client_credentials",
    });
    expect(validateTokenRequest(params).ok).toBe(true);
  });

  it("accepts a code_verifier of exactly 43 characters", () => {
    const params = makeParams({
      grant_type: "authorization_code",
      code: "c",
      code_verifier: "A".repeat(43),
    });
    expect(validateTokenRequest(params).ok).toBe(true);
  });

  it("rejects a code_verifier of exactly 129 characters", async () => {
    const params = makeParams({
      grant_type: "authorization_code",
      code: "c",
      code_verifier: "A".repeat(129),
    });
    const result = validateTokenRequest(params);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
    }
  });
});
