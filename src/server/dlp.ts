// DLP Active Masking Utility to Redact Secrets and PII

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const PHONE_REGEX = /\b(?:\+?\d{1,3}[. -]?)?\(?\d{3}\)?[. -]?\d{3}[. -]?\d{4}\b/g;

// Visa, Mastercard, Amex, Discover
const CREDIT_CARD_REGEX = /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6011)[ -]?\d{4,6}[ -]?\d{4,5}[ -]?\d{4}\b/g;

const SSN_REGEX = /\b\d{3}-\d{2}-\d{4}\b/g;

// Secrets & Keys
const AWS_ACCESS_KEY_REGEX = /\bAKIA[A-Z0-9]{16}\b/g;
const STRIPE_KEY_REGEX = /\b(?:sk|pk)_(?:live|test)_[a-zA-Z0-9]{24,}\b/g;
const GITHUB_TOKEN_REGEX = /\bgh[pousr]_[a-zA-Z0-9]{36,255}\b/g;
const SLACK_TOKEN_REGEX = /\bxox[baprs]-[a-zA-Z0-9-]{10,}\b/g;
const GOOGLE_API_KEY_REGEX = /\bAIza[yA-Z0-9_-]{35}\b/g;

const CONNECTION_URI_REGEX = /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis(?:s)?|sqlite):\/\/[a-zA-Z0-9_]+:[^@\s]+@[a-zA-Z0-9.-]+(?::\d+)?(?:\/[a-zA-Z0-9_.-]+)?\b/g;

const PRIVATE_KEY_REGEX = /-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+ PRIVATE KEY-----/g;

// Generic Bearer tokens / Authorization headers
const AUTH_BEARER_REGEX = /\bBearer\s+[a-zA-Z0-9_\-\.]{20,}\b/gi;
const API_KEY_ASSIGNMENT_REGEX = /\b(api[-_]key|password|secret|passcode|token)\s*[:=]\s*['"]([a-zA-Z0-9_\-\.]{12,})['"]/gi;

/**
 * Scans a text string and redacts any detected sensitive data (API keys, PII, database strings, private keys).
 * Returns the masked string.
 */
export function maskSensitiveData(text: string): string {
  if (!text) return "";
  
  let masked = text;
  
  // 1. Replace high-entropy keys and tokens
  masked = masked.replace(AWS_ACCESS_KEY_REGEX, "[REDACTED_AWS_ACCESS_KEY]");
  masked = masked.replace(STRIPE_KEY_REGEX, "[REDACTED_STRIPE_KEY]");
  masked = masked.replace(GITHUB_TOKEN_REGEX, "[REDACTED_GITHUB_TOKEN]");
  masked = masked.replace(SLACK_TOKEN_REGEX, "[REDACTED_SLACK_TOKEN]");
  masked = masked.replace(GOOGLE_API_KEY_REGEX, "[REDACTED_GOOGLE_API_KEY]");
  masked = masked.replace(PRIVATE_KEY_REGEX, "[REDACTED_PRIVATE_KEY]");
  masked = masked.replace(CONNECTION_URI_REGEX, "[REDACTED_CONNECTION_STRING]");
  
  // 2. Replace PII (Personally Identifiable Information)
  masked = masked.replace(EMAIL_REGEX, "[REDACTED_EMAIL]");
  masked = masked.replace(PHONE_REGEX, "[REDACTED_PHONE_NUMBER]");
  masked = masked.replace(CREDIT_CARD_REGEX, "[REDACTED_CREDENTIAL]");
  masked = masked.replace(SSN_REGEX, "[REDACTED_SSN]");
  
  // 3. Replace generic authorization patterns
  masked = masked.replace(AUTH_BEARER_REGEX, "Bearer [REDACTED_TOKEN]");
  masked = masked.replace(API_KEY_ASSIGNMENT_REGEX, (match, keyLabel, keyValue) => {
    // Replaces only the value part, preserving label and separator: e.g. api_key: "abc123xyz" -> api_key: "[REDACTED_CREDENTIAL]"
    return match.replace(keyValue, "[REDACTED_CREDENTIAL]");
  });
  
  return masked;
}
