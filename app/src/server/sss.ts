/**
 * Shamir's Secret Sharing — isolated reconstruction module.
 *
 * Isolation contract:
 *   - All intermediate BigInt values stay in local scope; no heap references
 *     escape the reconstruct() call frame.
 *   - Input share buffers are zeroed by the caller via ShamirShare.zero() once
 *     reconstruct() returns.
 *   - The returned ShamirSecret must be consumed and dropped (zero()) promptly;
 *     the caller must not hold a long-lived reference.
 *   - This module deliberately has no imports from the rest of the server so
 *     it cannot be accidentally wired into the MCP routing layer.
 *
 * Finite field: GF(p) where p is the 256-bit prime below.  All polynomial
 * evaluation and Lagrange interpolation happen entirely in BigInt arithmetic
 * to prevent JavaScript Number overflow on large field elements.
 *
 * Usage:
 *   const shares = [new ShamirShare(x1Bytes, y1Bytes), ...];
 *   const secret = reconstruct(shares);          // throws on bad input
 *   const kekBytes = secret.consume();           // zeroes internal buffer, returns copy
 *   secret.zero();                               // belt-and-suspenders; consume() already zeroes
 *   shares.forEach(s => s.zero());
 */

// ── Field prime ───────────────────────────────────────────────────────────────
// A 256-bit Mersenne-like safe prime used as the field modulus.
// Must be larger than any possible secret (32 bytes = 256 bits).
// This is the 256-bit prime: 2^256 - 189 (verified prime).
const P =
  115792089237316195423570985008687907853269984665640564039457584007913129639747n;

const FIELD_BYTES = 32; // 256-bit / 8

// ── Typed-array helpers ───────────────────────────────────────────────────────

function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) | BigInt(byte);
  }
  return result;
}

function bigIntToBytes(value: bigint, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let v = value;
  for (let i = length - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

// ── Modular arithmetic ────────────────────────────────────────────────────────

function mod(a: bigint, m: bigint): bigint {
  return ((a % m) + m) % m;
}

// Extended Euclidean algorithm — returns modular inverse of a mod m.
// Throws if gcd(a, m) !== 1 (i.e., a is not invertible).
function modInverse(a: bigint, m: bigint): bigint {
  let [old_r, r] = [mod(a, m), m];
  let [old_s, s] = [1n, 0n];

  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }

  if (old_r !== 1n) throw new SssError(SssErrorCode.InterpolationFailure);
  return mod(old_s, m);
}

// ── Public types ──────────────────────────────────────────────────────────────

export const enum SssErrorCode {
  /** Fewer shares provided than required (or zero shares). */
  InsufficientShares = "INSUFFICIENT_SHARES",
  /** A share has an x-coordinate of zero, which is the secret itself. */
  InvalidShareIndex = "INVALID_SHARE_INDEX",
  /** Share byte arrays have incorrect or inconsistent lengths. */
  MalformedShare = "MALFORMED_SHARE",
  /** Modular inverse failed — shares are inconsistent or from different polynomials. */
  InterpolationFailure = "INTERPOLATION_FAILURE",
  /** Share x-coordinates are not distinct. */
  DuplicateShareIndex = "DUPLICATE_SHARE_INDEX",
}

/** Generic failure surface: always reveals only the error code, never field values. */
export class SssError extends Error {
  readonly code: SssErrorCode;
  constructor(code: SssErrorCode) {
    super(`SSS reconstruction failed: ${code}`);
    this.name = "SssError";
    this.code = code;
  }
}

/**
 * A single Shamir share (x, y) held in typed array buffers.
 *
 * Both x and y are big-endian FIELD_BYTES-length byte arrays representing
 * elements of GF(P).  x must be in [1, P-1]; y is unconstrained in [0, P-1].
 *
 * Call zero() when done to scrub the buffers.
 */
export class ShamirShare {
  private _x: Uint8Array;
  private _y: Uint8Array;
  private _zeroed = false;

  constructor(x: Uint8Array, y: Uint8Array) {
    if (x.length !== FIELD_BYTES || y.length !== FIELD_BYTES) {
      throw new SssError(SssErrorCode.MalformedShare);
    }
    // Copy into owned buffers so callers cannot mutate after construction.
    this._x = new Uint8Array(x);
    this._y = new Uint8Array(y);
  }

  /** Read x as BigInt. Only valid before zero() is called. */
  readX(): bigint {
    this._assertLive();
    return bytesToBigInt(this._x);
  }

  /** Read y as BigInt. Only valid before zero() is called. */
  readY(): bigint {
    this._assertLive();
    return bytesToBigInt(this._y);
  }

  /** Overwrite both buffers with zeros and mark this share as dead. */
  zero(): void {
    this._x.fill(0);
    this._y.fill(0);
    this._zeroed = true;
  }

  private _assertLive(): void {
    if (this._zeroed) throw new SssError(SssErrorCode.MalformedShare);
  }
}

/**
 * The reconstructed secret, held in a single Uint8Array buffer.
 *
 * Consume the value with consume() (returns a copy and zeroes the internal
 * buffer), then call zero() as a belt-and-suspenders measure.
 */
export class ShamirSecret {
  private _bytes: Uint8Array | null;

  /** @internal — constructed only by reconstruct(). */
  constructor(bytes: Uint8Array) {
    this._bytes = bytes;
  }

  /**
   * Return a one-time copy of the secret bytes and immediately zero the
   * internal buffer.  Subsequent calls throw.
   */
  consume(): Uint8Array {
    if (!this._bytes) throw new SssError(SssErrorCode.InterpolationFailure);
    const copy = new Uint8Array(this._bytes);
    this._bytes.fill(0);
    this._bytes = null;
    return copy;
  }

  /** Belt-and-suspenders zero — safe to call even after consume(). */
  zero(): void {
    if (this._bytes) {
      this._bytes.fill(0);
      this._bytes = null;
    }
  }
}

// ── Core reconstruction ───────────────────────────────────────────────────────

/**
 * Reconstruct the secret α = f(0) from t or more shares using Lagrange
 * interpolation over GF(P).
 *
 * All BigInt intermediates are local to this function and eligible for GC
 * the moment the call returns.  No intermediate value is written to a
 * long-lived typed array.
 *
 * Error boundary: any arithmetic or validation failure throws SssError with a
 * generic code.  The degree of the polynomial (t-1) and the field prime P are
 * never included in the thrown error.
 *
 * @param shares  At least t ShamirShare objects; must all be live (not zeroed).
 * @returns       ShamirSecret — caller must consume() and zero() promptly.
 * @throws        SssError on any validation or interpolation failure.
 */
export function reconstruct(shares: ShamirShare[]): ShamirSecret {
  if (shares.length < 1) {
    throw new SssError(SssErrorCode.InsufficientShares);
  }

  // Validate and read share coordinates into BigInt locals.
  const xs: bigint[] = [];
  const ys: bigint[] = [];

  for (const share of shares) {
    let x: bigint;
    let y: bigint;
    try {
      x = share.readX();
      y = share.readY();
    } catch {
      throw new SssError(SssErrorCode.MalformedShare);
    }

    if (x === 0n || x >= P) {
      throw new SssError(SssErrorCode.InvalidShareIndex);
    }
    if (y >= P) {
      throw new SssError(SssErrorCode.MalformedShare);
    }

    xs.push(x);
    ys.push(y);
  }

  // Detect duplicate x-coordinates.
  const seen = new Set<bigint>();
  for (const x of xs) {
    if (seen.has(x)) throw new SssError(SssErrorCode.DuplicateShareIndex);
    seen.add(x);
  }

  // Lagrange interpolation at x=0: α = Σ y_i · L_i(0)
  // where L_i(0) = Π_{j≠i} (-x_j) / (x_i - x_j)  (all arithmetic mod P)
  let secret = 0n;
  const n = xs.length;

  for (let i = 0; i < n; i++) {
    let num = 1n; // numerator:   Π_{j≠i} (0 - x_j)  =  Π_{j≠i} (-x_j)
    let den = 1n; // denominator: Π_{j≠i} (x_i - x_j)

    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      num = mod(num * mod(-xs[j], P), P);
      den = mod(den * mod(xs[i] - xs[j], P), P);
    }

    const lagrange = mod(num * modInverse(den, P), P);
    secret = mod(secret + mod(ys[i] * lagrange, P), P);
  }

  // Encode secret back to a fixed-length byte array.
  const secretBytes = bigIntToBytes(secret, FIELD_BYTES);

  // Explicitly null the local BigInt references so the GC can reclaim them.
  // (BigInt values are immutable value types in V8; this just clears bindings.)
  secret = 0n;
  xs.fill(0n);
  ys.fill(0n);

  return new ShamirSecret(secretBytes);
}

// ── Share generation (needed for tests and key ceremony) ─────────────────────

/**
 * Split a 32-byte secret into `n` shares requiring `t` to reconstruct.
 *
 * Generates a random degree-(t-1) polynomial f over GF(P) with f(0) = secret,
 * then evaluates it at x = 1, 2, …, n.
 *
 * @param secretBytes  Exactly FIELD_BYTES (32) bytes.
 * @param t            Threshold (minimum shares to reconstruct).
 * @param n            Total shares to generate (n >= t).
 * @returns            Array of n ShamirShare objects.
 */
export async function split(secretBytes: Uint8Array, t: number, n: number): Promise<ShamirShare[]> {
  if (secretBytes.length !== FIELD_BYTES) {
    throw new SssError(SssErrorCode.MalformedShare);
  }
  if (t < 2 || n < t) {
    throw new SssError(SssErrorCode.InsufficientShares);
  }

  const alpha = bytesToBigInt(secretBytes);
  if (alpha >= P) throw new SssError(SssErrorCode.MalformedShare);

  // Random coefficients a_1 … a_{t-1} in GF(P); a_0 = alpha.
  const coeffs: bigint[] = [alpha];
  for (let k = 1; k < t; k++) {
    const randBytes = new Uint8Array(FIELD_BYTES);
    crypto.getRandomValues(randBytes);
    coeffs.push(mod(bytesToBigInt(randBytes), P));
    randBytes.fill(0);
  }

  // Evaluate f(x) = Σ a_k * x^k  for x = 1 … n.
  const shares: ShamirShare[] = [];
  for (let xi = 1; xi <= n; xi++) {
    const x = BigInt(xi);
    let y = 0n;
    let xPow = 1n;
    for (const coeff of coeffs) {
      y = mod(y + mod(coeff * xPow, P), P);
      xPow = mod(xPow * x, P);
    }
    shares.push(new ShamirShare(bigIntToBytes(x, FIELD_BYTES), bigIntToBytes(y, FIELD_BYTES)));
    y = 0n;
  }

  // Zero polynomial coefficients.
  coeffs.fill(0n);

  return shares;
}
