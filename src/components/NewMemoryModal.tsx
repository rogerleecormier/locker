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

  const singleMutation = useMutation({
    mutationFn: () =>
      addMemory({
        data: {
          fact,
          category,
          tags,
          projectKey: singleLocker === "personal" ? undefined : singleLocker,
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
