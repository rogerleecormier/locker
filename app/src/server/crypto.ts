// AES-256-GCM encryption for memory facts at rest.
// ENCRYPTION_KEY env var must be a 64-char hex string (32 bytes).
//
// Envelope Encryption Architecture:
//   - ENCRYPTION_KEY acts as the Key Encryption Key (KEK) — it ONLY wraps/unwraps DEKs.
//   - Each vault (user or org/team projectKey) has a unique Data Encryption Key (DEK).
//   - DEKs are generated randomly (crypto.getRandomValues), then encrypted with the KEK
//     using AES-256-GCM, and stored in the `vault_keys` D1 table.
//   - At runtime: fetch wrapped DEK from D1, unwrap it using the KEK, use it to encrypt/decrypt data.
//   - Compromising the ENCRYPTION_KEY alone does NOT decrypt data without the wrapped DEKs in D1.
//   - Compromising D1 alone does NOT decrypt data without the ENCRYPTION_KEY.
//
// Backward compatibility:
//   - Legacy data encrypted with the HKDF-derived per-user key (deriveUserKey) is handled in
//     decryptFact() via the fallbackKey parameter.
//   - The admin encryptAllMemories function can re-encrypt legacy data under new DEKs.

import type { D1Database } from "@cloudflare/workers-types";

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── KEK helpers (ENCRYPTION_KEY used ONLY here) ───────────────────────────────

async function importKEK(hexKEK: string): Promise<CryptoKey> {
  const keyBytes = hexToBytes(hexKEK);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes.buffer as ArrayBuffer,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
  keyBytes.fill(0);
  return key;
}

async function wrapDEK(dek: CryptoKey, kek: CryptoKey): Promise<string> {
  const dekBytes = await crypto.subtle.exportKey("raw", dek);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    kek,
    dekBytes as ArrayBuffer
  );
  new Uint8Array(dekBytes).fill(0);
  return `${bytesToHex(iv)}:${bytesToHex(new Uint8Array(wrapped))}`;
}

async function unwrapDEK(wrappedDEK: string, kek: CryptoKey): Promise<CryptoKey> {
  const colon = wrappedDEK.indexOf(":");
  if (colon === -1) throw new Error("Invalid wrappedDEK format");
  const iv = hexToBytes(wrappedDEK.slice(0, colon));
  const ciphertext = hexToBytes(wrappedDEK.slice(colon + 1));
  const dekBytes = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    kek,
    ciphertext as unknown as BufferSource
  );
  iv.fill(0);
  ciphertext.fill(0);
  const dek = await crypto.subtle.importKey(
    "raw",
    dekBytes,
    { name: "AES-GCM" },
    false, // extractable: false
    ["encrypt", "decrypt"]
  );
  new Uint8Array(dekBytes).fill(0);
  return dek;
}

// ── Vault Key lifecycle ───────────────────────────────────────────────────────

/**
 * Fetch or create the vault DEK for a given vaultId (userId or "team:xxx" / "org:xxx").
 *
 * - Looks up the `vault_keys` table in D1.
 * - If not found, generates a new random DEK, wraps it with the KEK, stores it, and returns the DEK.
 * - If found, unwraps the stored DEK using the KEK and returns the DEK.
 *
 * The returned CryptoKey is compatible with the updated encrypt()/decrypt() helpers.
 */
export async function getOrCreateVaultKey(db: D1Database, masterKey: string, vaultId: string): Promise<CryptoKey> {
  const kek = await importKEK(masterKey);

  // Try to fetch existing wrapped DEK
  const existing = await db
    .prepare("SELECT wrapped_dek FROM vault_keys WHERE vault_id = ? LIMIT 1")
    .bind(vaultId)
    .first<{ wrapped_dek: string }>();

  if (existing) {
    return unwrapDEK(existing.wrapped_dek, kek);
  }

  // Generate a new random DEK and wrap it with the KEK
  const dek = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const wrappedDEK = await wrapDEK(dek, kek);

  // Insert with conflict guard in case of a concurrent request
  await db
    .prepare(
      "INSERT INTO vault_keys (vault_id, wrapped_dek, created_at) VALUES (?, ?, ?) ON CONFLICT(vault_id) DO NOTHING"
    )
    .bind(vaultId, wrappedDEK, Date.now())
    .run();

  // Re-fetch to get the canonical stored DEK (handles any race condition)
  const inserted = await db
    .prepare("SELECT wrapped_dek FROM vault_keys WHERE vault_id = ? LIMIT 1")
    .bind(vaultId)
    .first<{ wrapped_dek: string }>();

  if (inserted) {
    return unwrapDEK(inserted.wrapped_dek, kek);
  }

  return dek;
}

// ── Ephemeral Plaintext and Decryption Helpers ───────────────────────────────

export class EphemeralPlaintext {
  private bytes: Uint8Array | null;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  /**
   * Access the plaintext as a string. Keep the scope of this string as narrow as possible.
   */
  get(): string {
    if (!this.bytes) throw new Error("Plaintext has already been dropped");
    return new TextDecoder().decode(this.bytes);
  }

  /**
   * Explicitly zero out the underlying buffer to clear it from volatile memory.
   */
  drop(): void {
    if (this.bytes) {
      this.bytes.fill(0);
      this.bytes = null;
    }
  }
}

export async function decryptEphemeral(encrypted: string, key: string | CryptoKey): Promise<EphemeralPlaintext> {
  const colon = encrypted.indexOf(":");
  if (colon === -1) throw new Error("Invalid encrypted format");
  const iv = hexToBytes(encrypted.slice(0, colon));
  const ciphertext = hexToBytes(encrypted.slice(colon + 1));
  const cryptoKey = await importKey(key);
  const plaintextBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    cryptoKey,
    ciphertext as unknown as BufferSource
  );
  iv.fill(0);
  ciphertext.fill(0);

  return new EphemeralPlaintext(new Uint8Array(plaintextBuffer));
}

// ── Legacy key derivation (backward compatibility ONLY) ──────────────────────
//
// deriveUserKey is DEPRECATED for new encryptions. It is kept solely to support
// decrypting legacy data encrypted before envelope encryption was introduced.
// Pass its output as the `fallbackKey` argument in decryptFact(); never use it
// as the primary encryption key for new data.

export async function deriveUserKey(masterKey: string, userId: string): Promise<string> {
  const masterBytes = hexToBytes(masterKey);
  const keyMaterial = await crypto.subtle.importKey("raw", masterBytes.buffer as ArrayBuffer, "HKDF", false, ["deriveKey"]);
  const derived = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode(userId), info: new TextEncoder().encode("locker-memory-key") },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  const exported = await crypto.subtle.exportKey("raw", derived);
  return bytesToHex(new Uint8Array(exported));
}

async function importKey(key: string | CryptoKey): Promise<CryptoKey> {
  if (typeof key !== "string") return key;
  const keyBytes = hexToBytes(key);
  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes.buffer as ArrayBuffer, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
  keyBytes.fill(0);
  return cryptoKey;
}

// Returns "iv_hex:ciphertext_hex"
export async function encrypt(plaintext: string, key: string | CryptoKey): Promise<string> {
  const cryptoKey = await importKey(key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as unknown as BufferSource }, cryptoKey, encoded as unknown as BufferSource);
  return `${bytesToHex(iv)}:${bytesToHex(new Uint8Array(ciphertext))}`;
}

// Accepts "iv_hex:ciphertext_hex", returns original plaintext
export async function decrypt(encrypted: string, key: string | CryptoKey): Promise<string> {
  const colon = encrypted.indexOf(":");
  if (colon === -1) throw new Error("Invalid encrypted format");
  const iv = hexToBytes(encrypted.slice(0, colon));
  const ciphertext = hexToBytes(encrypted.slice(colon + 1));
  const cryptoKey = await importKey(key);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as unknown as BufferSource }, cryptoKey, ciphertext as unknown as BufferSource);
  iv.fill(0);
  ciphertext.fill(0);
  return new TextDecoder().decode(plaintext);
}

// Returns true if the string looks like our encrypted format (iv:ciphertext)
export function isEncrypted(value: string): boolean {
  // Check if value starts with a hex prefix expected from encrypt() to avoid false positives
  // (e.g., a plain fact that happens to be 24 lowercase hex chars + colon + more hex)
  const colon = value.indexOf(":");
  if (colon !== 24) return false; // IV is 12 bytes = 24 hex chars
  if (!value.startsWith("0") && !/^[1-9a-f]/.test(value)) return false; // Should start with hex
  return /^[0-9a-f]{24}:[0-9a-f]+$/.test(value);
}

// Extract the 8-character lookup prefix from a raw lkr_... token.
// Returns chars [4, 12) — the first 8 chars after the "lkr_" prefix.
// Stored unindexed in tokenPrefix so a single indexed WHERE clause can
// narrow the PBKDF2 candidate set from O(n) to O(1) on most tables.
export function extractTokenPrefix(raw: string): string | null {
  if (!raw.startsWith("lkr_") || raw.length < 12) return null;
  return raw.slice(4, 12);
}

// Returns the SHA-256 hex digest of a string.
// Used for looking up legacy API tokens (pre-PBKDF2) via their stored hash.
export async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  return bytesToHex(new Uint8Array(hashBuffer));
}

/**
 * Compute a blind index for a tag list so the D1 layer can pre-filter rows by
 * tag without touching the encrypted fact column.
 *
 * Algorithm: SHA-256(vaultId + ":" + normalised_tag_list)
 *   - Tags are lowercased, trimmed, sorted, and deduplicated before hashing so
 *     the same logical tag set always maps to the same hash regardless of the
 *     order they were written.
 *   - vaultId acts as a domain-separation salt: an attacker with only the D1
 *     dump and no ENCRYPTION_KEY cannot build a rainbow table across vaults.
 *   - Returns a 64-char hex string suitable for an indexed TEXT column.
 *
 * @param vaultId  userId for personal vaults, "org:xxx" / "team:xxx" for shared ones.
 * @param tags     Comma-separated tag string as stored in the memories.tags column.
 */
export async function computeBlindIndex(vaultId: string, tags: string): Promise<string> {
  const normalised = tags
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join(",");
  const input = `${vaultId}:${normalised}`;
  const encoded = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  return bytesToHex(new Uint8Array(hashBuffer));
}

// Maximum number of keyword tokens stored in the blind index per memory.
// Bounds the JSON column size to ~12 KB (200 × 64-char hex hash + delimiters).
const MAX_KEYWORD_TOKENS = 200;

// Minimum token length to exclude single-char noise and common two-letter stop words.
const MIN_TOKEN_LEN = 3;

/**
 * Tokenise a plaintext fact into keyword tokens suitable for blind indexing.
 * Lowercases, splits on non-word characters, deduplicates, and drops tokens
 * shorter than MIN_TOKEN_LEN to reduce stop-word noise.
 */
export function extractKeywordTokens(fact: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const raw of fact.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= MIN_TOKEN_LEN && !seen.has(raw)) {
      seen.add(raw);
      tokens.push(raw);
      if (tokens.length >= MAX_KEYWORD_TOKENS) break;
    }
  }
  return tokens;
}

/**
 * Compute a single SHA-256 hash for one keyword token (salted with vaultId).
 * Used both at write time (per token in the index) and at query time (to look up
 * whether the keyword hash appears in keyword_blind_index via json_each).
 *
 * @param vaultId  userId for personal vaults, "org:xxx" / "team:xxx" for shared.
 * @param token    A single lowercased keyword token (no spaces).
 */
export async function computeKeywordTokenHash(vaultId: string, token: string): Promise<string> {
  const input = `kw:${vaultId}:${token.toLowerCase().trim()}`;
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return bytesToHex(new Uint8Array(hashBuffer));
}

/**
 * Build the JSON string stored in memories.keyword_blind_index for a given fact.
 * Returns a JSON array of per-token SHA-256 hashes (salted with vaultId), or null
 * when the fact produces no indexable tokens.
 *
 * @param vaultId  userId for personal vaults, "org:xxx" / "team:xxx" for shared.
 * @param fact     The plaintext fact string (before encryption).
 */
export async function buildKeywordBlindIndex(vaultId: string, fact: string): Promise<string | null> {
  const tokens = extractKeywordTokens(fact);
  if (tokens.length === 0) return null;
  const hashes = await Promise.all(tokens.map((t) => computeKeywordTokenHash(vaultId, t)));
  return JSON.stringify(hashes);
}

// PBKDF2 iterations — 100,000 (Cloudflare Workers Web Crypto max for PBKDF2).
const PBKDF2_ITERATIONS = 100_000;

// Hash a token with PBKDF2-HMAC-SHA256.
// Returns a string in the format: pbkdf2$<iterations>$<base64-salt>$<base64-hash>
// A random 16-byte salt is generated per token so each hash is unique.
export async function hashToken(token: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(token),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
    },
    keyMaterial,
    256 // 32 bytes
  );
  const saltB64 = btoa(String.fromCharCode(...salt));
  const hashB64 = btoa(String.fromCharCode(...new Uint8Array(derived)));
  return `pbkdf2$${PBKDF2_ITERATIONS}$${saltB64}$${hashB64}`;
}

// Verify a token against a stored hash.
// Supports both the new PBKDF2 format (pbkdf2$...) and the legacy SHA-256 hex format
// so that existing tokens continue to work until they are rotated.
export async function verifyToken(token: string, storedHash: string): Promise<boolean> {
  if (storedHash.startsWith("pbkdf2$")) {
    const parts = storedHash.split("$");
    if (parts.length !== 4) return false;
    const iterations = parseInt(parts[1], 10);
    if (!Number.isFinite(iterations) || iterations < 1) return false;
    const salt = Uint8Array.from(atob(parts[2]), (c) => c.charCodeAt(0));
    const expectedHashBytes = Uint8Array.from(atob(parts[3]), (c) => c.charCodeAt(0));
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(token),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const derived = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: salt,
        iterations: iterations,
      },
      keyMaterial,
      expectedHashBytes.length * 8
    );
    const derivedBytes = new Uint8Array(derived);

    // Constant-time comparison to prevent timing attacks
    if (derivedBytes.length !== expectedHashBytes.length) return false;
    let diff = 0;
    for (let i = 0; i < derivedBytes.length; i++) {
      diff |= derivedBytes[i] ^ expectedHashBytes[i];
    }
    return diff === 0;
  }

  // Legacy path: SHA-256 hex (64 hex chars).  Accept but do not upgrade here —
  // the caller should re-hash and persist the new format on next write.
  if (/^[0-9a-f]{64}$/.test(storedHash)) {
    const encoded = new TextEncoder().encode(token);
    const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
    const legacyHash = bytesToHex(new Uint8Array(hashBuffer));
    return legacyHash === storedHash;
  }

  return false;
}
