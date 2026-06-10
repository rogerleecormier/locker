// API endpoint for compliance officers to verify Merkle tree proofs.
// Allows cryptographic verification that a memory existed in the vault at a specific time
// without requiring access to the vault or decryption keys.

import type { D1Database } from "@cloudflare/workers-types";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { auditSnapshots } from "~/db/schema";
import { verifyMerkleProof, verifyMemorySnapshot } from "~/server/crypto/proofs";

type CloudflareEnv = {
  DB: D1Database;
};

function getDb(env: CloudflareEnv) {
  return drizzle(env.DB, { schema: { auditSnapshots } });
}

// Request payload for proof verification
interface VerifyProofRequest {
  memoryHash: string;      // SHA-256 hex hash of memory ciphertext
  snapshotRoot: string;    // Merkle root from the snapshot
  snapshotTimestamp: number;
  memoryCount: number;     // Number of memories in the snapshot
  snapshotHash: string;    // Integrity hash from audit_snapshots record
  proofPath: Array<{
    hash: string;
    direction: "left" | "right";
  }>;
}

interface VerifyProofResponse {
  valid: boolean;
  memoryHash: string;
  snapshotRoot: string;
  snapshotTimestamp: number;
  memoryExists: boolean;  // True if Merkle proof is valid
  snapshotIntegrity: boolean;  // True if snapshot hash matches stored record
  details: string;
}

// POST /api/verify-proof
export async function POST(request: Request): Promise<Response> {
  try {
    const env = (request as any).env as CloudflareEnv;
    if (!env.DB) {
      return new Response(JSON.stringify({ error: "Database not configured" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const body = await request.json() as VerifyProofRequest;

    // Validate required fields
    if (
      !body.memoryHash ||
      !body.snapshotRoot ||
      typeof body.snapshotTimestamp !== "number" ||
      typeof body.memoryCount !== "number" ||
      !body.snapshotHash ||
      !Array.isArray(body.proofPath)
    ) {
      return new Response(
        JSON.stringify({
          error: "Missing or invalid required fields: memoryHash, snapshotRoot, snapshotTimestamp, memoryCount, snapshotHash, proofPath",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Verify the Merkle inclusion proof
    const memoryExistsInSnapshot = await verifyMerkleProof(
      body.memoryHash,
      body.proofPath,
      body.snapshotRoot
    );

    // Verify the snapshot integrity (root + timestamp + count should hash to snapshotHash)
    const snapshotVerification = await verifyMemorySnapshot(
      body.memoryHash,
      body.proofPath,
      body.snapshotRoot,
      body.snapshotTimestamp,
      body.memoryCount,
      body.snapshotHash
    );

    const response: VerifyProofResponse = {
      valid: memoryExistsInSnapshot && snapshotVerification.snapshotIntegrity,
      memoryHash: body.memoryHash,
      snapshotRoot: body.snapshotRoot,
      snapshotTimestamp: body.snapshotTimestamp,
      memoryExists: memoryExistsInSnapshot,
      snapshotIntegrity: snapshotVerification.snapshotIntegrity,
      details: memoryExistsInSnapshot && snapshotVerification.snapshotIntegrity
        ? "Memory hash successfully verified to be in snapshot at claimed time"
        : memoryExistsInSnapshot
          ? "Memory is in snapshot but snapshot integrity check failed"
          : "Memory hash does not match Merkle tree path to root",
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({
        error: "Proof verification failed",
        details: message,
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

// Optional: GET endpoint to retrieve a snapshot by root hash (for audit inquiries)
export async function GET(request: Request): Promise<Response> {
  try {
    const env = (request as any).env as CloudflareEnv;
    if (!env.DB) {
      return new Response(JSON.stringify({ error: "Database not configured" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const url = new URL(request.url);
    const snapshotRoot = url.searchParams.get("root");

    if (!snapshotRoot) {
      return new Response(
        JSON.stringify({ error: "Missing 'root' query parameter" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const db = getDb(env);
    const snapshot = await db
      .select()
      .from(auditSnapshots)
      .where(eq(auditSnapshots.merkleRoot, snapshotRoot))
      .limit(1)
      .then((rows) => rows[0] ?? null);

    if (!snapshot) {
      return new Response(JSON.stringify({ error: "Snapshot not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      id: snapshot.id,
      vaultId: snapshot.vaultId,
      merkleRoot: snapshot.merkleRoot,
      timestamp: snapshot.timestamp,
      memoryCount: snapshot.memoryCount,
      snapshotHash: snapshot.snapshotHash,
      createdAt: snapshot.createdAt,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({
        error: "Failed to retrieve snapshot",
        details: message,
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
