// AES-256-GCM encryption for memory facts at rest.
// ENCRYPTION_KEY env var must be a 64-char hex string (32 bytes).

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

async function importKey(hexKey: string): Promise<CryptoKey> {
  const keyBytes = hexToBytes(hexKey);
  return crypto.subtle.importKey("raw", keyBytes.buffer as ArrayBuffer, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

// Returns "iv_hex:ciphertext_hex"
export async function encrypt(plaintext: string, hexKey: string): Promise<string> {
  const key = await importKey(hexKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as unknown as BufferSource }, key, encoded as unknown as BufferSource);
  return `${bytesToHex(iv)}:${bytesToHex(new Uint8Array(ciphertext))}`;
}

// Accepts "iv_hex:ciphertext_hex", returns original plaintext
export async function decrypt(encrypted: string, hexKey: string): Promise<string> {
  const colon = encrypted.indexOf(":");
  if (colon === -1) throw new Error("Invalid encrypted format");
  const iv = hexToBytes(encrypted.slice(0, colon));
  const ciphertext = hexToBytes(encrypted.slice(colon + 1));
  const key = await importKey(hexKey);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as unknown as BufferSource }, key, ciphertext as unknown as BufferSource);
  return new TextDecoder().decode(plaintext);
}

// Returns true if the string looks like our encrypted format (iv:ciphertext)
export function isEncrypted(value: string): boolean {
  const colon = value.indexOf(":");
  if (colon !== 24) return false; // IV is 12 bytes = 24 hex chars
  return /^[0-9a-f]+:[0-9a-f]+$/.test(value);
}

// Hash a token with SHA-256, returns hex. Used for storing API tokens.
export async function hashToken(token: string): Promise<string> {
  const encoded = new TextEncoder().encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  return bytesToHex(new Uint8Array(hashBuffer));
}
