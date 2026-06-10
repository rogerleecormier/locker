// Verifiable vector search service using cryptographic Merkle tree snapshots.
// Provides proof objects that allow compliance officers to verify that memories
// were in the vault at a specific point in time without exposing plaintext.

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

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", data.buffer as ArrayBuffer);
  return new Uint8Array(hashBuffer);
}

async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const hash = await sha256(encoded);
  return bytesToHex(hash);
}

// Single node in a Merkle tree path for inclusion proof.
export interface MerkleProofNode {
  hash: string;    // 64-char hex SHA-256 hash
  direction: "left" | "right";  // where this node sits relative to the proof path
}

// Complete proof object returned with search results.
export interface VectorSearchProof {
  memoryHash: string;            // SHA-256 hash of the retrieved memory ciphertext
  snapshotRoot: string;          // Root hash of the snapshot at query time
  snapshotTimestamp: number;     // Unix ms timestamp when snapshot was created
  proofPath: MerkleProofNode[];  // Merkle tree path from leaf to root
}

export class MerkleTree {
  private leaves: string[];      // Array of hashes to include in tree

  constructor(leafHashes: string[]) {
    // Ensure we have at least one leaf (no empty trees)
    this.leaves = leafHashes.length > 0 ? leafHashes : [""];
  }

  // Compute the root hash by recursively hashing pairs of nodes.
  async computeRoot(): Promise<string> {
    if (this.leaves.length === 1) {
      return this.leaves[0];
    }

    let currentLevel = [...this.leaves];
    while (currentLevel.length > 1) {
      const nextLevel: string[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right = currentLevel[i + 1] ?? left;
        const combined = left + right;
        const hash = await sha256Hex(combined);
        nextLevel.push(hash);
      }
      currentLevel = nextLevel;
    }
    return currentLevel[0];
  }

  // Generate a Merkle inclusion proof for a given leaf hash.
  // Returns the path from that leaf to the root.
  async generateProof(leafHash: string): Promise<MerkleProofNode[]> {
    const leafIndex = this.leaves.indexOf(leafHash);
    if (leafIndex === -1) {
      throw new Error(`Leaf hash ${leafHash} not found in tree`);
    }

    const proof: MerkleProofNode[] = [];
    let currentLevel = [...this.leaves];
    let currentIndex = leafIndex;

    while (currentLevel.length > 1) {
      const isEven = currentIndex % 2 === 0;
      const siblingIndex = isEven ? currentIndex + 1 : currentIndex - 1;
      const siblingHash = currentLevel[siblingIndex] ?? currentLevel[currentIndex];

      // Direction is where the sibling sits relative to the current hash
      const direction = isEven ? "right" : "left";
      proof.push({
        hash: siblingHash,
        direction: direction,
      });

      // Move up to the next level
      const nextLevel: string[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right = currentLevel[i + 1] ?? left;
        const combined = left + right;
        const hash = await sha256Hex(combined);
        nextLevel.push(hash);
      }

      currentIndex = Math.floor(currentIndex / 2);
      currentLevel = nextLevel;
    }

    return proof;
  }
}

// Verify a Merkle inclusion proof given a leaf hash, proof path, and expected root.
export async function verifyMerkleProof(
  leafHash: string,
  proofPath: MerkleProofNode[],
  expectedRoot: string
): Promise<boolean> {
  let currentHash = leafHash;

  for (const node of proofPath) {
    const left = node.direction === "left" ? node.hash : currentHash;
    const right = node.direction === "right" ? node.hash : currentHash;
    const combined = left + right;
    currentHash = await sha256Hex(combined);
  }

  return currentHash === expectedRoot;
}

// Snapshot record stored in D1 for audit compliance.
export interface AuditSnapshot {
  id: string;                    // UUID
  vaultId: string;               // userId or "org:xxx" / "team:xxx"
  merkleRoot: string;            // 64-char hex SHA-256 root
  timestamp: number;             // Unix ms when snapshot was created
  memoryCount: number;           // Number of memories in this snapshot
  snapshotHash: string;          // Hash of (merkleRoot + timestamp + memoryCount) for integrity
}

// Generate a snapshot hash to bind the root, timestamp, and count.
export async function computeSnapshotHash(
  merkleRoot: string,
  timestamp: number,
  memoryCount: number
): Promise<string> {
  const data = `${merkleRoot}|${timestamp}|${memoryCount}`;
  return sha256Hex(data);
}

// Given a set of memory IDs and their corresponding ciphertext hashes,
// build a Merkle tree and return the root. Used during batch memory commits.
export async function buildMemorySnapshot(
  memoryCiphertextHashes: string[]
): Promise<{ root: string; tree: MerkleTree }> {
  const tree = new MerkleTree(memoryCiphertextHashes);
  const root = await tree.computeRoot();
  return { root, tree };
}

// Verify a complete memory snapshot against stored audit metadata.
export async function verifyMemorySnapshot(
  memoryHash: string,
  proofPath: MerkleProofNode[],
  snapshotRoot: string,
  snapshotTimestamp: number,
  snapshotMemoryCount: number,
  expectedSnapshotHash: string
): Promise<{ valid: boolean; snapshotIntegrity: boolean }> {
  const merkleValid = await verifyMerkleProof(memoryHash, proofPath, snapshotRoot);
  const computedSnapshotHash = await computeSnapshotHash(snapshotRoot, snapshotTimestamp, snapshotMemoryCount);
  const snapshotIntegrity = computedSnapshotHash === expectedSnapshotHash;

  return {
    valid: merkleValid && snapshotIntegrity,
    snapshotIntegrity,
  };
}
