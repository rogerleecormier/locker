// DLP — Non-Destructive Quarantine Layer — Entropy-Based Secret Detection + PII Regex
//
// Strategy (non-destructive):
//   When sensitive data is detected at WRITE time the raw fact is encrypted and stored
//   unchanged, but the row is flagged isQuarantined=true in the database.  At READ time
//   (recall_context) quarantined rows return "[REDACTED]" to AI callers.  A human
//   verification dashboard lets users review the clear text and unmask the record.
//
// Detection rules:
//   1. PII (emails, SSNs, phone numbers, credit cards) — regex only, always quarantine.
//   2. Known high-confidence structural secret patterns (private keys, connection URIs,
//      vendor tokens) — regex only, always quarantine.
//   3. Generic key-value / assignment patterns — both pattern match AND high Shannon
//      entropy (>= ENTROPY_THRESHOLD bits/char) are required to quarantine.  This
//      eliminates false positives on short IDs, slugs, and prose words.
//
// maskSensitiveData() is kept for testing/auditing purposes and returns the redacted
// string without side effects.  It is NOT called during the ingestion path; the
// ingestion path uses containsSensitiveData() to set the quarantine flag and then
// stores the original (encrypted) text unchanged.

// ---------------------------------------------------------------------------
// Shannon entropy helpers
// ---------------------------------------------------------------------------

/**
 * Calculate Shannon entropy of a string in bits per character.
 * Returns 0 for empty or single-character strings.
 */
export function shannonEntropy(s: string): number {
  if (s.length <= 1) return 0;
  const freq: Record<string, number> = {};
  for (const ch of s) {
    freq[ch] = (freq[ch] ?? 0) + 1;
  }
  let entropy = 0;
  const len = s.length;
  for (const count of Object.values(freq)) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

// Minimum entropy (bits/char) for a value to be treated as a secret when found
// in a key-value context.  Human-readable words cluster around 3.0–3.7; real
// random tokens (API keys, JWT secrets, base64 blobs) are typically ≥ 4.0.
// Setting to 4.05 avoids false positives on readable slugs like "myproject-api-v2"
// (entropy ~3.86) while reliably catching real credentials (entropy 4.5–5.5+).
// Use 4.05 rather than 4.0 to avoid floating-point edge cases.
const ENTROPY_THRESHOLD = 4.05;

// Minimum length a candidate value must have before entropy scoring applies.
// Short strings (< 16 chars) are rarely real secrets even at high entropy.
const MIN_SECRET_LENGTH = 16;

// ---------------------------------------------------------------------------
// PII patterns — regex only (not gated by entropy)
// ---------------------------------------------------------------------------

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// Phone regex: matches US phone formats with structure
// Patterns: (555) 867-5309, 555-867-5309, +1-555-867-5309, or similar
// No word boundaries at start since ( is not a word char
const PHONE_REGEX = /(?:\+\d{1,3}[. -]?)?(?:\(\d{3}\)[. -]?\d{3}[. -]?\d{4}|\d{3}[. -]\d{3}[. -]\d{4})/g;

// Visa, Mastercard, Amex, Discover
const CREDIT_CARD_REGEX = /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6011)[ -]?\d{4,6}[ -]?\d{4,5}[ -]?\d{4}\b/g;

const SSN_REGEX = /\b\d{3}-\d{2}-\d{4}\b/g;

// ---------------------------------------------------------------------------
// High-confidence structural secret patterns — regex only (no entropy gate)
// These have unmistakable format and extremely low false-positive rate.
// ---------------------------------------------------------------------------

// AWS access key IDs always start with AKIA and are exactly 20 chars uppercase+digits
const AWS_ACCESS_KEY_REGEX = /\bAKIA[A-Z0-9]{16}\b/g;

// Stripe live/test keys
const STRIPE_KEY_REGEX = /\b(?:sk|pk)_(?:live|test)_[a-zA-Z0-9]{24,}\b/g;

// GitHub personal access tokens (both classic ghp_ and fine-grained github_pat_)
const GITHUB_TOKEN_REGEX = /\bgh[pousr]_[a-zA-Z0-9]{36,255}\b/g;

// Slack bot/app/user/workspace tokens
const SLACK_TOKEN_REGEX = /\bxox[baprs]-[a-zA-Z0-9-]{10,}\b/g;

// Google API keys (typically 39-40 chars total)
const GOOGLE_API_KEY_REGEX = /\bAIza[a-zA-Z0-9_-]{35,}\b/g;

// Database connection URIs with embedded credentials
const CONNECTION_URI_REGEX = /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis(?:s)?|sqlite):\/\/[a-zA-Z0-9_]+:[^@\s]+@[a-zA-Z0-9.-]+(?::\d+)?(?:\/[a-zA-Z0-9_.-]+)?\b/g;

// PEM private keys
const PRIVATE_KEY_REGEX = /-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+ PRIVATE KEY-----/g;

// ---------------------------------------------------------------------------
// Entropy-gated patterns — only redact when BOTH pattern matches AND value has
// high Shannon entropy.  This cuts false positives on short/low-entropy IDs.
// ---------------------------------------------------------------------------

// Authorization header: "Bearer <token>" or "Token <token>"
// Capture group 1 = the token value
const AUTH_BEARER_CAPTURE = /\b(Bearer|Token)\s+([a-zA-Z0-9_\-\.+/=]{20,})\b/gi;

// Key-value assignment in code or config:
//   api_key = "VALUE", secret: 'VALUE', password = VALUE, token=VALUE, etc.
// Capture group 1 = key label, group 2 = value (quoted or unquoted word token)
const KV_ASSIGNMENT_CAPTURE =
  /\b(api[-_]?key|apikey|api[-_]?secret|apisecret|access[-_]?key|access[-_]?token|auth[-_]?token|secret[-_]?key|secret|password|passwd|passcode|token|private[-_]?key|client[-_]?secret|bearer|credential|credentials)\s*[:=]\s*['"]?([a-zA-Z0-9_\-\.+/=]{16,})['"]?/gi;

// JSON object property with a secret-looking key:
//   "api_key": "VALUE"  or  "secret": "VALUE"
// Capture group 1 = key, group 2 = value
const JSON_KV_CAPTURE =
  /"(api[-_]?key|apikey|api[-_]?secret|apisecret|access[-_]?key|access[-_]?token|auth[-_]?token|secret[-_]?key|secret|password|passwd|passcode|token|private[-_]?key|client[-_]?secret|bearer|credential|credentials)"\s*:\s*"([^"]{16,})"/gi;

// HTTP header assignment: "X-Api-Key: VALUE", "Authorization: VALUE"
// Capture group 1 = header name, group 2 = value
const HTTP_HEADER_CAPTURE =
  /^(x-api-key|x-auth-token|x-secret|authorization|api-key|api-token)\s*:\s*([a-zA-Z0-9_\-\.+/=]{16,})\s*$/gim;

// ---------------------------------------------------------------------------
// Core entropy-gated redaction helper
// ---------------------------------------------------------------------------

/**
 * Given a regex that captures (context, value) in groups 1 and 2, replace
 * occurrences where the value has Shannon entropy >= ENTROPY_THRESHOLD.
 */
function redactHighEntropyCaptures(
  text: string,
  regex: RegExp,
  buildReplacement: (match: string, ctx: string, val: string) => string
): string {
  // Reset regex state (global flag)
  regex.lastIndex = 0;
  return text.replace(regex, (match, ctx: string, val: string) => {
    if (val.length < MIN_SECRET_LENGTH) return match;
    if (shannonEntropy(val) >= ENTROPY_THRESHOLD) {
      return buildReplacement(match, ctx, val);
    }
    return match;
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan text for secrets and PII, returning the redacted string.
 *
 * Call this at WRITE time (commit_memory / update_memory) — not at read time —
 * so that stored memories are clean and recall does not corrupt legitimate data.
 */
export function maskSensitiveData(text: string): string {
  if (!text) return "";

  let masked = text;

  // --- Pass 1: High-confidence structural patterns (no entropy gate needed) ---
  masked = masked.replace(AWS_ACCESS_KEY_REGEX, "[REDACTED_AWS_ACCESS_KEY]");
  masked = masked.replace(STRIPE_KEY_REGEX, "[REDACTED_STRIPE_KEY]");
  masked = masked.replace(GITHUB_TOKEN_REGEX, "[REDACTED_GITHUB_TOKEN]");
  masked = masked.replace(SLACK_TOKEN_REGEX, "[REDACTED_SLACK_TOKEN]");
  masked = masked.replace(GOOGLE_API_KEY_REGEX, "[REDACTED_GOOGLE_API_KEY]");
  masked = masked.replace(PRIVATE_KEY_REGEX, "[REDACTED_PRIVATE_KEY]");
  masked = masked.replace(CONNECTION_URI_REGEX, "[REDACTED_CONNECTION_STRING]");

  // --- Pass 2: PII (regex only, no entropy gate) ---
  masked = masked.replace(EMAIL_REGEX, "[REDACTED_EMAIL]");
  masked = masked.replace(PHONE_REGEX, "[REDACTED_PHONE_NUMBER]");
  masked = masked.replace(CREDIT_CARD_REGEX, "[REDACTED_CREDENTIAL]");
  masked = masked.replace(SSN_REGEX, "[REDACTED_SSN]");

  // --- Pass 3: Entropy-gated generic patterns ---

  // Authorization headers: keep "Bearer " prefix, redact only the token
  masked = redactHighEntropyCaptures(
    masked,
    AUTH_BEARER_CAPTURE,
    (_match, ctx, _val) => `${ctx} [REDACTED_TOKEN]`
  );

  // Key-value assignments in code/config
  masked = redactHighEntropyCaptures(
    masked,
    KV_ASSIGNMENT_CAPTURE,
    (match, _ctx, val) => match.replace(val, "[REDACTED_CREDENTIAL]")
  );

  // JSON key-value pairs
  masked = redactHighEntropyCaptures(
    masked,
    JSON_KV_CAPTURE,
    (match, _ctx, val) => match.replace(val, "[REDACTED_CREDENTIAL]")
  );

  // HTTP header lines
  masked = redactHighEntropyCaptures(
    masked,
    HTTP_HEADER_CAPTURE,
    (match, _ctx, val) => match.replace(val, "[REDACTED_CREDENTIAL]")
  );

  return masked;
}

/**
 * Returns true if the text contains any detectable secret or PII.
 * Does not mutate the input. Use this at WRITE time to set isQuarantined.
 */
export function containsSensitiveData(text: string): boolean {
  return maskSensitiveData(text) !== text;
}

export type DlpTrigger =
  | "aws_access_key"
  | "stripe_key"
  | "github_token"
  | "slack_token"
  | "google_api_key"
  | "private_key"
  | "connection_string"
  | "email"
  | "phone"
  | "credit_card"
  | "ssn"
  | "bearer_token"
  | "kv_credential"
  | "json_credential"
  | "http_header_credential";

/**
 * Classifies which DLP rules fired on the given text without mutating it.
 * Returns an empty array if no sensitive data is detected.
 * Useful for dashboard display so users know *why* a memory was quarantined.
 */
export function classifySensitiveData(text: string): DlpTrigger[] {
  if (!text) return [];
  const triggers: DlpTrigger[] = [];

  function testAndReset(regex: RegExp, trigger: DlpTrigger) {
    regex.lastIndex = 0;
    if (regex.test(text)) triggers.push(trigger);
    regex.lastIndex = 0;
  }

  testAndReset(AWS_ACCESS_KEY_REGEX, "aws_access_key");
  testAndReset(STRIPE_KEY_REGEX, "stripe_key");
  testAndReset(GITHUB_TOKEN_REGEX, "github_token");
  testAndReset(SLACK_TOKEN_REGEX, "slack_token");
  testAndReset(GOOGLE_API_KEY_REGEX, "google_api_key");
  testAndReset(PRIVATE_KEY_REGEX, "private_key");
  testAndReset(CONNECTION_URI_REGEX, "connection_string");
  testAndReset(EMAIL_REGEX, "email");
  testAndReset(PHONE_REGEX, "phone");
  testAndReset(CREDIT_CARD_REGEX, "credit_card");
  testAndReset(SSN_REGEX, "ssn");

  // Entropy-gated patterns
  function testEntropyGated(regex: RegExp, trigger: DlpTrigger) {
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      const val = m[2] ?? "";
      if (val.length >= MIN_SECRET_LENGTH && shannonEntropy(val) >= ENTROPY_THRESHOLD) {
        triggers.push(trigger);
        break;
      }
    }
    regex.lastIndex = 0;
  }

  testEntropyGated(AUTH_BEARER_CAPTURE, "bearer_token");
  testEntropyGated(KV_ASSIGNMENT_CAPTURE, "kv_credential");
  testEntropyGated(JSON_KV_CAPTURE, "json_credential");
  testEntropyGated(HTTP_HEADER_CAPTURE, "http_header_credential");

  return triggers;
}
