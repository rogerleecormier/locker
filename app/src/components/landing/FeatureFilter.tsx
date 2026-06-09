import { useState, useMemo } from "react";
import { FadeIn } from "./LandingAnimations";
import { FeatureCard } from "./LandingPrimitives";
import { LockerPadlock } from "~/components/LockerLogo";

// Icon components
function IconSearch() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
}
function IconTool() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>;
}
function IconTemplate() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M12 5v14M5 12l7 7 7-7"/></svg>;
}
function IconOrg() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>;
}
function IconTeam() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
}
function IconShield() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>;
}
function IconLink() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>;
}
function IconActivity() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M3 12h.01M7.05 7.05l.007.007M12 3v.01M16.95 7.05l.007.007M21 12h.01M16.95 16.95l.007.007M12 21v-.01M7.05 16.95l-.007.007"/></svg>;
}
function IconGraph() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="12" cy="19" r="2"/><line x1="7" y1="5" x2="17" y2="5"/><line x1="6" y1="7" x2="11" y2="17"/><line x1="18" y1="7" x2="13" y2="17"/></svg>;
}
function IconDevOps() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 17.5h3m3 0h-3m0 0v-3m0 3v3"/></svg>;
}
function IconCompliance() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>;
}
function IconVersion() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>;
}
function IconConflict() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>;
}
function IconCode() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>;
}
function IconCheck() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>;
}
function IconCpu() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="15" x2="23" y2="15"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="15" x2="4" y2="15"/></svg>;
}
function IconLock() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>;
}
function IconLogIn() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>;
}
function IconTrendingUp() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 17"/><polyline points="17 6 23 6 23 12"/></svg>;
}

type Category = "all" | "security" | "developer" | "governance" | "integration";

interface Feature {
  icon: React.ReactNode;
  title: string;
  desc: string;
  category: Category;
  delay: number;
}

const FEATURES: Feature[] = [
  {
    icon: <LockerPadlock size={20} />,
    title: "Envelope Encryption",
    desc: "AES-256-GCM with per-vault DEKs wrapped by a KEK. Database + env var must both be compromised to decrypt anything. Unwrapped keys live only in ephemeral V8 worker memory.",
    category: "security",
    delay: 0,
  },
  {
    icon: <IconSearch />,
    title: "GraphRAG Hybrid Retrieval",
    desc: "bge-m3 semantic vectors, FTS5 keyword, and recency decay fused via RRF. GraphRAG entity expansion surfaces related facts automatically. Llama-3.3-70B cross-encoder reranking on top-20 candidates.",
    category: "developer",
    delay: 60,
  },
  {
    icon: <IconTool />,
    title: "Tech Stack Wizard & CLI Sync",
    desc: "Generate .cursorrules, CLAUDE.md, AGENTS.md, and 4 more formats from your stack. Push rules to disk with npx locker-sync sync or wire into pre-commit hooks for automatic drift prevention.",
    category: "developer",
    delay: 120,
  },
  {
    icon: <IconTemplate />,
    title: "Memory Templates",
    desc: "Deploy pre-built coding guidelines, DevOps runbooks, and SOC2 compliance controls directly to developer agents. One-click ingestion to any scope.",
    category: "developer",
    delay: 180,
  },
  {
    icon: <IconOrg />,
    title: "Review & Approval Queue",
    desc: "Agent mutations are held in the approval queue — color-coded cards for deletions (red), updates (blue), and contradictions (amber). No silent destructive changes, ever.",
    category: "governance",
    delay: 240,
  },
  {
    icon: <IconTeam />,
    title: "Authoritative Org Vault",
    desc: "Lock critical standards inside organization scopes. Authoritative rules always take precedence in agent contexts. Team nesting for fine-grained vault isolation.",
    category: "governance",
    delay: 300,
  },
  {
    icon: <IconShield />,
    title: "ABAC Agent Tokens",
    desc: "Attribute-Based Access Control per token: category filters, tag allowlist/denylist, credential vault gate. Enforced at SQL + Vectorize — encrypted data for off-limits categories is never decrypted.",
    category: "security",
    delay: 360,
  },
  {
    icon: <IconShield />,
    title: "Entropy-Based DLP",
    desc: "Shannon entropy gating detects high-entropy secrets. Structural patterns catch AWS keys, Stripe keys, GitHub PATs, PEM keys, DB URIs. PII regex for emails, SSNs, credit cards. Quarantined = [REDACTED] to agents.",
    category: "security",
    delay: 420,
  },
  {
    icon: <IconGraph />,
    title: "Knowledge Graph Visualization",
    desc: "Interactive canvas maps every entity — services, files, libraries, APIs — and their relationships extracted by Workers AI. Explore multi-hop connections across your vault visually.",
    category: "developer",
    delay: 480,
  },
  {
    icon: <IconLink />,
    title: "GitHub Webhook Integration",
    desc: "PR Merged events auto-pipe diffs through Workers AI, summarize, and commit an encrypted technical memory. HMAC-signature verified. Supports branch filtering, PR template injection, and automatic context sync to .cursorrules and CLAUDE.md on merge.",
    category: "integration",
    delay: 540,
  },
  {
    icon: <IconLink />,
    title: "Linear Ticket Integration",
    desc: "Ticket Done events auto-commit learnings, post-mortems, and decision rationale to your vault. Parse custom fields, link related docs, and trigger team notifications on completion. Bidirectional sync with vault tags and categories.",
    category: "integration",
    delay: 545,
  },
  {
    icon: <IconActivity />,
    title: "Slack Integration Hub",
    desc: "Mutation notifications post color-coded cards (red deletions, blue edits, amber contradictions). JIT access requests send approval buttons. Review queue links allow one-click vault sync without leaving Slack. Real-time audit logging on all approvals.",
    category: "integration",
    delay: 550,
  },
  {
    icon: <IconDevOps />,
    title: "CI/CD PR Policy Gatekeeper",
    desc: "Block PRs that violate vault rules before merge. POST a package.json diff to /api/cicd/gatekeeper — Locker reads your #banned_dependencies, #rules, and #architecture vault memories, runs Workers AI evaluation, and returns a structured pass/fail verdict. Drop-in GitHub Actions template included.",
    category: "governance",
    delay: 570,
  },
  {
    icon: <IconActivity />,
    title: "Agent Activity Dashboard",
    desc: "Timeline of every memory operation by AI client. See which tool (Cursor, Claude Code, Windsurf…) recalled which memories, their similarity scores, and the exact facts injected into context — hallucinations debuggable in seconds.",
    category: "governance",
    delay: 600,
  },
  {
    icon: <IconConflict />,
    title: "Conflict Resolution Hub",
    desc: "When agents detect contradicting facts (e.g. 'Use Node 18' vs 'Use Node 20'), a navigation badge alerts you. Side-by-side diff view lets you pick the authoritative version and close the recommendation in one click.",
    category: "governance",
    delay: 660,
  },
  {
    icon: <IconVersion />,
    title: "Memory Versioning & Rollback",
    desc: "Every create, update, and delete is versioned with a full audit trail — actor, timestamp, change reason. Roll back any fact to a previous version. Configurable retention per org.",
    category: "governance",
    delay: 720,
  },
  {
    icon: <LockerPadlock size={20} />,
    title: "JIT Confidential Access",
    desc: "Memories tagged #confidential are always redacted for agents. Access triggers a Slack notification with an HMAC-signed approval URL. Approval mints a 15-minute scoped JIT token. Audit-logged.",
    category: "security",
    delay: 780,
  },
  {
    icon: <IconActivity />,
    title: "Stale Memory Tracking",
    desc: "lastAccessedAt updated on every recall. The Stale sort filter and dashboard banner surface memories that haven't been accessed — clean up aging context before it misleads your agents.",
    category: "governance",
    delay: 840,
  },
  {
    icon: <IconCheck />,
    title: "Mutation Queue Enforcement",
    desc: "Agent mutations (commit, update, delete) are automatically held for human review when triggered by agent tokens. Color-coded approval cards prevent destructive changes without sign-off. Supports both pending mutations and JIT access requests with 30-minute HMAC-signed approval URLs.",
    category: "governance",
    delay: 900,
  },
  {
    icon: <IconSearch />,
    title: "Intelligent Memory Consolidation",
    desc: "Retrieved memories are automatically de-duplicated and synthesized using Llama-3.1-8B into a single dense context string. Merges conflicting facts, removes redundancy, preserves authority markers. Reduces token consumption 30-50% for downstream agents.",
    category: "developer",
    delay: 960,
  },
  {
    icon: <IconLogIn />,
    title: "Session Management & Multi-Device Tracking",
    desc: "Track active browser/API sessions per user with IP address logging and timestamps. Revoke specific sessions via Settings UI. Enables security audits of when and where tokens were used. Critical for preventing session hijacking.",
    category: "security",
    delay: 1020,
  },
  {
    icon: <IconCpu />,
    title: "Multi-Tier AI Model Prioritization",
    desc: "Enterprise plan gets priority queue access for Workers AI embeddings (bge-m3) and cross-encoder reranking. Avoids rate-limiting on high-volume recall_context calls. Improves latency and consistency for enterprise workloads.",
    category: "developer",
    delay: 1080,
  },
  {
    icon: <IconLink />,
    title: "Slack Thread Summarization & Auto-Ingestion",
    desc: "Monitor Slack emoji reactions (💾 triggers archival). Reconstruct conversations, run Workers AI summarization with Llama-3.1-8B, encrypt the summary, and auto-commit to vault. Tags memories with #slack and #watercooler for organization.",
    category: "integration",
    delay: 1140,
  },
  {
    icon: <IconOrg />,
    title: "Enterprise SSO (SAML 2.0 & OIDC)",
    desc: "Configure enterprise identity providers (SAML 2.0 or OIDC) with encrypted credential storage per-org. Enables centralized identity management and automatic user provisioning. Enterprise-only feature for large organizations.",
    category: "governance",
    delay: 1200,
  },
  {
    icon: <IconLock />,
    title: "Bring Your Own Key (BYOK) Encryption",
    desc: "Zero-knowledge encryption mode: clients submit AES-GCM ciphertexts directly (X-Locker-BYOK header). Optional client-generated embeddings bypass server-side generation. Plaintext never touches the server. Extreme privacy for regulated industries.",
    category: "security",
    delay: 1260,
  },
  {
    icon: <IconTrendingUp />,
    title: "Quota & Token Usage Tracking",
    desc: "Real-time usage analytics per org showing monthly recall count, commit count, token consumption (daily/monthly). Configure soft/hard quota limits per memory type. Track human and agent token usage separately. Essential for cost control and optimization.",
    category: "governance",
    delay: 1320,
  },
];

const CATEGORIES: { id: Category; label: string; icon?: React.ReactNode }[] = [
  { id: "developer", label: "Developer Experience", icon: <IconCode /> },
  { id: "security", label: "Security", icon: <IconShield /> },
  { id: "governance", label: "Governance", icon: <IconOrg /> },
  { id: "integration", label: "Integration", icon: <IconLink /> },
  { id: "all", label: "All Features" },
];

export function FeatureFilter() {
  const [activeCategory, setActiveCategory] = useState<Category>("developer");

  const filtered = useMemo(() => {
    if (activeCategory === "all") return FEATURES;
    return FEATURES.filter((f) => f.category === activeCategory);
  }, [activeCategory]);

  return (
    <div>
      {/* Filter buttons */}
      <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginBottom: 40 }}>
        {CATEGORIES.map(({ id, label, icon }) => (
          <button
            key={id}
            onClick={() => setActiveCategory(id)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "10px 16px",
              background: activeCategory === id ? "var(--accent)" : "var(--surface)",
              color: activeCategory === id ? "#fff" : "var(--text-muted)",
              border: activeCategory === id ? "1px solid var(--accent)" : "1px solid var(--border)",
              borderRadius: 8,
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 500,
              transition: "all 0.2s ease",
              textDecoration: "none",
            }}
            onMouseEnter={(e) => {
              if (activeCategory !== id) {
                (e.currentTarget as HTMLElement).style.borderColor = "rgba(168,85,247,0.3)";
                (e.currentTarget as HTMLElement).style.color = "var(--text)";
              }
            }}
            onMouseLeave={(e) => {
              if (activeCategory !== id) {
                (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
                (e.currentTarget as HTMLElement).style.color = "var(--text-muted)";
              }
            }}
          >
            {icon && <div style={{ display: "flex", alignItems: "center" }}>{icon}</div>}
            {label}
          </button>
        ))}
      </div>

      {/* Feature cards grid with smooth transitions */}
      <div style={{ position: "relative", minHeight: 400 }}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" style={{ animation: "fadeIn 0.3s ease" }}>
          {filtered.map((f) => (
            <FeatureCard
              key={f.title}
              icon={f.icon}
              title={f.title}
              desc={f.desc}
              delay={0}
            />
          ))}
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from {
            opacity: 0.8;
          }
          to {
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}
