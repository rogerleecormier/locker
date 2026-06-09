/**
 * BYOKSetup — Bring Your Own Key configuration panel for Enterprise Org Admins.
 *
 * Two modes:
 *   "local"  — Admin supplies a 64-char hex master key. It is imported into
 *              Web Crypto, never sent to the server as plaintext. Instead the
 *              server receives only a PBKDF2 hash of the key for connectivity
 *              verification.
 *   "kms"    — Admin supplies an external KMS URL and API credential. The
 *              server is given the KMS URL; the API key is hashed (PBKDF2) on
 *              the client and only the hash is transmitted.
 *
 * Encryption of memories happens in crypto.client.ts, not here. This
 * component only configures which wrapping key/endpoint to use going forward.
 */

import { useState, useCallback } from "react";
import { z } from "zod";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Badge } from "~/components/ui/badge";

// ── Validation schemas ────────────────────────────────────────────────────────

const LocalKeySchema = z.object({
  masterKey: z
    .string()
    .length(64, "Master key must be exactly 64 hex characters (32 bytes)")
    .regex(/^[0-9a-fA-F]{64}$/, "Master key must be a valid hex string"),
  confirmKey: z.string(),
}).refine((d) => d.masterKey === d.confirmKey, {
  message: "Keys do not match",
  path: ["confirmKey"],
});

const KmsSchema = z.object({
  kmsUrl: z
    .string()
    .url("Must be a valid HTTPS URL")
    .startsWith("https://", "KMS URL must use HTTPS"),
  kmsApiKey: z.string().min(16, "API key must be at least 16 characters"),
});

// ── Types ─────────────────────────────────────────────────────────────────────

type KeySource = "local" | "kms";

interface ByokState {
  isActive: boolean;
  keySource: KeySource | null;
  kmsUrl?: string;
  lastVerifiedAt?: number;
}

interface BYOKSetupProps {
  orgId: string;
  currentState?: ByokState;
  onSaved?: (state: ByokState) => void;
}

// ── Client-side key derivation helpers ───────────────────────────────────────

async function pbkdf2Hash(input: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(input),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 },
    keyMaterial,
    256,
  );
  const saltB64 = btoa(String.fromCharCode(...salt));
  const hashB64 = btoa(String.fromCharCode(...new Uint8Array(derived)));
  return `pbkdf2$100000$${saltB64}$${hashB64}`;
}

/**
 * Validate that a hex master key can be imported as an AES-256-GCM CryptoKey.
 * Returns the CryptoKey on success, throws on invalid input.
 */
async function validateLocalKey(hexKey: string): Promise<CryptoKey> {
  const keyBytes = new Uint8Array(
    hexKey.match(/.{2}/g)!.map((b) => parseInt(b, 16)),
  );
  return crypto.subtle.importKey(
    "raw",
    keyBytes.buffer as ArrayBuffer,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BYOKSetup({ orgId, currentState, onSaved }: BYOKSetupProps) {
  const [activeTab, setActiveTab] = useState<KeySource>(
    currentState?.keySource ?? "local",
  );
  const [localKey, setLocalKey] = useState("");
  const [localKeyConfirm, setLocalKeyConfirm] = useState("");
  const [kmsUrl, setKmsUrl] = useState(currentState?.kmsUrl ?? "");
  const [kmsApiKey, setKmsApiKey] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const handleSaveLocal = useCallback(async () => {
    setValidationError(null);
    setSaveSuccess(false);

    const parsed = LocalKeySchema.safeParse({
      masterKey: localKey,
      confirmKey: localKeyConfirm,
    });
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0].message);
      return;
    }

    setIsSaving(true);
    try {
      // Validate the key is a real AES-256 key before sending anything.
      await validateLocalKey(parsed.data.masterKey);

      // The master key is NEVER sent to the server. Only a PBKDF2 hash is
      // transmitted so the server can verify key-proof challenges.
      const keyHash = await pbkdf2Hash(parsed.data.masterKey);

      const resp = await fetch(`/api/org/${orgId}/byok`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keySource: "local",
          masterKeyHash: keyHash,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Unknown error" })) as { error?: string };
        throw new Error(err.error ?? "Save failed");
      }

      setSaveSuccess(true);
      setLocalKey("");
      setLocalKeyConfirm("");
      onSaved?.({ isActive: true, keySource: "local" });
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setIsSaving(false);
    }
  }, [localKey, localKeyConfirm, orgId, onSaved]);

  const handleSaveKms = useCallback(async () => {
    setValidationError(null);
    setSaveSuccess(false);

    const parsed = KmsSchema.safeParse({ kmsUrl, kmsApiKey });
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0].message);
      return;
    }

    setIsSaving(true);
    try {
      // Hash the API key client-side; never transmit the raw credential.
      const apiKeyHash = await pbkdf2Hash(parsed.data.kmsApiKey);

      const resp = await fetch(`/api/org/${orgId}/byok`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keySource: "kms",
          kmsUrl: parsed.data.kmsUrl,
          kmsApiKeyHash: apiKeyHash,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Unknown error" })) as { error?: string };
        throw new Error(err.error ?? "Save failed");
      }

      setSaveSuccess(true);
      setKmsApiKey("");
      onSaved?.({ isActive: true, keySource: "kms", kmsUrl: parsed.data.kmsUrl });
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setIsSaving(false);
    }
  }, [kmsUrl, kmsApiKey, orgId, onSaved]);

  return (
    <div className="w-full max-w-2xl rounded-lg border bg-card text-card-foreground shadow-sm p-6 space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Bring Your Own Key (BYOK)</h2>
          <Badge variant="secondary">Enterprise</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Configure a client-managed encryption key so plaintext memory data
          never reaches Locker servers. All encryption happens in your browser
          using the Web Crypto API before any data leaves your device.
        </p>
      </div>

      {/* Current state banner */}
      {currentState?.isActive && (
        <div className="rounded-md border p-3 text-sm bg-muted/50">
          BYOK is currently <strong>active</strong> using a{" "}
          <strong>{currentState.keySource}</strong> key source.
          {currentState.kmsUrl && (
            <> KMS endpoint: <code className="font-mono text-xs">{currentState.kmsUrl}</code></>
          )}
          {currentState.lastVerifiedAt && (
            <> Last verified: {new Date(currentState.lastVerifiedAt).toLocaleString()}.</>
          )}
        </div>
      )}

      {/* Tab bar */}
      <div className="flex border-b">
        {(["local", "kms"] as KeySource[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={[
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              activeTab === tab
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {tab === "local" ? "Local Master Key" : "External KMS"}
          </button>
        ))}
      </div>

      {/* Local key tab */}
      {activeTab === "local" && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Enter a 256-bit (64 hex character) master key. This key is used in
            your browser to encrypt each memory before it is sent to the server.
            The key itself is <strong>never transmitted</strong>.
          </p>

          <div className="space-y-1">
            <label htmlFor="masterKey" className="text-sm font-medium">
              Master Key (64 hex characters)
            </label>
            <Input
              id="masterKey"
              type="password"
              placeholder="e.g. a1b2c3d4..."
              value={localKey}
              onChange={(e) => setLocalKey(e.target.value)}
              className="font-mono"
              maxLength={64}
              autoComplete="off"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="masterKeyConfirm" className="text-sm font-medium">
              Confirm Master Key
            </label>
            <Input
              id="masterKeyConfirm"
              type="password"
              placeholder="Re-enter master key"
              value={localKeyConfirm}
              onChange={(e) => setLocalKeyConfirm(e.target.value)}
              className="font-mono"
              maxLength={64}
              autoComplete="off"
            />
          </div>

          <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950 p-3">
            <p className="text-xs text-amber-800 dark:text-amber-200">
              Store this key in a secure location (e.g. a password manager or
              hardware token). Locker cannot recover encrypted data if you lose
              this key.
            </p>
          </div>

          <Button
            onClick={handleSaveLocal}
            disabled={isSaving || !localKey || !localKeyConfirm}
            className="w-full"
          >
            {isSaving ? "Saving…" : "Save Local Key Configuration"}
          </Button>
        </div>
      )}

      {/* KMS tab */}
      {activeTab === "kms" && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Connect an external Key Management Service (KMS) such as AWS KMS,
            HashiCorp Vault, or Cloudflare KMS. Locker will call the KMS
            wrap/unwrap endpoint to protect each vault Data Encryption Key.
          </p>

          <div className="space-y-1">
            <label htmlFor="kmsUrl" className="text-sm font-medium">
              KMS Wrap/Unwrap Endpoint URL
            </label>
            <Input
              id="kmsUrl"
              type="url"
              placeholder="https://kms.example.com/v1/keys/locker/wrap"
              value={kmsUrl}
              onChange={(e) => setKmsUrl(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="kmsApiKey" className="text-sm font-medium">
              KMS API Key / Credential
            </label>
            <Input
              id="kmsApiKey"
              type="password"
              placeholder="Your KMS API key"
              value={kmsApiKey}
              onChange={(e) => setKmsApiKey(e.target.value)}
              autoComplete="new-password"
            />
            <p className="text-xs text-muted-foreground">
              The API key is hashed client-side (PBKDF2) and only the hash is
              sent to configure connectivity verification. The raw credential is
              never transmitted.
            </p>
          </div>

          <Button
            onClick={handleSaveKms}
            disabled={isSaving || !kmsUrl || !kmsApiKey}
            className="w-full"
          >
            {isSaving ? "Saving…" : "Save KMS Configuration"}
          </Button>
        </div>
      )}

      {/* Feedback */}
      {validationError && (
        <div className="rounded-md border border-destructive bg-destructive/10 p-3">
          <p className="text-sm text-destructive">{validationError}</p>
        </div>
      )}

      {saveSuccess && (
        <div className="rounded-md border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950 p-3">
          <p className="text-sm text-green-800 dark:text-green-200">
            BYOK configuration saved. New memories will be encrypted with your
            key going forward. Existing memories can be re-encrypted via the
            admin re-encryption tool.
          </p>
        </div>
      )}
    </div>
  );
}
