import * as React from "react";
import { useToast } from "~/components/ui/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteMemory, moveMemories, archiveMemory } from "~/server/memoryFunctions";
import type { Memory } from "~/db/schema";
import { getMemoryStaleness } from "~/lib/utils";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "./ui/dropdown";

interface MemoryCardProps {
  memory: Memory;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onExport: (memory: Memory) => void;
  workspaces?: any[];
  currentProjectKey?: string;
  isSelected?: boolean;
  isFocused?: boolean;
  onSelect?: () => void;
}

export function MemoryCard({
  memory,
  selected,
  onToggleSelect,
  onExport,
  workspaces = [],
  currentProjectKey = "personal",
  isSelected = false,
  isFocused = false,
  onSelect,
}: MemoryCardProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);
  const [moving, setMoving] = React.useState(false);
  const [targetWorkspace, setTargetWorkspace] = React.useState("");

  const deleteMutation = useMutation({
    mutationFn: () => deleteMemory({ data: { id: memory.id } }),
    onMutate: () => {
      queryClient.setQueryData<Memory[]>(["memories"], (old) =>
        old ? old.filter((m) => m.id !== memory.id) : []
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memories"] });
      setConfirmingDelete(false);
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ["memories"] });
    },
  });

  const moveMutation = useMutation({
    mutationFn: () =>
      moveMemories({ data: { ids: [memory.id], targetProjectKey: targetWorkspace } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memories"] });
      setMoving(false);
      setTargetWorkspace("");
    },
    onError: (err: Error) => {
      toast.error("Failed to move memory: " + err.message);
    },
  });

  const [dropdownOpen, setDropdownOpen] = React.useState(false);

  const archiveMutation = useMutation({
    mutationFn: () => archiveMemory({ data: { id: memory.id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memories"] });
      queryClient.invalidateQueries({ queryKey: ["memories-archived"] });
      setDropdownOpen(false);
    },
    onError: (err: Error) => {
      toast.error("Failed to archive memory: " + err.message);
    },
  });

  const tags = memory.tags
    ? memory.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];

  const staleness = getMemoryStaleness(memory);
  const isStale = staleness.level === "stale" || staleness.level === "never-used";

  return (
    <div
      onClick={onSelect}
      className={`group relative flex flex-col justify-between p-5 rounded-xl border bg-surface hover:bg-surface2 hover:-translate-y-1 hover:shadow-lg hover:shadow-accent/5 transition-all duration-200 cursor-pointer min-h-[220px] h-full box-border select-none ${
        memory.isQuarantined
          ? "border-red-500/40 hover:border-red-500/60 bg-red-500/3 hover:bg-red-500/5"
          : isSelected
            ? "border-accent ring-2 ring-accent/20 bg-accent/3"
            : isFocused
              ? "border-accent/50 ring-1 ring-accent/15"
              : "border-border hover:border-accent/35"
      }`}
    >
      <div>
        {/* Header */}
        <div
          className="flex justify-between items-start mb-3"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => {
              e.stopPropagation();
              onToggleSelect(memory.id);
            }}
            onClick={(e) => e.stopPropagation()}
            className="cursor-pointer h-4 w-4 rounded-sm border-border text-accent focus:ring-accent accent-accent mt-0.5"
          />
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex gap-2 items-center flex-wrap justify-end">
              <Badge variant={memory.category as any}>{memory.category}</Badge>
              {memory.isQuarantined && (
                <Badge variant="secondary" className="border-red-500/35 bg-red-500/10 text-red-500 font-semibold normal-case flex items-center gap-1">
                  <span>⚠️</span> Quarantined
                </Badge>
              )}
              {isStale && (
                <Badge variant="secondary" className="border-amber-500/35 bg-amber-500/10 text-amber-500 font-semibold normal-case">
                  Stale
                </Badge>
              )}
            </div>
            <div className="flex gap-1.5 items-center flex-wrap justify-end">
              {memory.authorityType === "authoritative" && (
                <span
                  title="Authoritative memory — takes precedence in AI context ranking"
                  className="inline-flex items-center gap-1 bg-amber-500/15 border border-amber-500/30 text-amber-500 text-[9px] font-bold px-1.5 py-0.5 rounded-sm uppercase select-none"
                >
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                  Authoritative
                </span>
              )}
              {memory.isLocked && (
                <span
                  title="This memory is locked and can only be edited by org admins."
                  className="inline-flex items-center gap-1 text-text-muted text-[10px] select-none"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  Locked
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Fact Text */}
        <p className="text-text-muted text-xs md:text-sm font-medium leading-relaxed line-clamp-5 break-words select-text">
          {memory.fact}
        </p>
      </div>

      {/* Footer */}
      <div className="mt-4">
        {tags.length > 0 && (
          <div
            className="flex flex-wrap gap-1 mb-3"
            onClick={(e) => e.stopPropagation()}
          >
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-block px-2 py-0.5 rounded-sm text-[10px] bg-tag-bg border border-tag-border text-text-muted select-none"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        <div
          className="flex justify-between items-center gap-2"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-text-muted font-medium select-none">
              {new Date(memory.timestamp).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
            {staleness.level === "fresh" ? (
              <span
                title={staleness.label}
                className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block shrink-0"
              />
            ) : staleness.level === "aging" ? (
              <span className="inline-flex items-center gap-1 select-none" title={staleness.label}>
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block shrink-0" />
                <span className="text-[9px] text-text-muted">{staleness.label.replace("Last used ", "")}</span>
              </span>
            ) : staleness.level === "stale" ? (
              <span className="inline-flex items-center gap-1 select-none" title={staleness.label}>
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block shrink-0" />
                <span className="text-[9px] text-text-muted">{staleness.label.replace("Last used ", "")}</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 select-none" title="Never recalled by an AI agent">
                <span className="w-1.5 h-1.5 rounded-full bg-text-muted/40 inline-block shrink-0" />
                <span className="text-[9px] text-text-muted">Never recalled</span>
              </span>
            )}
          </div>

          <div className="flex gap-1.5 items-center">
            {moving ? (
              <div className="flex gap-1 items-center bg-surface border border-border rounded-md p-1 shadow-sm">
                <select
                  value={targetWorkspace}
                  onChange={(e) => setTargetWorkspace(e.target.value)}
                  className="px-1.5 py-0.5 text-[10px] bg-surface2 border border-border rounded-sm text-text cursor-pointer focus:ring-1 focus:ring-accent"
                >
                  <option value="">Move...</option>
                  {workspaces
                    .filter((w) => w.key !== currentProjectKey)
                    .map((w) => (
                      <option key={w.key} value={w.key}>
                        {w.label}
                      </option>
                    ))}
                </select>
                <Button
                  onClick={() => moveMutation.mutate()}
                  disabled={moveMutation.isPending || !targetWorkspace}
                  size="sm"
                  className="h-5 px-2 text-[10px] font-bold"
                >
                  Go
                </Button>
                <Button
                  onClick={() => {
                    setMoving(false);
                    setTargetWorkspace("");
                  }}
                  variant="outline"
                  size="sm"
                  className="h-5 px-1.5 text-[10px]"
                >
                  ✕
                </Button>
              </div>
            ) : confirmingDelete ? (
              <div className="flex gap-1 items-center bg-error/5 border border-error/25 rounded-md p-1">
                <span className="text-[10px] text-error font-semibold px-1">Delete?</span>
                <Button
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending}
                  variant="destructive"
                  size="sm"
                  className="h-5 px-2 text-[10px] font-bold"
                >
                  Yes
                </Button>
                <Button
                  onClick={() => setConfirmingDelete(false)}
                  variant="outline"
                  size="sm"
                  className="h-5 px-2 text-[10px] border-error/20 text-error hover:bg-error/5"
                >
                  No
                </Button>
              </div>
            ) : (
              <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 w-7 p-0 flex items-center justify-center opacity-70 group-hover:opacity-100 hover:border-accent/40"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="12" cy="12" r="1" />
                      <circle cx="12" cy="5" r="1" />
                      <circle cx="12" cy="19" r="1" />
                    </svg>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[140px]">
                  <DropdownMenuItem onClick={onSelect}>Manage</DropdownMenuItem>
                  {workspaces.filter((w) => w.key !== currentProjectKey).length > 0 && (
                    <DropdownMenuItem onClick={() => setMoving(true)}>Move</DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onClick={() => onExport(memory)}
                    disabled={memory.category !== "configs"}
                    className={memory.category !== "configs" ? "opacity-50 cursor-not-allowed" : ""}
                  >
                    Export
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => archiveMutation.mutate()} className="text-amber-600">
                    📦 Archive (recoverable)
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setConfirmingDelete(true)}
                    variant="destructive"
                    className="text-red-600"
                  >
                    🗑️ Delete (permanent)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
