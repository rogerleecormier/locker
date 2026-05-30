import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { drizzle } from "drizzle-orm/d1";
import { PLANS, PLAN_ORDER } from "~/lib/plans";
import { PlanCard } from "~/components/PaywallGate";
import type { CloudflareEnv } from "~/types/cloudflare";

type CFContext = { cloudflare: { env: CloudflareEnv; ctx: ExecutionContext } };

export const joinWaitlist = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { email: string; plan: string } => {
    const d = data as { email: string; plan: string };
    if (!d.email || !d.email.includes("@")) throw new Error("Valid email required");
    return { email: d.email.trim().toLowerCase(), plan: d.plan ?? "business" };
  })
  .handler(async ({ data, context }): Promise<{ success: boolean }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const db = drizzle(env.DB);

    try {
      await db.run({
        sql: `INSERT OR IGNORE INTO waitlist (id, email, plan, createdAt) VALUES (?, ?, ?, ?)`,
        args: [crypto.randomUUID(), data.email, data.plan, Date.now()],
      } as any);
    } catch (err) {
      console.error("[waitlist] insert error:", err);
    }

    return { success: true };
  });

export const Route = createFileRoute("/pricing")({
  component: PricingPage,
});

function PricingPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const waitlistMut = useMutation({
    mutationFn: (data: { email: string; plan: string }) => joinWaitlist({ data }),
    onSuccess: () => setSubmitted(true),
    onError: (err) => alert(String(err)),
  });

  return (
    <div style={{ maxWidth: 880, margin: "0 auto", padding: "48px 20px" }}>
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <div style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          fontWeight: 600,
          color: "var(--accent)",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          background: "var(--accent-dim)",
          border: "1px solid rgba(168,85,247,0.3)",
          borderRadius: 20,
          padding: "4px 12px",
          marginBottom: 16,
        }}>
          Pricing
        </div>
        <h1 style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-0.04em", color: "var(--text)", marginBottom: 12, lineHeight: 1.1 }}>
          Simple, transparent pricing
        </h1>
        <p style={{ fontSize: 16, color: "var(--text-muted)", maxWidth: 480, margin: "0 auto", lineHeight: 1.7 }}>
          Start free. Upgrade when your team is ready for shared memory vaults and collaboration tools.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 48 }}>
        {PLAN_ORDER.map((planId) => (
          <PlanCard
            key={planId}
            plan={PLANS[planId]}
            isCurrentPlan={false}
          />
        ))}
      </div>

      <div style={{
        background: "var(--surface)",
        border: "1px solid rgba(168,85,247,0.3)",
        borderRadius: 16,
        padding: "32px 28px",
        textAlign: "center",
        marginBottom: 32,
      }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>
          Business plan – launching soon
        </div>
        <p style={{ fontSize: 14, color: "var(--text-muted)", maxWidth: 420, margin: "0 auto 24px", lineHeight: 1.6 }}>
          Join the waitlist and be first to know when team collaboration features go live. Early access pricing available.
        </p>

        {submitted ? (
          <div style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 24px",
            background: "rgba(34,197,94,0.1)",
            border: "1px solid rgba(34,197,94,0.3)",
            borderRadius: 10,
            color: "var(--success)",
            fontWeight: 600,
            fontSize: 14,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            You're on the list!
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, justifyContent: "center", maxWidth: 400, margin: "0 auto" }}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              onKeyDown={(e) => e.key === "Enter" && !waitlistMut.isPending && email && waitlistMut.mutate({ email, plan: "business" })}
              style={{ flex: 1, padding: "10px 14px", fontSize: 13 }}
            />
            <button
              onClick={() => waitlistMut.mutate({ email, plan: "business" })}
              disabled={waitlistMut.isPending || !email}
              style={{
                padding: "10px 20px",
                background: "var(--accent)",
                color: "#fff",
                fontWeight: 600,
                fontSize: 13,
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {waitlistMut.isPending ? "Joining…" : "Join Waitlist"}
            </button>
          </div>
        )}
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
          Enterprise plan includes SAML SSO, unlimited seats, custom contracts, and dedicated support.
        </p>
        <a
          href="mailto:enterprise@locker.rcormier.dev?subject=Enterprise%20Plan%20Inquiry"
          style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 22px", background: "transparent", border: "1px solid rgba(245,158,11,0.4)", color: "#f59e0b", fontWeight: 600, fontSize: 13, borderRadius: 8, textDecoration: "none" }}
        >
          Contact Sales →
        </a>
      </div>
    </div>
  );
}
