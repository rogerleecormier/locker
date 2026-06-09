/**
 * Strict OAuth 2.1 PKCE enforcement for MCP authorization exchanges.
 *
 * Remediates CVE-2025-4144: an authorization request that strips
 * code_challenge must be rejected before it reaches the upstream
 * OAuth provider, which might silently accept plain-text flows.
 *
 * RFC 7636 §4.2 / OAuth 2.1 §4.1.1:
 *   - code_challenge MUST be present on every /authorize request
 *   - code_challenge_method MUST be "S256" (plain is forbidden)
 *   - code_challenge value MUST be a Base64URL string of exactly 43-128 chars
 *
 * RFC 7636 §4.5 / OAuth 2.1 §4.1.3:
 *   - code_verifier MUST be present on every /token exchange
 *   - code_verifier MUST be a Base64URL string of exactly 43-128 chars
 */

/** Base64URL alphabet — no padding, no +/ */
const BASE64URL_RE = /^[A-Za-z0-9\-_]{43,128}$/;

export interface PkceAuthorizeResult {
  ok: true;
}

export interface PkceAuthorizeError {
  ok: false;
  response: Response;
}

export type PkceAuthorizeCheck = PkceAuthorizeResult | PkceAuthorizeError;

function invalidRequest(description: string): Response {
  return Response.json(
    { error: "invalid_request", error_description: description },
    {
      status: 400,
      headers: { "Content-Type": "application/json" },
    },
  );
}

/**
 * Validates that a /authorize request carries a well-formed S256 code_challenge.
 * Call this before forwarding the request to the upstream OAuth provider.
 *
 * Returns { ok: true } when the request is acceptable.
 * Returns { ok: false, response } with a ready-to-return 400 when it is not.
 */
export function validateAuthorizeRequest(url: URL): PkceAuthorizeCheck {
  const challenge = url.searchParams.get("code_challenge");
  const method = url.searchParams.get("code_challenge_method");

  if (!challenge) {
    return { ok: false, response: invalidRequest("code_challenge is required") };
  }

  // OAuth 2.1 §4.1.1 forbids the "plain" method; only S256 is permitted.
  if (method !== "S256") {
    return { ok: false, response: invalidRequest("code_challenge_method must be S256") };
  }

  if (!BASE64URL_RE.test(challenge)) {
    return { ok: false, response: invalidRequest("code_challenge must be a Base64URL-encoded SHA-256 digest (43-128 characters)") };
  }

  return { ok: true };
}

/**
 * Validates that a /token exchange carries a well-formed code_verifier.
 *
 * Accepts both URL-encoded body params and query params so callers
 * do not need to re-parse the body; pass whichever URLSearchParams
 * surface is available.
 *
 * Returns { ok: true } when the request is acceptable.
 * Returns { ok: false, response } with a ready-to-return 400 when it is not.
 */
export function validateTokenRequest(params: URLSearchParams): PkceAuthorizeCheck {
  const grantType = params.get("grant_type");

  // PKCE only applies to the authorization_code grant.
  if (grantType !== "authorization_code") {
    return { ok: true };
  }

  const verifier = params.get("code_verifier");

  if (!verifier) {
    return { ok: false, response: invalidRequest("code_verifier is required") };
  }

  if (!BASE64URL_RE.test(verifier)) {
    return { ok: false, response: invalidRequest("code_verifier must be a Base64URL string (43-128 characters)") };
  }

  return { ok: true };
}
