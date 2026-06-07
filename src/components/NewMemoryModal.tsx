import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addMemory,
  getUserWorkspaces,
} from "~/server/memoryFunctions";
import { Button } from "./ui/button";
import { cn } from "~/lib/utils";
import { Label, Input, Textarea, Select } from "./ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";

interface NewMemoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  projectKey?: string;
  onOpenAgentConfigBuilder?: () => void;
}


export function NewMemoryModal({ isOpen, onClose, onSaved, projectKey, onOpenAgentConfigBuilder }: NewMemoryModalProps) {
  const queryClient = useQueryClient();

  const { data: workspacesList = [] } = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => getUserWorkspaces(),
    enabled: isOpen,
  });
  const workspaces = Array.isArray(workspacesList) ? workspacesList : [];

  // Wizard state
  const [step, setStep] = React.useState<1 | 2>(1);
  const [mode, setMode] = React.useState<"single" | null>(null);

  // Path A: Single Memory
  const [fact, setFact] = React.useState("");
  const [category, setCategory] = React.useState<"rules" | "projects" | "references">("references");
  const [tags, setTags] = React.useState("");
  const [singleLocker, setSingleLocker] = React.useState(projectKey || "personal");

  // Advanced (org admin only)
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const [isAuthoritative, setIsAuthoritative] = React.useState(false);
  const [isLocked, setIsLocked] = React.useState(false);

  const isOrgAdmin = React.useMemo(
    () => workspaces.some((w: any) => w.type === "org" && (w.role === "admin" || w.role === "owner")),
    [workspaces]
  );

  const singleMutation = useMutation({
    mutationFn: () =>
      addMemory({
        data: {
          fact,
          category,
          tags,
          projectKey: singleLocker === "personal" ? undefined : singleLocker,
          ...(isOrgAdmin && isAuthoritative ? { authorityType: "authoritative" as const } : {}),
          ...(isOrgAdmin && isLocked ? { isLocked: true } : {}),
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memories"] });
      onSaved();
      onClose();
    },
  });

  const resetModal = () => {
    setStep(1);
    setMode(null);
    setFact("");
    setTags("");
    setShowAdvanced(false);
    setIsAuthoritative(false);
    setIsLocked(false);
  };

  const modalWidthClass = React.useMemo(() => {
    if (step === 1) return "max-w-[680px]";
    return "max-w-[580px]";
  }, [step]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) { resetModal(); onClose(); } }}>
      <DialogContent className={cn("duration-300", modalWidthClass)}>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>New Memory</DialogTitle>
          </div>
          <DialogDescription>
            Commit facts, rules, or system configuration directly to your vault.
          </DialogDescription>
        </DialogHeader>

        {/* STEP 1: Route Path Choice */}
        {step === 1 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
            <button
              onClick={() => {
                setMode("single");
                setStep(2);
              }}
              className="flex flex-col gap-2 p-5 text-left border border-border bg-surface2 hover:bg-surface-hover hover:border-accent rounded-xl transition-all cursor-pointer select-none group"
            >
              <span className="text-2xl group-hover:scale-110 duration-200 self-start">📝</span>
              <span className="font-bold text-sm text-text">Commit Single Fact</span>
              <span className="text-xs text-text-muted leading-relaxed">
                Add a specific rule, project detail, database credentials layout, or quick reference fact manually.
              </span>
            </button>

            <button
              onClick={() => {
                resetModal();
                onClose();
                onOpenAgentConfigBuilder?.();
              }}
              className="flex flex-col gap-2 p-5 text-left border border-border bg-surface2 hover:bg-surface-hover hover:border-accent rounded-xl transition-all cursor-pointer select-none group"
            >
              <span className="text-2xl group-hover:scale-110 duration-200 self-start">⚡</span>
              <span className="font-bold text-sm text-text">Agent Config Builder</span>
              <span className="text-xs text-text-muted leading-relaxed">
                Build a structured agent configuration with system prompt, tech stack, and coding rules — committed under the protected configs category.
              </span>
            </button>
          </div>
        )}

        {/* STEP 2: Single Fact Form */}
        {step === 2 && mode === "single" && (
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="fact-content">Memory Fact Content</Label>
              <Textarea
                id="fact-content"
                rows={4}
                value={fact}
                onChange={(e) => setFact(e.target.value)}
                placeholder="e.g. Prefers using TypeScript interface configurations for API response typing..."
                className="resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="fact-category">Category</Label>
                <Select
                  id="fact-category"
                  value={category}
                  onChange={(e: any) => setCategory(e.target.value)}
                >
                  <option value="rules">Rules</option>
                  <option value="projects">Projects</option>
                  <option value="references">References</option>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="fact-locker">Locker Workspace</Label>
                <Select
                  id="fact-locker"
                  value={singleLocker}
                  onChange={(e) => setSingleLocker(e.target.value)}
                >
                  <option value="personal">Personal Vault</option>
                  {workspaces.map((w) => (
                    <option key={w.key} value={w.key}>
                      {w.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="fact-tags">Tags (comma separated)</Label>
              <Input
                id="fact-tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="e.g. typescript, standards, backend"
              />
            </div>

            {isOrgAdmin && (
              <div className="flex flex-col gap-2 border border-border rounded-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="flex items-center justify-between w-full px-3 py-2 text-xs font-semibold text-text-muted hover:text-text hover:bg-surface2 transition-colors select-none"
                >
                  <span className="flex items-center gap-1.5">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14" />
                    </svg>
                    Advanced (Org Admin)
                  </span>
                  <svg
                    width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                    className={`transition-transform duration-200 ${showAdvanced ? "rotate-180" : ""}`}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {showAdvanced && (
                  <div className="flex flex-col gap-3 px-3 pb-3 pt-1 bg-surface2/50 border-t border-border">
                    <label className="flex items-start gap-3 cursor-pointer group select-none">
                      <input
                        type="checkbox"
                        checked={isAuthoritative}
                        onChange={(e) => setIsAuthoritative(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded-sm border-border text-amber-500 accent-amber-500 cursor-pointer"
                      />
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs font-semibold text-text group-hover:text-amber-500 transition-colors flex items-center gap-1.5">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="text-amber-500 shrink-0">
                            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                          </svg>
                          Mark as Authoritative
                        </span>
                        <span className="text-[10px] text-text-muted leading-relaxed">
                          Authoritative memories take precedence in AI context ranking (RRF scoring).
                        </span>
                      </div>
                    </label>
                    <label className="flex items-start gap-3 cursor-pointer group select-none">
                      <input
                        type="checkbox"
                        checked={isLocked}
                        onChange={(e) => setIsLocked(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded-sm border-border text-accent accent-accent cursor-pointer"
                      />
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs font-semibold text-text group-hover:text-accent transition-colors flex items-center gap-1.5">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                          </svg>
                          Lock this memory
                        </span>
                        <span className="text-[10px] text-text-muted leading-relaxed">
                          Locked memories can only be edited or deleted by org admins.
                        </span>
                      </div>
                    </label>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-between items-center mt-4 pt-4 border-t border-border">
              <Button variant="ghost" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button
                onClick={() => singleMutation.mutate()}
                disabled={singleMutation.isPending || !fact.trim()}
              >
                {singleMutation.isPending ? "Saving..." : "Commit Memory"}
              </Button>
            </div>
          </div>
        )}

      </DialogContent>
    </Dialog>
  );
}
