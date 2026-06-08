import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getQuarantinedMemories, unmaskMemory, deleteMemory } from "~/server/memoryFunctions";
import { useToast } from "~/components/ui/toast";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import type { Memory } from "~/db/schema";

interface QuarantineDashboardProps {
  projectKey?: string;
}

function formatTs(ts: number) {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function categoryColor(cat: string) {
  switch (cat) {
    case "rules": return "bg-blue-500/15 text-blue-400 border-blue-500/25";
    case "projects": return "bg-violet-500/15 text-violet-400 border-violet-500/25";
    case "references": return "bg-emerald-500/15 text-emerald-400 border-emerald-500/25";
    default: return "bg-surface-muted text-text-muted border-border";
  }
}

function QuarantineRow({ memory, onActioned }: { memory: Memory; onActioned: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = React.useState(false);

  const unmaskMutation = useMutation({
    mutationFn: () => unmaskMemory({ data: { id: memory.id } }),
    onSuccess: () => {
      toast.success("Memory released from quarantine.");
      queryClient.invalidateQueries({ queryKey: ["memories"] });
      onActioned();
    },
    onError: (err: any) => toast.error("Unmask failed: " + String(err?.message ?? err)),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteMemory({ data: { id: memory.id } }),
    onSuccess: () => {
      toast.success("Quarantined memory deleted.");
      queryClient.invalidateQueries({ queryKey: ["memories"] });
      onActioned();
    },
    onError: (err: any) => toast.error("Delete failed: " + String(err?.message ?? err)),
  });

  const isPending = unmaskMutation.isPending || deleteMutation.isPending;
  const tags = memory.tags ? memory.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];

  return (
    <div className="flex flex-col gap-3 p-4 rounded-xl border border-red-500/20 bg-red-500/5">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md border ${categoryColor(memory.category)}`}>
              {memory.category}
            </span>
            {tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-[10px] h-4 px-1.5 py-0">
                {tag}
              </Badge>
            ))}
          </div>
          <span className="text-[10px] text-text-muted">{formatTs(memory.timestamp)}</span>
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-[10px] text-text-muted hover:text-text shrink-0 underline-offset-2 hover:underline"
        >
          {expanded ? "Collapse" : "Expand"}
        </button>
      </div>

      {/* Fact preview / full text */}
      <div className="text-xs text-text leading-relaxed font-mono bg-surface-muted/60 rounded-lg p-3 whitespace-pre-wrap break-words">
        {expanded ? memory.fact : memory.fact.slice(0, 300) + (memory.fact.length > 300 ? "…" : "")}
      </div>

      {/* Action row */}
      <div className="flex items-center gap-2 justify-end">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px] border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-300"
          disabled={isPending}
          onClick={() => deleteMutation.mutate()}
        >
          {deleteMutation.isPending ? "Deleting…" : "Delete"}
        </Button>
        <Button
          size="sm"
          className="h-7 text-[11px] bg-amber-600 hover:bg-amber-500 text-white font-semibold"
          disabled={isPending}
          onClick={() => unmaskMutation.mutate()}
        >
          {unmaskMutation.isPending ? "Unmasking…" : "🔓 Approve & Unmask"}
        </Button>
      </div>
    </div>
  );
}

export function QuarantineDashboard({ projectKey }: QuarantineDashboardProps) {
  const queryClient = useQueryClient();

  const { data: quarantined = [], isLoading, error } = useQuery({
    queryKey: ["quarantined-memories", projectKey],
    queryFn: () => getQuarantinedMemories({ data: { projectKey } }),
    staleTime: 30_000,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["quarantined-memories", projectKey] });
  };

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 p-6 items-center justify-center text-text-muted text-xs">
        <div className="w-4 h-4 border-2 border-red-500/40 border-t-red-500 rounded-full animate-spin" />
        Loading quarantined memories…
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-xs text-red-400">
        Failed to load quarantine queue: {String((error as any)?.message ?? error)}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-text">DLP Quarantine Queue</span>
          {quarantined.length > 0 && (
            <span className="text-[10px] font-semibold bg-red-500/15 text-red-400 border border-red-500/25 px-1.5 py-0.5 rounded-full">
              {quarantined.length}
            </span>
          )}
        </div>
        <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={refresh}>
          Refresh
        </Button>
      </div>

      {/* Description */}
      <p className="text-xs text-text-muted leading-relaxed">
        These memories were flagged by the DLP engine (entropy analysis or PII detection) and are
        held in quarantine. AI agents receive{" "}
        <code className="font-mono bg-surface-muted px-1 rounded text-[10px]">[REDACTED]</code>{" "}
        in place of their content until a human approves or deletes each record.
      </p>

      {/* Empty state */}
      {quarantined.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-text-muted text-xs">
          <span className="text-2xl">✅</span>
          No quarantined memories — all clear.
        </div>
      )}

      {/* Rows */}
      <div className="flex flex-col gap-3">
        {quarantined.map((memory) => (
          <QuarantineRow key={memory.id} memory={memory} onActioned={refresh} />
        ))}
      </div>
    </div>
  );
}
