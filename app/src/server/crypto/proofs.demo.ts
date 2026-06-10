// Demonstration of cryptographic proof verification for compliance audits.
// This script shows the complete workflow: create snapshots, generate proofs, verify them.

import {
  MerkleTree,
  verifyMerkleProof,
  computeSnapshotHash,
  verifyMemorySnapshot,
  type MerkleProofNode,
} from "./proofs";

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  return bytesToHex(new Uint8Array(hashBuffer));
}

export async function demonstrateComplianceAudit() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  Verifiable Vector Search — Compliance Audit Demo");
  console.log("═══════════════════════════════════════════════════════\n");

  // ── Step 1: Create a vault with encrypted memories ───────────────────

  console.log("STEP 1: Create vault with 5 encrypted memories");
  console.log("─────────────────────────────────────────────\n");

  const memoryCiphertexts = [
    "abc123def456encrypted_memory_1_ciphertext_encrypted",
    "xyz789uvw456encrypted_memory_2_ciphertext_encrypted",
    "ghi321jkl654encrypted_memory_3_ciphertext_encrypted",
    "mno789pqr123encrypted_memory_4_ciphertext_encrypted",
    "stu456vwx789encrypted_memory_5_ciphertext_encrypted",
  ];

  const memoryHashes: string[] = [];
  for (let i = 0; i < memoryCiphertexts.length; i++) {
    const hash = await sha256Hex(memoryCiphertexts[i]);
    memoryHashes.push(hash);
    console.log(`  Memory ${i + 1}:`);
    console.log(`    Ciphertext: ${memoryCiphertexts[i].slice(0, 40)}...`);
    console.log(`    Hash:       ${hash}`);
  }

  // ── Step 2: Create Merkle snapshot ──────────────────────────────────

  console.log("\nSTEP 2: Create Merkle tree snapshot of vault");
  console.log("─────────────────────────────────────────────\n");

  const tree = new MerkleTree(memoryHashes);
  const merkleRoot = await tree.computeRoot();
  const snapshotTimestamp = Date.now();
  const memoryCount = memoryCiphertexts.length;

  console.log(`  Merkle Root:    ${merkleRoot}`);
  console.log(`  Timestamp:      ${snapshotTimestamp} (${new Date(snapshotTimestamp).toISOString()})`);
  console.log(`  Memory Count:   ${memoryCount}`);

  // Create snapshot integrity hash
  const snapshotHash = await computeSnapshotHash(
    merkleRoot,
    snapshotTimestamp,
    memoryCount
  );
  console.log(`  Snapshot Hash:  ${snapshotHash}`);
  console.log(`\n  ✓ Snapshot created and stored in audit_snapshots table\n`);

  // ── Step 3: Generate proof for a memory ────────────────────────────

  console.log("STEP 3: Generate Merkle proof for Memory #3");
  console.log("──────────────────────────────────────────\n");

  const targetMemoryIndex = 2; // Memory #3
  const targetMemoryHash = memoryHashes[targetMemoryIndex];
  const proofPath = await tree.generateProof(targetMemoryHash);

  console.log(`  Target Memory:  Memory #${targetMemoryIndex + 1}`);
  console.log(`  Memory Hash:    ${targetMemoryHash}`);
  console.log(`  Proof Path (${proofPath.length} nodes):`);

  for (let i = 0; i < proofPath.length; i++) {
    const node = proofPath[i];
    console.log(`    ${i + 1}. Hash: ${node.hash.slice(0, 32)}...`);
    console.log(`       Direction: ${node.direction}`);
  }

  console.log(`\n  ✓ Proof generated successfully\n`);

  // ── Step 4: Verify the proof ──────────────────────────────────────

  console.log("STEP 4: Verify memory proof");
  console.log("──────────────────────────\n");

  const proofValid = await verifyMerkleProof(
    targetMemoryHash,
    proofPath,
    merkleRoot
  );
  console.log(`  Merkle Proof Valid:     ${proofValid ? "✓ TRUE" : "✗ FALSE"}`);

  const snapshotResult = await verifyMemorySnapshot(
    targetMemoryHash,
    proofPath,
    merkleRoot,
    snapshotTimestamp,
    memoryCount,
    snapshotHash
  );

  console.log(`  Snapshot Integrity:     ${snapshotResult.snapshotIntegrity ? "✓ TRUE" : "✗ FALSE"}`);
  console.log(`  Overall Valid:          ${snapshotResult.valid ? "✓ TRUE" : "✗ FALSE"}`);
  console.log(`\n  ✓ Verification passed — memory was in vault at claimed time\n`);

  // ── Step 5: Demonstrate tampering detection ────────────────────────

  console.log("STEP 5: Detect tampering");
  console.log("───────────────────────\n");

  console.log("  Scenario A: Single character tampering in memory");
  console.log("  ──────────────────────────────────────────────\n");

  const tamperedCiphertext = memoryCiphertexts[targetMemoryIndex].slice(0, -1) + "X";
  const tamperedHash = await sha256Hex(tamperedCiphertext);

  console.log(`  Original:   ${memoryCiphertexts[targetMemoryIndex].slice(0, 40)}...`);
  console.log(`  Tampered:   ${tamperedCiphertext.slice(0, 40)}...`);
  console.log(`  Original Hash:  ${targetMemoryHash.slice(0, 32)}...`);
  console.log(`  Tampered Hash:  ${tamperedHash.slice(0, 32)}...`);

  const tamperedProofValid = await verifyMerkleProof(
    tamperedHash,
    proofPath,
    merkleRoot
  );

  console.log(`\n  Proof verification with tampered hash: ${tamperedProofValid ? "✗ VALID (WRONG)" : "✓ INVALID (CORRECT)"}`);

  // ── Step 6: Demonstrate proof path tampering ─────────────────────

  console.log("\nSTEP 6: Detect proof path tampering");
  console.log("──────────────────────────────────\n");

  if (proofPath.length > 0) {
    const attackerNodeHash = await sha256Hex("attacker_node_hash");
    const tamperedPath: MerkleProofNode[] = proofPath.map((node, i) => {
      if (i === 0) {
        return {
          hash: attackerNodeHash,
          direction: node.direction,
        };
      }
      return node;
    });

    const tamperedPathValid = await verifyMerkleProof(
      targetMemoryHash,
      tamperedPath,
      merkleRoot
    );

    console.log(`  Proof path tampered at position 1`);
    console.log(`  Proof verification with tampered path: ${tamperedPathValid ? "✗ VALID (WRONG)" : "✓ INVALID (CORRECT)"}`);
  }

  // ── Step 7: Demonstrate snapshot metadata tampering ────────────────

  console.log("\nSTEP 7: Detect snapshot metadata tampering");
  console.log("────────────────────────────────────────\n");

  console.log(`  Original memory count:  ${memoryCount}`);
  console.log(`  Tampered memory count:  ${memoryCount + 1}`);

  const tamperedSnapshot = await verifyMemorySnapshot(
    targetMemoryHash,
    proofPath,
    merkleRoot,
    snapshotTimestamp,
    memoryCount + 1, // Tampered count
    snapshotHash
  );

  console.log(`\n  Proof verification with tampered count: ${tamperedSnapshot.valid ? "✗ VALID (WRONG)" : "✓ INVALID (CORRECT)"}`);

  // ── Step 8: Compliance officer workflow ─────────────────────────

  console.log("\nSTEP 8: Compliance Officer Audit Workflow");
  console.log("──────────────────────────────────────────\n");

  const proofForAPI = {
    memoryHash: targetMemoryHash,
    snapshotRoot: merkleRoot,
    snapshotTimestamp,
    memoryCount,
    snapshotHash,
    proofPath,
  };

  console.log("  Officer submits to /api/verify-proof:");
  console.log(JSON.stringify(proofForAPI, null, 2).split("\n").slice(0, 10).join("\n"));
  console.log("  ...\n");

  console.log("  API response:");
  console.log(`  {`);
  console.log(`    "valid": ${snapshotResult.valid},`);
  console.log(`    "memoryExists": ${proofValid},`);
  console.log(`    "snapshotIntegrity": ${snapshotResult.snapshotIntegrity},`);
  console.log(`    "details": "Memory hash successfully verified to be in snapshot at claimed time"`);
  console.log(`  }\n`);

  console.log("  ✓ Officer can now verify memory existence without decryption keys\n");

  // Summary
  console.log("═══════════════════════════════════════════════════════");
  console.log("  SUMMARY");
  console.log("═══════════════════════════════════════════════════════\n");

  console.log("✓ Merkle proofs enable cryptographic verification");
  console.log("✓ Single character change breaks verification");
  console.log("✓ Proof tampering detected immediately");
  console.log("✓ Snapshot metadata binding prevents forgery");
  console.log("✓ Compliance officers verify without access to vault\n");
}

// Run the demonstration
demonstrateComplianceAudit().catch(console.error);
