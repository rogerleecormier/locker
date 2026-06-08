import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useCallback } from "react";
import { addMemory, createApiToken } from "~/server/memoryFunctions";
import { MCP_PERM_RECALL, MCP_PERM_COMMIT, MCP_PERM_UPDATE, MCP_PERM_DELETE } from "~/db/schema";
import { Button } from "~/components/ui/button";
import { Label, Input, Textarea } from "~/components/ui/input";
import { useToast } from "~/components/ui/toast";
import { LockerLogo } from "~/components/LockerLogo";

export const Route = createFileRoute("/onboarding")({
  component: OnboardingWizard,
});

const STORAGE_KEY = "locker_onboarding_complete";

const ALL_PERMS = MCP_PERM_RECALL | MCP_PERM_COMMIT | MCP_PERM_UPDATE | MCP_PERM_DELETE;

const STEPS = [
  { id: 1, label: "Create your first memory" },
  { id: 2, label: "Create an API token" },
  { id: 3, label: "Connect your AI agent" },
] as const;

// ── Step progress bar ────────────────────────────────────────────────────────

function StepBar({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {STEPS.map((s, i) => {
        const done = step > s.id;
        const active = step === s.id;
        return (
          <div key={s.id} className="flex items-center flex-1 min-w-0">
            <div className="flex flex-col items-center gap-1.5 shrink-0">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all ${
                  done
                    ? "bg-accent border-accent text-white"
                    : active
                    ? "bg-accent/15 border-accent text-accent"
                    : "bg-surface2 border-border text-text-muted"
                }`}
              >
                {done ? (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  s.id
                )}
              </div>
              <span
                className={`text-[10px] font-semibold text-center leading-tight whitespace-nowrap ${
                  active ? "text-accent" : done ? "text-text-muted" : "text-text-muted/50"
                }`}
              >
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-px mx-3 mt-[-14px] ${done ? "bg-accent/40" : "bg-border"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Step 1: Create your first memory ────────────────────────────────────────

const PREFILL_FACT = "Uses TypeScript with React and TanStack Router. Prefers atomic, declarative memory facts. Always check existing memories before committing new ones.";

function StepMemory({ onComplete }: { onComplete: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [fact, setFact] = useState(PREFILL_FACT);
  const [submitted, setSubmitted] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      addMemory({
        data: {
          fact: fact.trim(),
          category: "rules",
          tags: "onboarding,baseline",
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memories"] });
      setSubmitted(true);
      toast.success("Memory committed to your vault!");
    },
    onError: (err: any) => {
      toast.error("Failed to save memory: " + String(err?.message ?? err));
    },
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-xl font-bold text-text">Create your first memory</h2>
        <p className="text-sm text-text-muted leading-relaxed">
          Memories are atomic facts your AI agents recall automatically. We've pre-filled a starter rule — edit it to match your preferences and commit it.
        </p>
      </div>

      {/* Editable mockup card */}
      <div className="bg-surface border border-border rounded-xl p-4 flex flex-col gap-3 shadow-xs">
        <div className="flex items-center gap-2 select-none">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase bg-indigo-500/10 border border-indigo-500/25 text-indigo-400">
            rules
          </span>
          <span className="text-[10px] text-text-muted font-mono">onboarding · baseline</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ob-fact" className="text-[10px] uppercase font-bold tracking-wider text-text-muted">
            Fact Content — edit before committing
          </Label>
          <Textarea
            id="ob-fact"
            value={fact}
            onChange={(e) => setFact(e.target.value)}
            rows={4}
            className="text-sm font-medium leading-relaxed resize-none"
            disabled={submitted || mutation.isPending}
          />
        </div>
        <div className="flex items-center gap-2 text-[10px] text-text-muted select-none">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          Encrypted at rest · personal workspace
        </div>
      </div>

      {submitted ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/25 rounded-lg text-sm text-emerald-400 font-semibold">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Memory committed successfully!
          </div>
          <Button onClick={onComplete} className="w-full font-bold">
            Continue to API Token →
          </Button>
        </div>
      ) : (
        <Button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !fact.trim()}
          className="w-full font-bold"
        >
          {mutation.isPending ? (
            <span className="flex items-center gap-2">
              <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Committing...
            </span>
          ) : (
            "Commit Memory to Vault"
          )}
        </Button>
      )}
    </div>
  );
}

// ── Step 2: Create an API token ───────────────────────────────────────────────

function StepApiToken({ onComplete }: { onComplete: (token: string) => void }) {
  const toast = useToast();
  const [tokenName, setTokenName] = useState("My First Token");
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      createApiToken({
        data: {
          name: tokenName.trim(),
          permissions: ALL_PERMS,
          scopeType: "personal",
          ttlDays: 365,
          tokenType: "human",
        },
      }),
    onSuccess: (result) => {
      setGeneratedToken(result.token);
      toast.success("API token generated — copy it now, it won't be shown again.");
    },
    onError: (err: any) => {
      toast.error("Failed to generate token: " + String(err?.message ?? err));
    },
  });

  function handleCopy() {
    if (!generatedToken) return;
    navigator.clipboard.writeText(generatedToken).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-xl font-bold text-text">Create an API token</h2>
        <p className="text-sm text-text-muted leading-relaxed">
          AI agents authenticate with Locker using a signed API token. Generate one now — it's shown only once.
        </p>
      </div>

      {!generatedToken ? (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ob-token-name">Token name</Label>
            <Input
              id="ob-token-name"
              value={tokenName}
              onChange={(e) => setTokenName(e.target.value)}
              placeholder="e.g. My First Token"
              disabled={mutation.isPending}
            />
          </div>

          <div className="flex flex-col gap-2 p-4 bg-surface2 border border-border rounded-xl text-xs text-text-muted select-none">
            <span className="font-bold text-text text-[11px] uppercase tracking-wider">Permissions granted</span>
            <div className="grid grid-cols-2 gap-1.5">
              {["recall_context", "commit_memory", "update_memory", "delete_memory"].map((p) => (
                <span key={p} className="flex items-center gap-1.5 font-mono">
                  <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />
                  {p}
                </span>
              ))}
            </div>
            <p className="text-[10px] mt-1 leading-relaxed">Full access · personal scope · expires in 365 days. Adjust permissions anytime from Settings → API Tokens.</p>
          </div>

          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !tokenName.trim()}
            className="w-full font-bold"
          >
            {mutation.isPending ? (
              <span className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Generating...
              </span>
            ) : (
              "Generate API Token"
            )}
          </Button>
        </>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 p-4 bg-amber-500/5 border border-amber-500/25 rounded-xl">
            <div className="flex items-center gap-2 text-amber-500 font-bold text-xs select-none">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              Copy this token now — it will not be shown again
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 font-mono text-xs text-accent bg-surface border border-border rounded-lg px-3 py-2.5 break-all select-all">
                {generatedToken}
              </code>
              <button
                type="button"
                onClick={handleCopy}
                title="Copy to clipboard"
                className="shrink-0 h-9 w-9 flex items-center justify-center rounded-lg border border-border bg-surface2 hover:border-accent/40 hover:text-accent text-text-muted transition-colors"
              >
                {copied ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <Button onClick={() => onComplete(generatedToken)} className="w-full font-bold">
            I've saved my token — Continue →
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Step 3: Connect your AI agent ────────────────────────────────────────────

type ConnectionMethod = "http" | "stdio" | "claude-code";

const CONNECTION_METHODS: { id: ConnectionMethod; label: string; desc: string }[] = [
  { id: "http", label: "HTTP (native)", desc: "Antigravity, Codex, Kilo Code, Windsurf, Zed, Amp, Kiro" },
  { id: "stdio", label: "stdio via mcp-remote", desc: "Claude Desktop, Cursor, Cline, Continue, Copilot, VS Code" },
  { id: "claude-code", label: "Claude Code CLI", desc: "claude mcp add command" },
];

function StepConnect({ token, onComplete }: { token: string; onComplete: () => void }) {
  const [method, setMethod] = useState<ConnectionMethod>("stdio");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const origin = typeof window !== "undefined" ? window.location.origin : "https://locker.rcormier.dev";
  const mcpUrl = `${origin}/api/mcp`;

  const snippets: Record<ConnectionMethod, { label: string; value: string }[]> = {
    http: [
      { label: "MCP Endpoint", value: mcpUrl },
      { label: "Authorization Header", value: `Authorization: Bearer ${token}` },
    ],
    stdio: [
      {
        label: "Run this command in your terminal",
        value: `npx -y mcp-remote ${mcpUrl} --header "Authorization: Bearer ${token}"`,
      },
    ],
    "claude-code": [
      {
        label: "Add via Claude Code CLI",
        value: `claude mcp add --transport http locker ${mcpUrl} --header "Authorization: Bearer ${token}"`,
      },
      {
        label: "Verify connection",
        value: `claude mcp list`,
      },
    ],
  };

  function copySnippet(value: string, key: string) {
    navigator.clipboard.writeText(value).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-xl font-bold text-text">Connect your AI agent</h2>
        <p className="text-sm text-text-muted leading-relaxed">
          Point your AI client at Locker's MCP endpoint using your new token. Pick the connection pattern that matches your client.
        </p>
      </div>

      {/* Method selector */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {CONNECTION_METHODS.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMethod(m.id)}
            className={`flex flex-col gap-1 p-3 rounded-xl border text-left transition-all cursor-pointer ${
              method === m.id
                ? "border-accent bg-accent/8 ring-1 ring-accent/20"
                : "border-border bg-surface2 hover:border-accent/30"
            }`}
          >
            <span className={`text-xs font-bold ${method === m.id ? "text-accent" : "text-text"}`}>
              {m.label}
            </span>
            <span className="text-[10px] text-text-muted leading-relaxed">{m.desc}</span>
          </button>
        ))}
      </div>

      {/* Connection snippets */}
      <div className="flex flex-col gap-3">
        {snippets[method].map((s) => (
          <div key={s.label} className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">{s.label}</span>
            <div className="flex items-start gap-2">
              <code className="flex-1 min-w-0 font-mono text-xs text-text bg-surface border border-border rounded-lg px-3 py-2.5 break-all select-all leading-relaxed">
                {s.value}
              </code>
              <button
                type="button"
                onClick={() => copySnippet(s.value, s.label)}
                title="Copy to clipboard"
                className="shrink-0 h-9 w-9 mt-0 flex items-center justify-center rounded-lg border border-border bg-surface2 hover:border-accent/40 hover:text-accent text-text-muted transition-colors"
              >
                {copiedKey === s.label ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3 p-4 bg-surface2 border border-border rounded-xl text-xs text-text-muted">
        <div className="flex items-start gap-2">
          <span className="text-accent shrink-0 mt-0.5">💡</span>
          <span className="leading-relaxed">
            Full connection guides for every supported client are in{" "}
            <a href="/docs" className="text-accent font-semibold hover:underline">
              Docs → Setup
            </a>
            . For Claude Desktop specifically, you'll also need to add the config to{" "}
            <code className="bg-surface border border-border rounded px-1">claude_desktop_config.json</code>.
          </span>
        </div>
      </div>

      <Button onClick={onComplete} className="w-full font-bold">
        I'm connected — Go to my vault →
      </Button>
    </div>
  );
}

// ── Main wizard component ─────────────────────────────────────────────────────

function OnboardingWizard() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [generatedToken, setGeneratedToken] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined" && localStorage.getItem(STORAGE_KEY) === "true") {
      router.navigate({ to: "/memories" });
    }
  }, [router]);

  const completeOnboarding = useCallback(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, "true");
    }
    router.navigate({ to: "/memories" });
  }, [router]);

  return (
    <div className="min-h-screen bg-bg flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="flex flex-col items-center gap-3 mb-10 select-none">
          <LockerLogo size={32} />
          <div className="text-center">
            <h1 className="text-2xl font-bold text-text tracking-tight">Welcome to Locker</h1>
            <p className="text-sm text-text-muted mt-1">Let's get your vault set up in three steps.</p>
          </div>
        </div>

        <StepBar step={step} />

        {/* Panel */}
        <div className="bg-surface border border-border rounded-2xl p-6 md:p-8 shadow-lg">
          {step === 1 && (
            <StepMemory
              onComplete={() => setStep(2)}
            />
          )}
          {step === 2 && (
            <StepApiToken
              onComplete={(token) => {
                setGeneratedToken(token);
                setStep(3);
              }}
            />
          )}
          {step === 3 && (
            <StepConnect
              token={generatedToken}
              onComplete={completeOnboarding}
            />
          )}
        </div>

        <p className="text-center text-xs text-text-muted mt-6 select-none">
          Already set up?{" "}
          <button
            type="button"
            onClick={completeOnboarding}
            className="text-accent hover:underline font-semibold bg-transparent border-none cursor-pointer p-0"
          >
            Skip to memories
          </button>
        </p>
      </div>
    </div>
  );
}
