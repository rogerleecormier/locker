import type { SectionProps } from "../types";

export default function VerifiableProofs({ setActiveSection }: SectionProps) {
  return (
    <div>
      <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>
        Cryptographic Merkle Proofs
      </h2>
      <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
        Prove memory existence without decryption keys, vault access, or plaintext exposure. Compliance officers can
        independently verify that a specific memory existed in your vault at a specific point in time using cryptographic
        Merkle tree snapshots.
      </p>

      <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 16 }}>Overview</h3>
      <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>
        Every batch memory commit creates an immutable Merkle tree snapshot of all active memory ciphertexts. The snapshot
        root, combined with timestamp and memory count, creates a cryptographic binding that enables independent verification
        without requiring:
      </p>
      <ul style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.8, marginLeft: 20, marginBottom: 24 }}>
        <li>Vault access or permissions</li>
        <li>Decryption keys or KEK material</li>
        <li>Plaintext memory content</li>
        <li>Database queries or server involvement</li>
      </ul>
      <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
        A single character modification in any memory breaks the proof immediately. All tampering attempts—memory content,
        proof path, timestamp, memory count—are detected instantly and cryptographically.
      </p>

      <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 16 }}>How It Works</h3>
      <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 18 }}>✓</span>
          <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", margin: 0 }}>Merkle Tree Construction</h4>
        </div>
        <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 12 }}>
          Each memory's encrypted ciphertext is hashed with SHA-256. Hashes are combined pairwise, and the process repeats
          until a single root remains:
        </p>
        <code
          style={{
            display: "block",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: 12,
            fontSize: 11,
            fontFamily: "monospace",
            color: "var(--text-muted)",
            lineHeight: 1.6,
            marginBottom: 12,
            overflowX: "auto",
          }}
        >
          {`mem_1_hash = SHA256(encrypted_memory_1)
mem_2_hash = SHA256(encrypted_memory_2)
...

node_L1 = SHA256(mem_1_hash + mem_2_hash)
...

ROOT = SHA256(all_pairs_combined)`}
        </code>
        <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 0 }}>
          The root uniquely identifies the entire vault's state. Change one memory → root changes → all proofs fail.
        </p>
      </div>

      <div
        style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, marginBottom: 24 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 18 }}>🔐</span>
          <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", margin: 0 }}>Snapshot Integrity Binding</h4>
        </div>
        <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 12 }}>
          Snapshot metadata is cryptographically bound:
        </p>
        <code
          style={{
            display: "block",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: 12,
            fontSize: 11,
            fontFamily: "monospace",
            color: "var(--text-muted)",
            lineHeight: 1.6,
            marginBottom: 12,
            overflowX: "auto",
          }}
        >
          {`snapshotHash = SHA256(
  merkleRoot + "|" + timestamp + "|" + memoryCount
)`}
        </code>
        <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 0 }}>
          This binding prevents timestamp forgery, memory count inflation, and root tampering. Modify any part of the metadata
          → snapshot hash changes → proof verification fails.
        </p>
      </div>

      <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 18 }}>✔</span>
          <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", margin: 0 }}>Proof Generation & Verification</h4>
        </div>
        <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 12 }}>
          For each memory in a snapshot, a Merkle path is computed—the sibling nodes encountered on the journey from leaf to root.
        </p>
        <code
          style={{
            display: "block",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: 12,
            fontSize: 11,
            fontFamily: "monospace",
            color: "var(--text-muted)",
            lineHeight: 1.6,
            marginBottom: 12,
            overflowX: "auto",
          }}
        >
          {`VectorSearchProof {
  memoryHash: "abc123..."        // SHA256 of ciphertext
  snapshotRoot: "def456..."      // Root at query time
  snapshotTimestamp: 1609459200  // Unix ms
  proofPath: [
    { hash: "...", direction: "right" },
    { hash: "...", direction: "left" },
    ...
  ]
}`}
        </code>
        <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 0 }}>
          Verification replays the path: combine each sibling with the current hash, following the direction. If final hash
          equals the snapshot root, the proof is valid.
        </p>
      </div>

      <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 16 }}>API Endpoint</h3>
      <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>
        POST <code>/api/verify-proof</code>
      </p>
      <code
        style={{
          display: "block",
          background: "var(--surface2)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: 16,
          fontSize: 11,
          fontFamily: "monospace",
          color: "var(--text-muted)",
          lineHeight: 1.6,
          marginBottom: 16,
          overflowX: "auto",
        }}
      >
        {`curl -X POST /api/verify-proof \\
  -H "Content-Type: application/json" \\
  -d '{
    "memoryHash": "abc123...",
    "snapshotRoot": "fedcba...",
    "snapshotTimestamp": 1609459200000,
    "memoryCount": 42,
    "snapshotHash": "abcdef...",
    "proofPath": [
      { "hash": "...", "direction": "right" },
      { "hash": "...", "direction": "left" }
    ]
  }'

// Response
{
  "valid": true,
  "memoryExists": true,
  "snapshotIntegrity": true,
  "details": "Memory hash successfully verified..."
}`}
      </code>

      <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, marginBottom: 24 }}>
        <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", margin: "0 0 12px 0" }}>Response Fields</h4>
        <ul style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.8, marginLeft: 20, margin: 0 }}>
          <li>
            <strong style={{ color: "var(--text)" }}>valid:</strong> Both memoryExists and snapshotIntegrity passed
          </li>
          <li>
            <strong style={{ color: "var(--text)" }}>memoryExists:</strong> Merkle proof reconstructs the root correctly
          </li>
          <li>
            <strong style={{ color: "var(--text)" }}>snapshotIntegrity:</strong> Computed snapshot hash matches the provided one
          </li>
        </ul>
      </div>

      <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 16 }}>Tampering Detection</h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12, marginBottom: 24 }}>
        {[
          {
            attack: "Memory Modification",
            detail: "Even 1 character change produces a different hash. Proof fails immediately.",
          },
          {
            attack: "Proof Path Tampering",
            detail: "Modifying any sibling hash results in a mismatched root.",
          },
          {
            attack: "Direction Swapping",
            detail: 'Changing "left" to "right" produces the wrong root (order matters).',
          },
          {
            attack: "Timestamp Forgery",
            detail: "Changing the timestamp changes the snapshot hash. Verification fails.",
          },
          {
            attack: "Memory Count Inflation",
            detail: "Changing the count changes the snapshot hash. Verification fails.",
          },
        ].map(({ attack, detail }) => (
          <div key={attack} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--accent)", marginBottom: 4 }}>{attack}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>{detail}</div>
          </div>
        ))}
      </div>

      <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 16 }}>Use Cases</h3>
      <div
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 32 }}
      >
        {[
          {
            icon: "✓",
            title: "SOC2 Compliance Audits",
            body: "Prove that your security standards (encryption, access controls, audit logs) existed in the vault at audit time.",
          },
          {
            icon: "📋",
            title: "GDPR Data Retention",
            body: "Demonstrate that customer data was retained past a specified deadline by proving memory existence at that timestamp.",
          },
          {
            icon: "🔍",
            title: "Breach Investigation",
            body: "Cryptographically prove whether alleged sensitive data existed in your vault at the time of a reported breach.",
          },
          {
            icon: "🔄",
            title: "Change Control Verification",
            body: "Prove that a specific config, rule, or standard remained unchanged between two snapshots.",
          },
          {
            icon: "🗑️",
            title: "Data Deletion Certification",
            body: "Prove deletion by showing a memory in the last snapshot before deletion, absent from the first snapshot after.",
          },
          {
            icon: "🚨",
            title: "Incident Response",
            body: "Build a timestamped audit trail of what was in the vault, when, and prove no tampering occurred.",
          },
        ].map(({ icon, title, body }) => (
          <div key={title} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 18, marginBottom: 8 }}>{icon}</div>
            <h4 style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", margin: "0 0 8px 0" }}>{title}</h4>
            <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6, margin: 0 }}>{body}</p>
          </div>
        ))}
      </div>

      <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 16 }}>Compliance Officer Workflow</h3>
      <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, marginBottom: 24 }}>
        <ol style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.8, margin: 0, paddingLeft: 20 }}>
          <li style={{ marginBottom: 12 }}>
            <strong style={{ color: "var(--text)" }}>Receive evidence:</strong> Get memory hash, snapshot root, and proof path
            from the system (or external audit report)
          </li>
          <li style={{ marginBottom: 12 }}>
            <strong style={{ color: "var(--text)" }}>Submit proof:</strong> POST to <code>/api/verify-proof</code> with the proof
            data
          </li>
          <li style={{ marginBottom: 12 }}>
            <strong style={{ color: "var(--text)" }}>Verify response:</strong> Check that <code>valid: true</code> and{" "}
            <code>memoryExists: true</code>
          </li>
          <li style={{ marginBottom: 12 }}>
            <strong style={{ color: "var(--text)" }}>Audit trail:</strong> Snapshot hash binding prevents all metadata tampering
          </li>
          <li>
            <strong style={{ color: "var(--text)" }}>Non-repudiation:</strong> Proofs are cryptographically self-contained — no one
            can deny the data existed
          </li>
        </ol>
      </div>

      <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 16 }}>Performance</h3>
      <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, marginBottom: 24 }}>
        <ul style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.8, margin: 0, paddingLeft: 20 }}>
          <li style={{ marginBottom: 12 }}>
            <strong style={{ color: "var(--text)" }}>Create snapshot (n memories):</strong> O(n log n) — &lt;100ms for 10k memories
          </li>
          <li style={{ marginBottom: 12 }}>
            <strong style={{ color: "var(--text)" }}>Generate proof for 1 memory:</strong> O(log n) — &lt;5ms for 1M memories
          </li>
          <li style={{ marginBottom: 12 }}>
            <strong style={{ color: "var(--text)" }}>Verify proof:</strong> O(log n) — &lt;1ms (independent of vault size)
          </li>
          <li>
            <strong style={{ color: "var(--text)" }}>Proof size:</strong> ~650 bytes for 1M-memory vault
          </li>
        </ul>
      </div>

      <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
        <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", margin: "0 0 12px 0" }}>Technical Details</h4>
        <ul style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.8, margin: 0, paddingLeft: 20 }}>
          <li style={{ marginBottom: 6 }}>
            <strong style={{ color: "var(--text)" }}>Implementation:</strong> Pure TypeScript using Web Crypto API
          </li>
          <li style={{ marginBottom: 6 }}>
            <strong style={{ color: "var(--text)" }}>Hash algorithm:</strong> SHA-256 (FIPS PUB 180-4)
          </li>
          <li style={{ marginBottom: 6 }}>
            <strong style={{ color: "var(--text)" }}>No external dependencies:</strong> Stays under Cloudflare 1MB worker limit
          </li>
          <li>
            <strong style={{ color: "var(--text)" }}>Database:</strong> Snapshots in <code>audit_snapshots</code> with indexes on
            (vaultId, timestamp) and (merkleRoot)
          </li>
        </ul>
      </div>
    </div>
  );
}
