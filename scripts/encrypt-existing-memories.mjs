#!/usr/bin/env node
// One-shot script: encrypts all plaintext memory facts in the remote D1 database.
// Run with: node scripts/encrypt-existing-memories.mjs
// Requires: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_TOKEN env vars (or wrangler login).
// Uses the wrangler CLI to read/write so no extra packages needed.

import { execSync } from "child_process";

const DB_NAME = "locker-db";
const ENCRYPTION_KEY = "fb22a8cec34b285a4ab1787b66b7e28750204f3f9529d3ba76d2f8c9ebe3f355";

// ── AES-256-GCM (mirrors src/server/crypto.ts) ───────────────────────────────

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function isEncrypted(value) {
  const colon = value.indexOf(":");
  if (colon !== 24) return false;
  return /^[0-9a-f]+:[0-9a-f]+$/.test(value);
}

async function importKey(hexKey) {
  const keyBytes = hexToBytes(hexKey);
  return crypto.subtle.importKey("raw", keyBytes.buffer, { name: "AES-GCM" }, false, ["encrypt"]);
}

async function encrypt(plaintext, hexKey) {
  const key = await importKey(hexKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  return `${bytesToHex(iv)}:${bytesToHex(new Uint8Array(ciphertext))}`;
}

// ── Wrangler helpers ──────────────────────────────────────────────────────────

function d1Query(sql) {
  const result = execSync(
    `npx wrangler d1 execute ${DB_NAME} --remote --json --command ${JSON.stringify(sql)}`,
    { encoding: "utf8" }
  );
  return JSON.parse(result);
}

// ── Main ──────────────────────────────────────────────────────────────────────

const rows = d1Query("SELECT id, fact FROM memories");
const memories = rows[0].results;

console.log(`Found ${memories.length} memories total.`);

const plaintext = memories.filter((r) => !isEncrypted(r.fact));
console.log(`${plaintext.length} are plaintext and need encrypting.`);

if (plaintext.length === 0) {
  console.log("Nothing to do.");
  process.exit(0);
}

let done = 0;
let failed = 0;

// Process in batches to avoid hitting wrangler rate limits
const BATCH = 20;

for (let i = 0; i < plaintext.length; i += BATCH) {
  const batch = plaintext.slice(i, i + BATCH);

  await Promise.all(batch.map(async (row) => {
    try {
      const encFact = await encrypt(row.fact, ENCRYPTION_KEY);
      // Escape single quotes in the encrypted value (shouldn't occur but be safe)
      const safe = encFact.replace(/'/g, "''");
      const safeId = row.id.replace(/'/g, "''");
      d1Query(`UPDATE memories SET fact = '${safe}' WHERE id = '${safeId}'`);
      done++;
    } catch (err) {
      console.error(`Failed to encrypt row ${row.id}:`, err.message);
      failed++;
    }
  }));

  console.log(`  ${Math.min(i + BATCH, plaintext.length)}/${plaintext.length} processed…`);
}

console.log(`\nDone. Encrypted: ${done}, Failed: ${failed}`);
