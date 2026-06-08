import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "~/components/ui/toast";
import { getMemoryTimeline, revertMemoryVersion } from "~/server/memoryFunctions";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";

export function HistoryModal({
  memoryId,
  onClose,
  onReverted,
}: {
  memoryId: string;
  onClose: () => void;
  onReverted: () => void;
}) {
  const toast = useToast();
  const { data: versions = [], isLoading, isError } = useQuery({
    queryKey: ["memory-timeline", memoryId],
    queryFn: () => getMemoryTimeline({ data: { memoryId } }),
  });

  const queryClient = useQueryClient();

  const revertMutation = useMutation({
    mutationFn: (versionId: string) => revertMemoryVersion({ data: { versionId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memories"] });
      onReverted();
    },
    onError: (err) => {
      toast.error("Revert failed: " + String(err));
    },
  });

  return (
    <Dialog open={true} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-[600px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Version History</DialogTitle>
          <DialogDescription>
            Audit and restore historical modifications of this memory.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-4 py-2 my-2 no-scrollbar">
          {isLoading && <p className="text-text-muted text-center text-xs py-4">Loading history…</p>}
          {isError && <p className="text-error text-center text-xs py-4">Failed to load timeline.</p>}
          {!isLoading && !isError && versions.length === 0 && (
            <p className="text-text-muted text-center text-xs py-4">No history found.</p>
          )}

          {!isLoading && !isError && versions.map((v: any, index: number) => {
            const isLatest = index === 0;
            return (
              <div key={v.id} className="relative border-l-2 border-accent pl-5 pb-3 mb-2 last:mb-0">
                <div className="absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full bg-accent" />
                <div className="flex items-center justify-between gap-4 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] uppercase font-bold text-accent bg-tag-bg border border-tag-border px-1.5 py-0.5 rounded-sm">
                      {v.changeReason || "changed"}
                    </span>
                    {isLatest && <span className="text-xs text-text-muted italic">(Current)</span>}
                  </div>
                  <span className="text-[10px] text-text-muted font-medium">
                    {new Date(v.timestamp).toLocaleString()}
                  </span>
                </div>
                <p className="text-xs text-text mb-3 leading-relaxed break-words font-medium">
                  {v.fact}
                </p>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-1">
                    <span className="text-[9px] font-semibold bg-surface border border-border px-1.5 py-0.5 rounded-sm text-text-muted uppercase">
                      {v.category}
                    </span>
                    {(v.tags || "").split(",").map((t: string) => t.trim()).filter(Boolean).map((tag: string) => (
                      <span key={tag} className="text-[9px] bg-tag-bg border border-tag-border px-1.5 py-0.5 rounded-sm text-text-muted select-none">
                        {tag}
                      </span>
                    ))}
                  </div>
                  {!isLatest && (
                    <Button
                      onClick={() => revertMutation.mutate(v.id)}
                      disabled={revertMutation.isPending}
                      size="sm"
                      className="h-6 text-[10px] px-2.5 font-semibold"
                    >
                      {revertMutation.isPending ? "Reverting…" : "Revert"}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
