import { createServerFn } from "@tanstack/react-start";
import { drizzle } from "drizzle-orm/d1";
import { eq, and } from "drizzle-orm";
import { totpSecrets, users } from "~/db/schema";
import { requireSession } from "~/server/session";
import { encrypt, decrypt, getOrCreateVaultKey } from "~/server/crypto";
import type { CloudflareEnv } from "~/types/cloudflare";

type CFContext = { cloudflare: { env: CloudflareEnv; ctx: ExecutionContext } };

// Generate a random secret for TOTP
function generateSecret(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => chars[b % chars.length]).join("");
}

// Verify a TOTP code
export async function verifyTOTP(secret: string, code: string, window: number = 1): Promise<boolean> {
  const cleanCode = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(cleanCode)) return false;

  let keyBytes;
  try {
    keyBytes = base32Decode(secret);
  } catch {
    return false;
  }

  const timeStep = 30;
  const nowSec = Math.floor(Date.now() / 1000);
  const currentStep = Math.floor(nowSec / timeStep);

  for (let offset = -window; offset <= window; offset++) {
    const step = currentStep + offset;
    const computedCode = await generateHOTP(keyBytes, step);
    if (cleanCode === computedCode) {
      return true;
    }
  }
  return false;
}

function base32Decode(base32: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = base32.toUpperCase().replace(/=/g, "");
  const length = clean.length;
  const bits = length * 5;
  const bytes = new Uint8Array(Math.floor(bits / 8));
  
  let val = 0;
  let valBits = 0;
  let byteIdx = 0;
  
  for (let i = 0; i < length; i++) {
    const char = clean[i];
    const idx = alphabet.indexOf(char);
    if (idx === -1) throw new Error("Invalid base32 character");
    
    val = (val << 5) | idx;
    valBits += 5;
    
    if (valBits >= 8) {
      bytes[byteIdx++] = (val >>> (valBits - 8)) & 255;
      valBits -= 8;
    }
  }
  return bytes;
}

async function generateHOTP(keyBytes: Uint8Array, step: number): Promise<string> {
  const msg = new Uint8Array(8);
  let temp = step;
  for (let i = 7; i >= 0; i--) {
    msg[i] = temp & 0xff;
    temp = temp >>> 8;
  }

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes as any,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );

  const hmacBuffer = await crypto.subtle.sign("HMAC", cryptoKey, msg);
  const hmac = new Uint8Array(hmacBuffer);

  const offset = hmac[hmac.length - 1] & 0xf;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = binary % 1000000;
  return String(otp).padStart(6, "0");
}

// Hash a backup code
async function hashBackupCode(code: string): Promise<string> {
  const encoded = new TextEncoder().encode(code);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Start TOTP setup — generate secret and return QR code data
export const setupTOTP = createServerFn({ method: "POST" }).handler(
  async ({ context }): Promise<{ secret: string; uri: string; backupCodes: string[] }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);

    const secret = generateSecret();
    const backupCodes = Array.from({ length: 10 }, () => {
      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
      const buf = new Uint8Array(8);
      crypto.getRandomValues(buf);
      return Array.from(buf, (b) => chars[b % chars.length]).join("");
    });

    // Generate TOTP URI for QR code
    const encodedSecret = encodeURIComponent(secret);
    const uri = `otpauth://totp/Locker:${encodeURIComponent(user.email)}?secret=${encodedSecret}&issuer=Locker&digits=6`;

    return { secret, uri, backupCodes };
  }
);

// Verify TOTP code and save to database
export const verifyAndSaveTOTP = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { secret: string; code: string; backupCodes: string[] } => {
    const d = data as { secret: string; code: string; backupCodes: string[] };
    if (!d.secret || typeof d.secret !== "string") throw new Error("secret is required");
    if (!d.code || typeof d.code !== "string") throw new Error("code is required");
    if (!Array.isArray(d.backupCodes)) throw new Error("backupCodes must be an array");
    return { secret: d.secret, code: d.code, backupCodes: d.backupCodes };
  })
  .handler(async ({ data, context }): Promise<{ success: boolean; message: string }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);

    if (!(await verifyTOTP(data.secret, data.code))) {
      return { success: false, message: "Invalid TOTP code" };
    }

    const db = drizzle(env.DB, { schema: { totpSecrets, users } });
    // Use envelope DEK for new TOTP secrets
    const userKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, user.id);

    // Encrypt secret
    const encryptedSecret = await encrypt(data.secret, userKey);

    // Hash backup codes
    const hashedCodes = await Promise.all(data.backupCodes.map((code) => hashBackupCode(code)));

    // Save TOTP secret
    await db
      .insert(totpSecrets)
      .values({
        id: crypto.randomUUID(),
        userId: user.id,
        secret: encryptedSecret,
        verified: true,
        backupCodes: JSON.stringify(hashedCodes),
        createdAt: new Date(),
        verifiedAt: new Date(),
      })
      .run();

    return { success: true, message: "TOTP enabled successfully" };
  });

// Disable TOTP for user
export const disableTOTP = createServerFn({ method: "POST" }).handler(
  async ({ context }): Promise<{ success: boolean }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);

    const db = drizzle(env.DB, { schema: { totpSecrets } });
    await db.delete(totpSecrets).where(eq(totpSecrets.userId, user.id)).run();

    return { success: true };
  }
);

// Get TOTP status
export const getTOTPStatus = createServerFn({ method: "GET" }).handler(
  async ({ context }): Promise<{ enabled: boolean }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);

    const db = drizzle(env.DB, { schema: { totpSecrets } });
    const existing = await db.select().from(totpSecrets).where(eq(totpSecrets.userId, user.id)).limit(1).all();

    return { enabled: existing.length > 0 && existing[0].verified };
  }
);
