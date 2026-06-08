import { useState } from "react";
import type { Memory } from "~/db/schema";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "~/components/ui/dialog";
import { Label, Select } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { compileRulesContent, downloadFile } from "~/lib/memoryExport";

type TargetFile =
  | "CLAUDE.md"
  | ".cursorrules"
  | ".github/copilot-instructions.md"
  | "GEMINI.md"
  | "AGENTS.md"
  | ".agents/rules/rules.md";

export function ExportMemoryModal({
  memory,
  allMemories,
  onClose,
}: {
  memory: Memory;
  allMemories: Memory[];
  onClose: () => void;
}) {
  const [exportScope, setExportScope] = useState<"single" | "all">("single");
  const [targetFile, setTargetFile] = useState<TargetFile>("CLAUDE.md");

  const handleDownload = () => {
    const content = compileRulesContent({ scope: exportScope, memory, allMemories, targetFile });
    const mimeType = targetFile === ".cursorrules" ? "application/json" : "text/markdown";
    downloadFile(content, targetFile, mimeType);
    onClose();
  };

  return (
    <Dialog open={true} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span aria-hidden="true">📥</span> Export Memory Rule
          </DialogTitle>
          <DialogDescription>
            Compile your memory vaults into structured configurations compatible with AI clients.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 py-2">
          <div className="flex flex-col gap-3">
            <Label>Export Scope</Label>
            <div className="flex flex-col gap-2">
              <label
                className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-all bg-surface hover:bg-surface2 ${
                  exportScope === "single" ? "border-accent ring-1 ring-accent/15" : "border-border"
                }`}
              >
                <input
                  type="radio"
                  name="exportScope"
                  checked={exportScope === "single"}
                  onChange={() => setExportScope("single")}
                  className="mt-1 accent-accent"
                />
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-text">Just this memory</span>
                  <span className="text-[10px] text-text-muted mt-1 max-w-[380px] truncate">
                    "{memory.fact}"
                  </span>
                </div>
              </label>

              <label
                className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-all bg-surface hover:bg-surface2 ${
                  exportScope === "all" ? "border-accent ring-1 ring-accent/15" : "border-border"
                }`}
              >
                <input
                  type="radio"
                  name="exportScope"
                  checked={exportScope === "all"}
                  onChange={() => setExportScope("all")}
                  className="mt-1 accent-accent"
                />
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-text">All active rules in this workspace</span>
                  <span className="text-[10px] text-text-muted mt-1">
                    Compiles active stack rules and tagged architectural memories.
                  </span>
                </div>
              </label>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="target-format">Target File Format</Label>
            <Select
              id="target-format"
              value={targetFile}
              onChange={(e) => setTargetFile(e.target.value as TargetFile)}
            >
              <option value="CLAUDE.md">CLAUDE.md (Claude Desktop/CLI)</option>
              <option value=".cursorrules">.cursorrules (Cursor)</option>
              <option value=".github/copilot-instructions.md">copilot-instructions.md (GitHub Copilot)</option>
              <option value="GEMINI.md">GEMINI.md (Gemini)</option>
              <option value="AGENTS.md">AGENTS.md (Codex / General Agents)</option>
              <option value=".agents/rules/rules.md">rules.md (Antigravity Workspace)</option>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleDownload}>Download Rules</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
