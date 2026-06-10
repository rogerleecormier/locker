// Tests for cryptographic Merkle tree snapshots and proofs.
// Verifies that tampering with a single memory character breaks verification,
// and that valid proofs always pass cryptographic validation.

import { describe, it, expect, beforeEach } from "vitest";
import {
  MerkleTree,
  verifyMerkleProof,
  computeSnapshotHash,
  verifyMemorySnapshot,
} from "./proofs";

async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

describe("MerkleTree", () => {
  let memoryHashes: string[];

  beforeEach(async () => {
    // Create SHA-256 hashes of sample memory ciphertexts
    memoryHashes = [
      await sha256Hex("memory_ciphertext_1"),
      await sha256Hex("memory_ciphertext_2"),
      await sha256Hex("memory_ciphertext_3"),
      await sha256Hex("memory_ciphertext_4"),
    ];
  });

  it("should compute a deterministic root for the same leaf set", async () => {
    const tree1 = new MerkleTree(memoryHashes);
    const root1 = await tree1.computeRoot();

    const tree2 = new MerkleTree([...memoryHashes]);
    const root2 = await tree2.computeRoot();

    expect(root1).toBe(root2);
  });

  it("should produce different roots for different leaf sets", async () => {
    const tree1 = new MerkleTree(memoryHashes);
    const root1 = await tree1.computeRoot();

    const modified = [...memoryHashes];
    modified[0] = await sha256Hex("different_ciphertext");
    const tree2 = new MerkleTree(modified);
    const root2 = await tree2.computeRoot();

    expect(root1).not.toBe(root2);
  });

  it("should generate valid proofs for all leaves", async () => {
    const tree = new MerkleTree(memoryHashes);
    const root = await tree.computeRoot();

    for (const leafHash of memoryHashes) {
      const proof = await tree.generateProof(leafHash);
      const valid = await verifyMerkleProof(leafHash, proof, root);
      expect(valid).toBe(true);
    }
  });

  it("should reject proofs for tampering with a single leaf", async () => {
    const tree = new MerkleTree(memoryHashes);
    const root = await tree.computeRoot();

    // Get proof for first memory
    const originalLeaf = memoryHashes[0];
    const proof = await tree.generateProof(originalLeaf);

    // Tamper: use a different memory ciphertext
    const tamperedLeaf = await sha256Hex("tampered_ciphertext");
    const valid = await verifyMerkleProof(tamperedLeaf, proof, root);

    expect(valid).toBe(false);
  });

  it("should handle single-leaf trees", async () => {
    const singleHash = memoryHashes[0];
    const tree = new MerkleTree([singleHash]);
    const root = await tree.computeRoot();

    const proof = await tree.generateProof(singleHash);
    expect(proof.length).toBe(0); // No proof path needed for single leaf

    const valid = await verifyMerkleProof(singleHash, proof, root);
    expect(valid).toBe(true);
  });

  it("should handle odd-numbered leaf counts", async () => {
    const oddHashes = memoryHashes.slice(0, 3);
    const tree = new MerkleTree(oddHashes);
    const root = await tree.computeRoot();

    for (const leafHash of oddHashes) {
      const proof = await tree.generateProof(leafHash);
      const valid = await verifyMerkleProof(leafHash, proof, root);
      expect(valid).toBe(true);
    }
  });

  it("should reject proofs with modified proof path", async () => {
    const tree = new MerkleTree(memoryHashes);
    const root = await tree.computeRoot();
    const leafHash = memoryHashes[0];
    const proof = await tree.generateProof(leafHash);

    // Tamper with a proof node hash
    if (proof.length > 0) {
      const tamperedProof = [...proof];
      tamperedProof[0] = {
        hash: await sha256Hex("tampered_proof_node"),
        direction: tamperedProof[0].direction,
      };
      const valid = await verifyMerkleProof(leafHash, tamperedProof, root);
      expect(valid).toBe(false);
    }
  });

  it("should reject proofs with swapped direction", async () => {
    const tree = new MerkleTree(memoryHashes);
    const root = await tree.computeRoot();
    const leafHash = memoryHashes[0];
    const proof = await tree.generateProof(leafHash);

    if (proof.length > 0) {
      const tamperedProof = [...proof];
      tamperedProof[0] = {
        hash: tamperedProof[0].hash,
        direction: tamperedProof[0].direction === "left" ? "right" : "left",
      };
      const valid = await verifyMerkleProof(leafHash, tamperedProof, root);
      expect(valid).toBe(false);
    }
  });

  it("should reject proofs for non-existent leaves", async () => {
    const tree = new MerkleTree(memoryHashes);
    const nonExistentLeaf = await sha256Hex("non_existent");

    await expect(() => tree.generateProof(nonExistentLeaf)).rejects.toThrow(
      "not found in tree"
    );
  });
});

describe("Snapshot Integrity", () => {
  beforeEach(async () => {
    // No setup needed for snapshot tests
  });

  it("should compute consistent snapshot hashes", async () => {
    const root = await sha256Hex("test_root");
    const timestamp = 1234567890;
    const memoryCount = 5;

    const hash1 = await computeSnapshotHash(root, timestamp, memoryCount);
    const hash2 = await computeSnapshotHash(root, timestamp, memoryCount);

    expect(hash1).toBe(hash2);
  });

  it("should produce different snapshot hashes for different roots", async () => {
    const timestamp = 1234567890;
    const memoryCount = 5;

    const root1 = await sha256Hex("root_1");
    const root2 = await sha256Hex("root_2");

    const hash1 = await computeSnapshotHash(root1, timestamp, memoryCount);
    const hash2 = await computeSnapshotHash(root2, timestamp, memoryCount);

    expect(hash1).not.toBe(hash2);
  });

  it("should produce different snapshot hashes for different timestamps", async () => {
    const root = await sha256Hex("test_root");
    const memoryCount = 5;

    const hash1 = await computeSnapshotHash(root, 1000, memoryCount);
    const hash2 = await computeSnapshotHash(root, 2000, memoryCount);

    expect(hash1).not.toBe(hash2);
  });

  it("should produce different snapshot hashes for different memory counts", async () => {
    const root = await sha256Hex("test_root");
    const timestamp = 1234567890;

    const hash1 = await computeSnapshotHash(root, timestamp, 5);
    const hash2 = await computeSnapshotHash(root, timestamp, 10);

    expect(hash1).not.toBe(hash2);
  });
});

describe("Complete Proof Verification", () => {
  it("should verify a complete memory snapshot with valid proof", async () => {
    // Create a snapshot
    const leafHashes = [
      await sha256Hex("ciphertext_1"),
      await sha256Hex("ciphertext_2"),
    ];
    const tree = new MerkleTree(leafHashes);
    const root = await tree.computeRoot();
    const timestamp = Date.now();
    const memoryCount = 2;
    const snapshotHash = await computeSnapshotHash(root, timestamp, memoryCount);

    // Generate proof for first memory
    const memoryHash = leafHashes[0];
    const proofPath = await tree.generateProof(memoryHash);

    // Verify the snapshot
    const result = await verifyMemorySnapshot(
      memoryHash,
      proofPath,
      root,
      timestamp,
      memoryCount,
      snapshotHash
    );

    expect(result.valid).toBe(true);
    expect(result.snapshotIntegrity).toBe(true);
  });

  it("should reject verification with tampered snapshot hash", async () => {
    const leafHashes = [await sha256Hex("ciphertext_1")];
    const tree = new MerkleTree(leafHashes);
    const root = await tree.computeRoot();
    const timestamp = Date.now();
    const memoryCount = 1;

    const memoryHash = leafHashes[0];
    const proofPath = await tree.generateProof(memoryHash);

    // Use wrong snapshot hash
    const wrongSnapshotHash = await sha256Hex("wrong_hash");

    const result = await verifyMemorySnapshot(
      memoryHash,
      proofPath,
      root,
      timestamp,
      memoryCount,
      wrongSnapshotHash
    );

    expect(result.valid).toBe(false);
    expect(result.snapshotIntegrity).toBe(false);
  });

  it("should reject verification with tampered memory count", async () => {
    const leafHashes = [await sha256Hex("ciphertext_1")];
    const tree = new MerkleTree(leafHashes);
    const root = await tree.computeRoot();
    const timestamp = Date.now();
    const memoryCount = 1;
    const snapshotHash = await computeSnapshotHash(root, timestamp, memoryCount);

    const memoryHash = leafHashes[0];
    const proofPath = await tree.generateProof(memoryHash);

    // Use wrong memory count
    const result = await verifyMemorySnapshot(
      memoryHash,
      proofPath,
      root,
      timestamp,
      5, // Wrong count
      snapshotHash
    );

    expect(result.valid).toBe(false);
    expect(result.snapshotIntegrity).toBe(false);
  });

  it("should reject verification with tampered timestamp", async () => {
    const leafHashes = [await sha256Hex("ciphertext_1")];
    const tree = new MerkleTree(leafHashes);
    const root = await tree.computeRoot();
    const timestamp = Date.now();
    const memoryCount = 1;
    const snapshotHash = await computeSnapshotHash(root, timestamp, memoryCount);

    const memoryHash = leafHashes[0];
    const proofPath = await tree.generateProof(memoryHash);

    // Use wrong timestamp
    const result = await verifyMemorySnapshot(
      memoryHash,
      proofPath,
      root,
      timestamp + 10000, // Wrong timestamp
      memoryCount,
      snapshotHash
    );

    expect(result.valid).toBe(false);
    expect(result.snapshotIntegrity).toBe(false);
  });
});

describe("Real-world scenarios", () => {
  it("should handle large memory vaults (100+ memories)", async () => {
    // Create 100 unique memory hashes
    const memoryHashes: string[] = [];
    for (let i = 0; i < 100; i++) {
      memoryHashes.push(await sha256Hex(`memory_ciphertext_${i}`));
    }

    const tree = new MerkleTree(memoryHashes);
    const root = await tree.computeRoot();

    // Verify random memories from the set
    for (let i = 0; i < 10; i++) {
      const randomIndex = Math.floor(Math.random() * memoryHashes.length);
      const leafHash = memoryHashes[randomIndex];
      const proof = await tree.generateProof(leafHash);
      const valid = await verifyMerkleProof(leafHash, proof, root);
      expect(valid).toBe(true);
    }
  });

  it("should detect when a single memory character is modified", async () => {
    const ciphertext1 = "abc123def456ghi789";
    const ciphertext1Modified = "abc123def456ghi78X"; // Last char changed

    const hash1 = await sha256Hex(ciphertext1);
    const hash1Modified = await sha256Hex(ciphertext1Modified);

    // Create tree with original
    const memoryHashes = [
      hash1,
      await sha256Hex("memory_2"),
      await sha256Hex("memory_3"),
    ];
    const tree = new MerkleTree(memoryHashes);
    const root = await tree.computeRoot();

    // Generate proof for first memory
    const proof = await tree.generateProof(hash1);

    // Verify original works
    expect(await verifyMerkleProof(hash1, proof, root)).toBe(true);

    // Verify tampering breaks it
    expect(await verifyMerkleProof(hash1Modified, proof, root)).toBe(false);
  });

  it("should support compliance officer audit workflow", async () => {
    // Scenario: Compliance officer receives a memory and wants to verify it existed
    // at a specific snapshot in time.

    // Create initial snapshot
    const vaultMemories = [
      await sha256Hex("sensitive_data_1"),
      await sha256Hex("sensitive_data_2"),
      await sha256Hex("sensitive_data_3"),
    ];
    const tree = new MerkleTree(vaultMemories);
    const merkleRoot = await tree.computeRoot();
    const snapshotTimestamp = Date.now();
    const memoryCount = 3;
    const snapshotHash = await computeSnapshotHash(merkleRoot, snapshotTimestamp, memoryCount);

    // Officer gets memory hash from external system
    const claimedMemoryHash = vaultMemories[1];

    // Officer generates proof
    const proofPath = await tree.generateProof(claimedMemoryHash);

    // Officer verifies
    const result = await verifyMemorySnapshot(
      claimedMemoryHash,
      proofPath,
      merkleRoot,
      snapshotTimestamp,
      memoryCount,
      snapshotHash
    );

    expect(result.valid).toBe(true);

    // Verification fails if memory was modified (even by 1 char)
    const tamperedHash = await sha256Hex("sensitive_data_2_tampered");
    const resultTampered = await verifyMemorySnapshot(
      tamperedHash,
      proofPath,
      merkleRoot,
      snapshotTimestamp,
      memoryCount,
      snapshotHash
    );

    expect(resultTampered.valid).toBe(false);
  });
});
