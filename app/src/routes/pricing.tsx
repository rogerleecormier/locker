import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PLANS, SELF_SERVE_PLAN_ORDER } from "~/lib/plans";
import { PlanCard } from "~/components/PaywallGate";
import { useBillingData } from "~/routes/billing";

export const Route = createFileRoute("/pricing")({
  component: PricingPage,
});

function PricingPage() {
  const navigate = useNavigate();
  const { data: billing } = useBillingData();

  return (
    <div>
      <div style={{ background: "var(--surface2)", borderBottom: "1px solid var(--border)", padding: "20px 24px" }}>
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
            <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>Pricing</h1>
            <span style={{ fontSize: 11, background: "var(--accent-dim)", color: "var(--accent)", border: "1px solid rgba(168,85,247,0.3)", borderRadius: 20, padding: "2px 8px", fontWeight: 600 }}>
              Plans
            </span>
          </div>
          <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0 }}>
            Start free. Upgrade when your team is ready for shared memory vaults and collaboration tools.
          </p>
        </div>
      </div>
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "48px 24px" }}>
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <h1 style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-0.04em", color: "var(--text)", marginBottom: 12, lineHeight: 1.1 }}>
          Simple, transparent pricing
        </h1>
        <p style={{ fontSize: 16, color: "var(--text-muted)", maxWidth: 480, margin: "0 auto", lineHeight: 1.7 }}>
          Start free. Upgrade when your team is ready for shared memory vaults and collaboration tools.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 48 }}>
        {SELF_SERVE_PLAN_ORDER.map((planId) => (
          <PlanCard
            key={planId}
            plan={PLANS[planId]}
            isCurrentPlan={false}
            isLoggedIn={false}
            onSelect={() => planId === "free" ? navigate({ to: "/signup" }) : null}
            upgradesEnabled={planId === "enterprise" ? !!billing?.enableEnterprisePlans : !!billing?.enableBusinessPlans}
          />
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {[
          {
            q: "What counts as a recall?",
            a: "Every call to the recall_context MCP tool from any AI client counts as one recall. Semantic search is efficient – most sessions use fewer than 20 recalls.",
          },
          {
            q: "What are embedding tokens?",
            a: "Embedding tokens are used for semantic search on your memories. They're consumed when you recall or commit memories (roughly 1 token per 4 characters). Your plan includes a monthly budget: Personal gets 100k, Business gets 1M, Enterprise gets unlimited.",
          },
          {
            q: "Can I switch plans?",
            a: "Yes. Downgrading from Business to Personal will disable org/team features but your memories are never deleted. They'll be accessible again if you upgrade.",
          },
          {
            q: "What happens at the memory limit?",
            a: "New commits via MCP or the UI will be rejected with a clear error message. You can delete old memories to free up space or upgrade your plan.",
          },
          {
            q: "Is my data encrypted on all plans?",
            a: "Yes. AES-256-GCM encryption at rest is standard on all plans, including free. Encryption is non-negotiable.",
          },
          {
            q: "Do shared vaults count against personal limits?",
            a: "No. Organization and team vault memories count against the org's quota, not your personal quota.",
          },
          {
            q: "What is BYOK (Bring Your Own Key)?",
            a: "BYOK enables true client-side end-to-end encryption. Memories are encrypted in your browser using the Web Crypto API before leaving your device. The server only stores opaque ciphertext and never sees plaintext. Local master key available on Business+; external KMS (AWS KMS, HashiCorp Vault, Cloudflare KMS) requires Enterprise.",
          },
          {
            q: "What is Enterprise SSO?",
            a: "Enterprise plan supports SAML 2.0 (Okta, Entra ID, PingFederate) and generic OIDC providers. Admins can enforce single sign-on for all org members, eliminating password-based auth. IdP certificates and secrets are encrypted at rest with your org vault key.",
          },
        ].map(({ q, a }) => (
          <div key={q} style={{ padding: "16px 18px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>{q}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>{a}</div>
          </div>
        ))}
      </div>

      <div style={{ textAlign: "center", marginTop: 40, padding: "24px", background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>Need more than Business?</div>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
          Enterprise plan includes SAML/OIDC single sign-on, Bring Your Own Key (BYOK) end-to-end encryption, unlimited seats, custom contracts, and dedicated support.
        </p>
        <div style={{ position: "relative", display: "inline-block" }} className="group">
          <a
            href={billing?.enableEnterprisePlans ? "mailto:enterprise@locker.rcormier.dev?subject=Enterprise%20Plan%20Inquiry" : undefined}
            onClick={!billing?.enableEnterprisePlans ? (e) => e.preventDefault() : undefined}
            style={{
              display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 22px",
              background: "transparent",
              border: billing?.enableEnterprisePlans ? "1px solid rgba(245,158,11,0.4)" : "1px solid var(--border)",
              color: billing?.enableEnterprisePlans ? "#f59e0b" : "var(--text-muted)",
              fontWeight: 600, fontSize: 13, borderRadius: 8, textDecoration: "none",
              opacity: billing?.enableEnterprisePlans ? 1 : 0.5,
              cursor: billing?.enableEnterprisePlans ? "pointer" : "not-allowed",
            }}
          >
            Contact Sales →
          </a>
          {!billing?.enableEnterprisePlans && (
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 bg-surface2 border border-border rounded-lg px-3 py-2 text-xs text-text-muted shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50" style={{ textAlign: "left" }}>
              Enterprise upgrades are disabled. Enable in{" "}
              <span className="text-accent font-semibold">Site Admin → Site Configuration</span>.
            </div>
          )}
        </div>
      </div>
    </div>
    </div>
  );
}
