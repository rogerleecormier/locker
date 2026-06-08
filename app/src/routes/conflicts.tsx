import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getConflicts, reviewMemoryRecommendation } from "~/server/memoryFunctions";
import { PageContainer } from "~/components/PageContainer";
import { PageHeader } from "~/components/PageHeader";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { useToast } from "~/components/ui/toast";

export const Route = createFileRoute("/conflicts")({
  component: ConflictsPage,
});

// ── Inline text diff ─────────────────────────────────────────────────────────
// Splits two strings into word-level tokens and marks additions/removals.

type DiffToken =
  | { kind: "same"; text: string }
  | { kind: "add"; text: string }
  | { kind: "remove"; text: string };

function diffWords(original: string, proposed: string): DiffToken[] {
  const oldWords = original.split(/(\s+)/);
  const newWords = proposed.split(/(\s+)/);

  // LCS-based diff via DP table
  const m = oldWords.length;
  const n = newWords.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldWords[i] === newWords[j]) {
        dp[i][j] = 1 + dp[i + 1][j + 1];
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const tokens: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldWords[i] === newWords[j]) {
      tokens.push({ kind: "same", text: oldWords[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      tokens.push({ kind: "remove", text: oldWords[i] });
      i++;
    } else {
      tokens.push({ kind: "add", text: newWords[j] });
      j++;
    }
  }
  while (i < m) { tokens.push({ kind: "remove", text: oldWords[i++] }); }
  while (j < n) { tokens.push({ kind: "add", text: newWords[j++] }); }
  return tokens;
}

function InlineDiff({ original, proposed }: { original: string; proposed: string }) {
  const tokens = diffWords(original, proposed);
  return (
    <p className="text-sm leading-relaxed font-mono whitespace-pre-wrap break-words">
      {tokens.map((tok, idx) => {
        if (tok.kind === "same") {
          return <span key={idx}>{tok.text}</span>;
        }
        if (tok.kind === "remove") {
          return (
            <span key={idx} style={{ background: "rgba(239,68,68,0.18)", color: "var(--error, #ef4444)", textDecoration: "line-through", borderRadius: 3, padding: "0 1px" }}>
              {tok.text}
            </span>
          );
        }
        return (
          <span key={idx} style={{ background: "rgba(34,197,94,0.18)", color: "var(--success, #22c55e)", borderRadius: 3, padding: "0 1px" }}>
            {tok.text}
          </span>
        );
      })}
    </p>
  );
}

// ── Side-by-side diff panel ────────────────────────────────────────────────

function DiffPanel({
  originalFact,
  proposedFact,
  originalCategory,
  proposedCategory,
  originalTags,
  proposedTags,
  type,
}: {
  originalFact: string;
  proposedFact?: string | null;
  originalCategory: string;
  proposedCategory?: string | null;
  originalTags: string;
  proposedTags?: string | null;
  type: "update" | "delete";
}) {
  const panelBase: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    border: "1px solid var(--border)",
    borderRadius: "var(--radius, 8px)",
    padding: "14px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  };

  if (type === "delete") {
    return (
      <div className="flex gap-3 flex-col sm:flex-row">
        <div style={{ ...panelBase, background: "rgba(239,68,68,0.06)", borderColor: "rgba(239,68,68,0.3)" }}>
          <div className="flex items-center gap-2 mb-1">
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--error, #ef4444)", display: "inline-block" }} />
            <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--error, #ef4444)" }}>Current (will be deleted)</span>
          </div>
          <p className="text-sm leading-relaxed font-mono whitespace-pre-wrap break-words text-text">{originalFact}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge variant="secondary" className="text-xs">{originalCategory}</Badge>
            {originalTags && originalTags.split(",").map((t) => t.trim()).filter(Boolean).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
            ))}
          </div>
        </div>
        <div className="hidden sm:flex items-center justify-center text-text-muted text-lg font-light">→</div>
        <div style={{ ...panelBase, background: "rgba(239,68,68,0.04)", borderColor: "rgba(239,68,68,0.2)", opacity: 0.65 }}>
          <div className="flex items-center gap-2 mb-1">
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--text-muted)", display: "inline-block" }} />
            <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">After deletion</span>
          </div>
          <p className="text-sm text-text-muted italic">Memory will be permanently removed.</p>
        </div>
      </div>
    );
  }

  // update
  const catChanged = proposedCategory && proposedCategory !== originalCategory;
  const tagsChanged = proposedTags !== undefined && proposedTags !== null && proposedTags !== originalTags;

  return (
    <div className="flex gap-3 flex-col sm:flex-row">
      <div style={{ ...panelBase, background: "rgba(239,68,68,0.06)", borderColor: "rgba(239,68,68,0.25)" }}>
        <div className="flex items-center gap-2 mb-1">
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--error, #ef4444)", display: "inline-block" }} />
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--error, #ef4444)" }}>Original</span>
        </div>
        <p className="text-sm leading-relaxed font-mono whitespace-pre-wrap break-words text-text">{originalFact}</p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <Badge variant="secondary" className="text-xs">{originalCategory}</Badge>
          {originalTags && originalTags.split(",").map((t) => t.trim()).filter(Boolean).map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
          ))}
        </div>
      </div>

      <div className="hidden sm:flex items-center justify-center text-text-muted text-lg font-light">→</div>

      <div style={{ ...panelBase, background: "rgba(34,197,94,0.05)", borderColor: "rgba(34,197,94,0.25)" }}>
        <div className="flex items-center gap-2 mb-1">
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--success, #22c55e)", display: "inline-block" }} />
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--success, #22c55e)" }}>Proposed</span>
        </div>
        <InlineDiff original={originalFact} proposed={proposedFact ?? ""} />
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <Badge variant="secondary" className={`text-xs ${catChanged ? "ring-1 ring-amber-400" : ""}`}>
            {proposedCategory ?? originalCategory}
            {catChanged && <span className="ml-1 opacity-60 text-[10px]">(changed)</span>}
          </Badge>
          {(proposedTags ?? originalTags) && (proposedTags ?? originalTags).split(",").map((t) => t.trim()).filter(Boolean).map((tag) => (
            <Badge key={tag} variant="secondary" className={`text-xs ${tagsChanged ? "ring-1 ring-amber-400/60" : ""}`}>{tag}</Badge>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Conflict card ─────────────────────────────────────────────────────────────

function ConflictCard({ rec, onResolved }: { rec: any; onResolved: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [reviewNotes, setReviewNotes] = useState("");
  const [expanded, setExpanded] = useState(true);

  const reviewMutation = useMutation({
    mutationFn: (action: "approve" | "reject") =>
      reviewMemoryRecommendation({ data: { id: rec.id, action, reviewNotes: reviewNotes || undefined } }),
    onSuccess: (_, action) => {
      queryClient.invalidateQueries({ queryKey: ["conflicts"] });
      toast.success(action === "approve" ? "Change approved and applied." : "Change rejected.");
      onResolved();
    },
    onError: (err: any) => {
      toast.error("Failed: " + String(err.message ?? err));
    },
  });

  const isDelete = rec.recommendationType === "delete";
  const typeLabel = isDelete ? "Deletion Request" : "Update Request";
  const typeColor = isDelete ? "var(--error, #ef4444)" : "var(--warning, #f59e0b)";

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius, 8px)",
        overflow: "hidden",
        background: "var(--surface)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-start justify-between gap-3 px-4 py-3 cursor-pointer select-none"
        style={{ borderBottom: expanded ? "1px solid var(--border)" : "none", background: "var(--surface2, var(--surface))" }}
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-start gap-3 min-w-0">
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 22,
              height: 22,
              borderRadius: "50%",
              background: isDelete ? "rgba(239,68,68,0.15)" : "rgba(245,158,11,0.15)",
              color: typeColor,
              flexShrink: 0,
              marginTop: 2,
            }}
          >
            {isDelete ? (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
            ) : (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            )}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-text">{typeLabel}</span>
              {rec.agentContext && (
                <Badge variant="secondary" className="text-[11px] font-normal">{rec.agentContext}</Badge>
              )}
              <Badge variant="secondary" className="text-[11px] font-normal">{rec.category}</Badge>
            </div>
            <div className="text-xs text-text-muted mt-0.5 truncate max-w-md">
              {new Date(rec.createdAt).toLocaleString()}
              {rec.targetMemoryId && <span className="ml-2 opacity-50 font-mono">#{rec.targetMemoryId.slice(0, 8)}</span>}
            </div>
          </div>
        </div>
        <span className="text-text-muted text-xs mt-1 flex-shrink-0">{expanded ? "▲" : "▼"}</span>
      </div>

      {expanded && (
        <div className="p-4 flex flex-col gap-4">
          {/* Diff */}
          <DiffPanel
            originalFact={rec.fact}
            proposedFact={isDelete ? null : rec.proposedFact}
            originalCategory={rec.category}
            proposedCategory={isDelete ? null : rec.proposedCategory}
            originalTags={rec.tags}
            proposedTags={isDelete ? null : rec.proposedTags}
            type={isDelete ? "delete" : "update"}
          />

          {/* Review notes */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-muted">Review notes (optional)</label>
            <textarea
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
              placeholder="Add a note about this decision..."
              rows={2}
              maxLength={1000}
              style={{
                background: "var(--surface2, var(--surface))",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius, 6px)",
                padding: "8px 10px",
                fontSize: 13,
                color: "var(--text)",
                resize: "vertical",
                outline: "none",
                width: "100%",
                fontFamily: "inherit",
              }}
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => reviewMutation.mutate("reject")}
              disabled={reviewMutation.isPending}
              style={{ borderColor: "rgba(239,68,68,0.4)", color: "var(--error, #ef4444)" }}
            >
              {reviewMutation.isPending ? "..." : "Reject"}
            </Button>
            <Button
              size="sm"
              onClick={() => reviewMutation.mutate("approve")}
              disabled={reviewMutation.isPending}
              style={{ background: "var(--success, #22c55e)", color: "#fff", borderColor: "transparent" }}
            >
              {reviewMutation.isPending ? "..." : isDelete ? "Approve deletion" : "Approve update"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

function ConflictsPage() {
  const queryClient = useQueryClient();

  const { data: conflicts = [], isLoading, error } = useQuery({
    queryKey: ["conflicts"],
    queryFn: () => getConflicts(),
    refetchInterval: 30_000,
  });

  const pending = conflicts.filter((r: any) => r.status === "pending");

  return (
    <PageContainer>
      <PageHeader
        title="Memory Conflict Resolution"
        description="Review and approve agent-proposed changes before they are applied to your vault."
      />

      {isLoading && (
        <div className="flex items-center justify-center py-16 text-text-muted text-sm">Loading…</div>
      )}

      {error && (
        <div className="rounded-lg p-4 text-sm" style={{ background: "rgba(239,68,68,0.08)", color: "var(--error, #ef4444)", border: "1px solid rgba(239,68,68,0.25)" }}>
          Failed to load conflicts: {String((error as any).message ?? error)}
        </div>
      )}

      {!isLoading && !error && pending.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
          <div style={{ width: 48, height: 48, borderRadius: "50%", background: "rgba(34,197,94,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--success, #22c55e)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <p className="text-text font-medium text-sm">All clear</p>
          <p className="text-text-muted text-xs max-w-xs">No pending agent changes require your review. Any future update or deletion requests from AI agents will appear here.</p>
        </div>
      )}

      {!isLoading && pending.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-text-muted">{pending.length} pending {pending.length === 1 ? "request" : "requests"}</span>
          </div>
          {pending.map((rec: any) => (
            <ConflictCard
              key={rec.id}
              rec={rec}
              onResolved={() => queryClient.invalidateQueries({ queryKey: ["conflicts"] })}
            />
          ))}
        </div>
      )}
    </PageContainer>
  );
}
