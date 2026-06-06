import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteMemory, moveMemories, archiveMemory } from "~/server/memoryFunctions";
import type { Memory } from "~/db/schema";
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
  onSelect,
}: MemoryCardProps) {
  const queryClient = useQueryClient();
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
      alert("Failed to move memory: " + err.message);
    },
  });

  const archiveMutation = useMutation({
    mutationFn: () => archiveMemory({ data: { id: memory.id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memories"] });
      queryClient.invalidateQueries({ queryKey: ["memories-archived"] });
    },
    onError: (err: Error) => {
      alert("Failed to archive memory: " + err.message);
    },
  });

  const tags = memory.tags
    ? memory.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];

  const lastAccessed = memory.lastAccessedAt
    ? Date.now() - memory.lastAccessedAt
    : Date.now() - memory.timestamp;
  const isStale = lastAccessed > 90 * 24 * 60 * 60 * 1000;

  return (
    <div
      onClick={onSelect}
      className={`group relative flex flex-col justify-between p-5 rounded-xl border bg-surface hover:bg-surface2 hover:-translate-y-1 hover:shadow-lg hover:shadow-accent/5 transition-all duration-200 cursor-pointer min-h-[220px] h-full box-border select-none ${
        memory.isQuarantined
          ? "border-red-500/40 hover:border-red-500/60 bg-red-500/3 hover:bg-red-500/5"
          : isSelected
            ? "border-accent ring-2 ring-accent/20 bg-accent/3"
            : "border-border hover:border-accent/35"
      }`}
    >
      <div>
        {/* Header */}
        <div
          className="flex justify-between items-center mb-3"
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
            className="cursor-pointer h-4 w-4 rounded-sm border-border text-accent focus:ring-accent accent-accent"
          />
          <div className="flex gap-2 items-center">
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
          <span className="text-[11px] text-text-muted font-medium select-none">
            {new Date(memory.timestamp).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>

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
              <DropdownMenu>
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
                <DropdownMenuContent align="end" className="w-[120px]">
                  <DropdownMenuItem onClick={onSelect}>Manage</DropdownMenuItem>
                  {workspaces.filter((w) => w.key !== currentProjectKey).length > 0 && (
                    <DropdownMenuItem onClick={() => setMoving(true)}>Move</DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => archiveMutation.mutate()}>
                    Archive
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => onExport(memory)}
                    disabled={memory.category !== "stack"}
                    className={memory.category !== "stack" ? "opacity-50 cursor-not-allowed" : ""}
                  >
                    Export
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => setConfirmingDelete(true)}
                    variant="destructive"
                  >
                    Delete
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
