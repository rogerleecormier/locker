/**
 * crypto.client.ts — Browser-side E2EE pipeline for BYOK memory commits.
 *
 * This module runs exclusively in the browser (never on the Cloudflare Worker).
 * It implements the two client-side steps required for true end-to-end encryption:
 *
 *   1. Embedding generation via Transformers.js (xenova/all-MiniLM-L6-v2).
 *      The float32 embedding vector is computed locally and sent as-is to the
 *      server, which stores it in Vectorize without seeing the plaintext.
 *
 *   2. AES-256-GCM encryption of the memory fact using a client-held key.
 *      The resulting ciphertext is Base64-encoded and sent to the server.
 *      The server only stores the opaque ciphertext + the float vector.
 *
 * Security contract:
 *   - Plaintext memory strings NEVER leave the browser.
 *   - The server receives: Base64(IV + ciphertext) + float[] embedding.
 *   - The DEK is derived from the org master key held in sessionStorage
 *     (zeroed on tab close) and never transmitted.
 *
 * Key storage:
 *   - The CryptoKey object lives in a module-scoped variable for the tab session.
 *   - It is loaded from an ephemeral sessionStorage slot on first use.
 *   - Call loadByokKey() once after the user authenticates and provides their key.
 *   - Call clearByokKey() on logout to zero memory.
 */

// ── Key state (module-scoped, not persisted) ──────────────────────────────────

let _byokKey: CryptoKey | null = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

// ── Key lifecycle ─────────────────────────────────────────────────────────────

/**
 * Load a 64-char hex master key into the module-level CryptoKey slot.
 * Call this once after the user authenticates and provides their BYOK key.
 * The raw hex string should be discarded by the caller immediately after.
 */
export async function loadByokKey(hexKey: string): Promise<void> {
  if (hexKey.length !== 64) {
    throw new Error(`Invalid BYOK key length: expected 64 hex chars, got ${hexKey.length}`);
  }
  if (!/^[0-9a-fA-F]{64}$/.test(hexKey)) {
    throw new Error("Invalid BYOK key: must be a 64-character hex string (only 0-9, a-f, A-F)");
  }
  const keyBytes = hexToBytes(hexKey);
  _byokKey = await crypto.subtle.importKey(
    "raw",
    keyBytes.buffer as ArrayBuffer,
    { name: "AES-GCM" },
    false, // non-extractable
    ["encrypt", "decrypt"],
  );
  // Zero the hex bytes from the intermediate buffer
  keyBytes.fill(0);
}

/**
 * Zero the in-memory key slot.
 * Call on logout or when the BYOK session should end.
 */
export function clearByokKey(): void {
  _byokKey = null;
}

/** Returns true when a BYOK key is loaded and ready. */
export function isByokKeyLoaded(): boolean {
  return _byokKey !== null;
}

// ── Encryption ────────────────────────────────────────────────────────────────

/**
 * Encrypt a plaintext memory fact with the loaded BYOK key.
 *
 * Output format: Base64(12-byte IV || AES-GCM ciphertext)
 * This is the format the server Zod schema accepts as a valid ciphertext.
 *
 * Throws ByokKeyNotLoadedError if no key has been loaded via loadByokKey().
 */
export async function encryptFact(plaintext: string): Promise<string> {
  if (!_byokKey) {
    throw new ByokKeyNotLoadedError(
      "No BYOK key loaded. Call loadByokKey() before encrypting.",
    );
  }

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    _byokKey,
    encoded,
  );

  // Pack IV + ciphertext into a single Base64 blob.
  // The server validates this as /^[A-Za-z0-9+/]+=*$/ with length >= 24.
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  // Zero working buffers
  iv.fill(0);
  encoded.fill(0);

  return bytesToBase64(combined);
}

/**
 * Decrypt a Base64(IV || ciphertext) blob produced by encryptFact().
 * Used client-side when displaying memories back to the user.
 */
export async function decryptFact(b64Ciphertext: string): Promise<string> {
  if (!_byokKey) {
    throw new ByokKeyNotLoadedError(
      "No BYOK key loaded. Call loadByokKey() before decrypting.",
    );
  }

  const combined = base64ToBytes(b64Ciphertext);
  if (combined.length < 13) {
    throw new Error("Invalid ciphertext: too short to contain IV + data");
  }

  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    _byokKey,
    ciphertext,
  );

  return new TextDecoder().decode(plaintext);
}

// ── Embedding generation ──────────────────────────────────────────────────────

type EmbeddingPipeline = {
  (text: string, options?: { pooling: string; normalize: boolean }): Promise<{
    data: Float32Array;
  }>;
};

/**
 * Lazy-loaded pipeline reference. We import Transformers.js dynamically so
 * the heavy model weight download only happens the first time a memory is
 * committed in a BYOK session.
 */
let _pipelinePromise: Promise<EmbeddingPipeline> | null = null;

// Allow tests (and server-side environments where Transformers.js is unavailable)
// to inject a mock pipeline via setEmbeddingPipeline() before calling
// generateLocalEmbedding().
let _pipelineOverride: EmbeddingPipeline | null = null;

export function setEmbeddingPipeline(pipeline: EmbeddingPipeline | null): void {
  _pipelineOverride = pipeline;
  _pipelinePromise = null;
}

async function getEmbeddingPipeline(): Promise<EmbeddingPipeline> {
  if (_pipelineOverride) return _pipelineOverride;

  if (!_pipelinePromise) {
    _pipelinePromise = (async () => {
      // Use an indirect dynamic import to prevent bundlers and test runners
      // from statically resolving @xenova/transformers at transform time.
      // In test environments, setEmbeddingPipeline() installs a mock so this
      // code path is never reached.
      // eslint-disable-next-line no-new-func
      const lazyImport = new Function("m", "return import(m)") as (m: string) => Promise<{ pipeline: Function }>;
      const { pipeline } = await lazyImport("@xenova/transformers");
      return (pipeline as Function)("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
        quantized: true,
      }) as EmbeddingPipeline;
    })();
  }
  return _pipelinePromise;
}

/**
 * Generate a 384-dimensional float embedding vector for the given text
 * using Transformers.js (all-MiniLM-L6-v2) running locally in the browser.
 *
 * The returned Float32Array is sent to the server as the Vectorize vector.
 * The plaintext is never transmitted.
 */
export async function generateLocalEmbedding(text: string): Promise<number[]> {
  const pipe = await getEmbeddingPipeline();
  const result = await pipe(text, { pooling: "mean", normalize: true });
  return Array.from(result.data as Float32Array);
}

// ── Commit payload builder ────────────────────────────────────────────────────

export interface ByokCommitPayload {
  /** Base64(IV || AES-GCM ciphertext) — server stores this verbatim. */
  encryptedFact: string;
  /** 384-dimensional float vector — server writes this to Vectorize. */
  embedding: number[];
  category?: string;
  tags?: string;
  projectKey?: string;
  source?: string;
}

/**
 * Build a complete BYOK memory commit payload.
 *
 * This is the single entry point for the BYOK commit flow:
 *   1. Generate the local embedding (Transformers.js).
 *   2. Encrypt the fact (Web Crypto AES-GCM).
 *   3. Return a payload object safe to POST to /api/mcp (commit_memory).
 *
 * The `fact` string never leaves this function as plaintext.
 */
export async function buildByokCommitPayload(
  fact: string,
  options: {
    category?: string;
    tags?: string;
    projectKey?: string;
    source?: string;
  } = {},
): Promise<ByokCommitPayload> {
  // Run embedding and encryption concurrently — they are independent.
  const [embedding, encryptedFact] = await Promise.all([
    generateLocalEmbedding(fact),
    encryptFact(fact),
  ]);

  return {
    encryptedFact,
    embedding,
    category: options.category,
    tags: options.tags,
    projectKey: options.projectKey,
    source: options.source ?? "byok-client",
  };
}

// ── Errors ────────────────────────────────────────────────────────────────────

export class ByokKeyNotLoadedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ByokKeyNotLoadedError";
  }
}

// ── Server-side ciphertext detection helper ───────────────────────────────────

/**
 * Returns true if the value matches the BYOK ciphertext format:
 * Base64 string with minimum length 24 (12-byte IV + at least 1 byte CT + GCM tag).
 *
 * This is used by Zod schemas on the edge to reject plaintext `fact` values
 * when the BYOK header is present.
 */
export function isByokCiphertext(value: string): boolean {
  // Minimum: 12 bytes IV + 1 byte plaintext + 16 bytes GCM tag = 29 bytes → 40 base64 chars
  if (value.length < 40) return false;
  return /^[A-Za-z0-9+/]+=*$/.test(value);
}
