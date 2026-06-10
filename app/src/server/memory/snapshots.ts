// Snapshot generation and proof integration for verifiable memory search.
// This module handles creating Merkle tree snapshots of memory vaults and
// attaching inclusion proofs to search results.

import type { D1Database } from "@cloudflare/workers-types";
import { drizzle } from "drizzle-orm/d1";
import { desc, eq } from "drizzle-orm";
import { auditSnapshots, memories } from "~/db/schema";
import { sha256Hex } from "~/server/crypto";
import {
  MerkleTree,
  VectorSearchProof,
  computeSnapshotHash,
  type MerkleProofNode,
} from "~/server/crypto/proofs";

function getDb(env: any) {
  return drizzle(env.DB, { schema: { auditSnapshots, memories } });
}

async function hashMemoryCiphertext(ciphertext: string): Promise<string> {
  return sha256Hex(ciphertext);
}

// Generate a new Merkle snapshot for a vault's active memories.
// Called during batch memory commits to create an immutable checkpoint.
// vaultId is either a userId (personal vault) or "org:xxx" / "team:xxx" (org vault).
export async function createVaultSnapshot(
  db: D1Database,
  vaultId: string
): Promise<{ snapshotId: string; merkleRoot: string }> {
  // Fetch all active memories in this vault (unencrypted ciphertext).
  // Note: In production, the `fact` column is stored encrypted; we hash the ciphertext directly.
  const isOrgVault = vaultId.startsWith("org:") || vaultId.startsWith("team:");

  let activeMemories: { id: string; fact: string }[];
  if (isOrgVault) {
    const orgId = isOrgVault && vaultId.startsWith("org:") ? vaultId.slice(4) : vaultId;
    const query = `SELECT id, fact FROM memories
                   WHERE orgId = ? AND isActive = 1
                   ORDER BY id ASC`;
    const result = await db.prepare(query).bind(orgId).all<{ id: string; fact: string }>();
    activeMemories = result.results ?? [];
  } else {
    const query = `SELECT id, fact FROM memories
                   WHERE userId = ? AND orgId IS NULL AND isActive = 1
                   ORDER BY id ASC`;
    const result = await db.prepare(query).bind(vaultId).all<{ id: string; fact: string }>();
    activeMemories = result.results ?? [];
  }

  // Hash each memory's ciphertext to get leaf hashes for the tree.
  const leafHashes: string[] = [];
  for (const mem of activeMemories) {
    const leafHash = await hashMemoryCiphertext(mem.fact);
    leafHashes.push(leafHash);
  }

  // Build Merkle tree and compute root.
  const tree = new MerkleTree(leafHashes);
  const merkleRoot = await tree.computeRoot();

  // Create snapshot metadata.
  const timestamp = Date.now();
  const memoryCount = activeMemories.length;
  const snapshotHash = await computeSnapshotHash(merkleRoot, timestamp, memoryCount);

  // Insert snapshot into audit_snapshots table.
  const snapshotId = `snapshot_${crypto.randomUUID()}`;
  await db
    .prepare(
      `INSERT INTO audit_snapshots
       (id, vaultId, merkleRoot, timestamp, memoryCount, snapshotHash, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(snapshotId, vaultId, merkleRoot, timestamp, memoryCount, snapshotHash, Date.now())
    .run();

  return { snapshotId, merkleRoot };
}

// Fetch the latest snapshot for a vault.
export async function getLatestSnapshot(
  db: D1Database,
  vaultId: string
): Promise<
  | {
      id: string;
      merkleRoot: string;
      timestamp: number;
      memoryCount: number;
      snapshotHash: string;
    }
  | null
> {
  const row = await db
    .prepare(
      `SELECT id, merkleRoot, timestamp, memoryCount, snapshotHash
       FROM audit_snapshots
       WHERE vaultId = ?
       ORDER BY timestamp DESC
       LIMIT 1`
    )
    .bind(vaultId)
    .first<{
      id: string;
      merkleRoot: string;
      timestamp: number;
      memoryCount: number;
      snapshotHash: string;
    }>();

  return row ?? null;
}

// Generate a proof for a memory given the latest snapshot.
// Called after retrieving a memory from vector search.
export async function generateMemoryProof(
  db: D1Database,
  vaultId: string,
  memoryId: string
): Promise<VectorSearchProof | null> {
  // Fetch the memory's ciphertext.
  const memory = await db
    .prepare(`SELECT fact FROM memories WHERE id = ? LIMIT 1`)
    .bind(memoryId)
    .first<{ fact: string }>();

  if (!memory) return null;

  // Hash the ciphertext to get the leaf hash.
  const memoryHash = await hashMemoryCiphertext(memory.fact);

  // Get the latest snapshot for this vault.
  const snapshot = await getLatestSnapshot(db, vaultId);
  if (!snapshot) return null;

  // Rebuild the tree to get the leaf list.
  // Note: In a production system, you'd cache the tree structure or store
  // leaf indices at snapshot time to avoid this rebuild.
  const isOrgVault = vaultId.startsWith("org:") || vaultId.startsWith("team:");
  let activeMemories: { id: string; fact: string }[];
  if (isOrgVault) {
    const orgId = vaultId.startsWith("org:") ? vaultId.slice(4) : vaultId;
    const result = await db
      .prepare(
        `SELECT id, fact FROM memories
         WHERE orgId = ? AND isActive = 1
         ORDER BY id ASC`
      )
      .bind(orgId)
      .all<{ id: string; fact: string }>();
    activeMemories = result.results ?? [];
  } else {
    const result = await db
      .prepare(
        `SELECT id, fact FROM memories
         WHERE userId = ? AND orgId IS NULL AND isActive = 1
         ORDER BY id ASC`
      )
      .bind(vaultId)
      .all<{ id: string; fact: string }>();
    activeMemories = result.results ?? [];
  }

  const leafHashes: string[] = [];
  let leafIndex = -1;

  for (let i = 0; i < activeMemories.length; i++) {
    const hash = await hashMemoryCiphertext(activeMemories[i].fact);
    leafHashes.push(hash);
    if (activeMemories[i].id === memoryId) {
      leafIndex = i;
    }
  }

  if (leafIndex === -1) return null;

  // Rebuild the tree and generate the proof path.
  const tree = new MerkleTree(leafHashes);
  const proofPath = await tree.generateProof(memoryHash);

  return {
    memoryHash,
    snapshotRoot: snapshot.merkleRoot,
    snapshotTimestamp: snapshot.timestamp,
    proofPath,
  };
}

// Get memory details for compliance verification.
// This is called by the verify-proof endpoint.
export async function getMemoryHashMetadata(
  db: D1Database,
  vaultId: string,
  memoryHash: string
): Promise<
  | {
      memoryId: string;
      vaultId: string;
      timestamp: number;
    }
  | null
> {
  // Scan through active memories to find one matching the hash.
  // In a production system, you'd maintain a hash index for faster lookup.
  const isOrgVault = vaultId.startsWith("org:") || vaultId.startsWith("team:");
  let memories: { id: string; timestamp: number }[];
  if (isOrgVault) {
    const orgId = vaultId.startsWith("org:") ? vaultId.slice(4) : vaultId;
    const result = await db
      .prepare(
        `SELECT id, timestamp FROM memories
         WHERE orgId = ? AND isActive = 1`
      )
      .bind(orgId)
      .all<{ id: string; timestamp: number }>();
    memories = result.results ?? [];
  } else {
    const result = await db
      .prepare(
        `SELECT id, timestamp FROM memories
         WHERE userId = ? AND orgId IS NULL AND isActive = 1`
      )
      .bind(vaultId)
      .all<{ id: string; timestamp: number }>();
    memories = result.results ?? [];
  }

  for (const mem of memories) {
    const hash = await hashMemoryCiphertext(mem.id);
    if (hash === memoryHash) {
      return {
        memoryId: mem.id,
        vaultId,
        timestamp: mem.timestamp,
      };
    }
  }

  return null;
}
