import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useCallback, useEffect, useRef } from "react";
import { batchImportMemories, parseMemoriesWithAI, compareImportedMemories, executeImportActions } from "~/server/memoryFunctions";
import type { ImportComparisonItem, ComparisonStatus } from "~/types/importTypes";
import { TEMPLATES } from "~/lib/templates";
import { PageContainer } from "~/components/PageContainer";
import { PageHeader } from "~/components/PageHeader";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Select, Input } from "~/components/ui/input";

export const Route = createFileRoute("/import")({
  component: ImportPage,
});

function CopyIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

type Chatbot = {
  id: string;
  label: string;
  color: string;
  url: string;
  deeplinkUrl?: (prompt: string) => string;
  prompt: string;
};

const CHATBOTS: Chatbot[] = [
  {
    id: "chatgpt",
    label: "ChatGPT",
    color: "#10a37f",
    url: "https://chatgpt.com/",
    prompt: `Export everything stored in your Memory about me, as well as any Custom Instructions. I want three sections:

**Section 1 — Saved Memories (explicit entries)**
List every discrete entry from your saved memory store — the entries visible in Settings > Personalization > Manage Memories. Output each one verbatim, exactly as stored, one per line. Do not paraphrase, merge, or omit any entry.

**Section 2 — Custom Instructions**
List any text or rules currently stored in your Custom Instructions ("What would you like ChatGPT to know about you to provide better responses?" and "How would you like ChatGPT to respond?").

**Section 3 — Chat History Inferences (implicit layer)**
List any additional facts, preferences, or context you have inferred about me from past conversations that are NOT in your saved memories or custom instructions. One fact per line.

Format each line as:
[YYYY-MM-DD] - Entry content here.
Use [unknown] if no date is available.

Output ONLY the three sections. No intro, no sign-off, no commentary. After the sections, state how many saved memory entries were listed and whether the list is complete.`,
  },
  {
    id: "claude",
    label: "Claude",
    color: "#d4956a",
    url: "https://claude.ai/new",
    prompt: `Export everything from your stored memory (the entries visible in your Settings > Capabilities > Memory settings panel) and any context you've learned about me from past conversations. Preserve my words verbatim where possible, especially for instructions and preferences.

## Categories (output in this order):

1. **Instructions**: Rules I've explicitly asked you to follow going forward — tone, format, style, "always do X", "never do Y", and corrections to your behavior. Only include rules from stored memories, not from conversations.

2. **Identity**: Name, age, location, education, family, relationships, languages, and personal interests.

3. **Career**: Current and past roles, companies, and general skill areas.

4. **Projects**: Projects I meaningfully built or committed to. Ideally ONE entry per project. Include what it does, current status, and any key decisions. Use the project name or a short descriptor as the first words of the entry.

5. **Preferences**: Opinions, tastes, and working-style preferences that apply broadly.

## Format:

Use section headers for each category. Within each category, list one entry per line, sorted by oldest date first. Format each line as:

[YYYY-MM-DD] - Entry content here.

If no date is known, use [unknown] instead.

## Output:
- Wrap the entire export in a single code block for easy copying.
- After the code block, state whether this is the complete set or if more remain.`,
  },
  {
    id: "perplexity",
    label: "Perplexity",
    color: "#20b2aa",
    url: "https://www.perplexity.ai/",
    deeplinkUrl: (p: string) => `https://www.perplexity.ai/search?q=${encodeURIComponent(p)}`,
    prompt: `Export everything stored in your memory about me (specifically the entries visible in Settings > Personalization > Manage saved memories) and any custom context from your "Introduce yourself" personalization settings.

List every discrete entry verbatim, exactly as stored, one per line. Do not paraphrase, summarize, group, or omit anything.

Format each line as:
[YYYY-MM-DD] - Entry content here.
Use [unknown] if no date is available.

End with a count of how many entries were listed and confirm whether the list is complete.`,
  },
  {
    id: "gemini",
    label: "Gemini",
    color: "#4285f4",
    url: "https://gemini.google.com/app",
    prompt: `Export everything from your stored memory/saved info (the entries visible in your Settings > Saved info settings panel) and any context you have learned about me from past conversations.

## Categories (output in this order):

1. **Instructions**: Rules I've explicitly asked you to follow going forward — tone, format, style, "always do X", "never do Y", and behavior corrections.
2. **Identity & Demographics**: Preferred names, location, education, relationships, and personal interests.
3. **Career**: Current and past roles, companies, and general skill areas.
4. **Projects**: Projects I build or work on. Include what it does, current status, and any key details.
5. **Preferences**: Opinions, tastes, and working-style preferences.

## Format:
Use section headers for each category. Within each category, list one entry per line. Format each line as:
[YYYY-MM-DD] - Entry content here.
If no date is known, use [unknown] instead.

## Output:
- Wrap the entire export in a single code block for easy copying.
- After the code block, complete the sentence "Imported from: Gemini". This must be the absolute final text in your response.`,
  },
  {
    id: "grok",
    label: "Grok",
    color: "#e7e7e7",
    url: "https://grok.com/",
    prompt: `Export everything stored in your persistent memory about me. List every discrete memory entry exactly as stored — the entries visible in Settings > Data Controls (on grok.com) or Settings > Privacy & Safety > Grok (on x.com). One entry per line, verbatim. Do not paraphrase, summarize, merge, or omit any entry.

Format each line as:
[YYYY-MM-DD] - Entry content here.
Use [unknown] if no date is available.

Output ONLY the memory entries. No intro, no sign-off, no commentary. End with a count of entries listed and confirm whether this is the complete set.`,
  },
  {
    id: "copilot",
    label: "Copilot",
    color: "#00a1f1",
    url: "https://copilot.microsoft.com/",
    prompt: `Export everything stored in your Memory about me, as well as any Custom Instructions. List every discrete entry from your saved memory store — the entries visible in Settings > Privacy > Personalization and memory (or click on your profile picture and select Memory). Output each one verbatim, exactly as stored, one per line. Do not paraphrase, merge, or omit any entry.

Format each line as:
[YYYY-MM-DD] - Entry content here.
Use [unknown] if no date is available.

Output ONLY the memory entries and instructions. No intro, no sign-off, no commentary. End with a count of how many entries were listed and whether the list is complete.`,
  },
];

function PromptPanel() {
  const [selectedBot, setSelectedBot] = useState<string>("chatgpt");
  const [copied, setCopied] = useState(false);

  const bot = CHATBOTS.find((b) => b.id === selectedBot) ?? CHATBOTS[0];

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(bot.prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [bot.prompt]);

  const handleOpen = useCallback(async () => {
    if (bot.deeplinkUrl) {
      window.open(bot.deeplinkUrl(bot.prompt), "_blank", "noopener,noreferrer");
    } else {
      await navigator.clipboard.writeText(bot.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      window.open(bot.url, "_blank", "noopener,noreferrer");
    }
  }, [bot]);

  return (
    <div className="bg-linear-to-br from-accent/3 to-accent/1 border border-accent/10 rounded-2xl overflow-hidden shadow-xs">
      <div className="px-5 py-4 border-b border-accent/10 flex flex-wrap items-center gap-2.5 bg-accent/3 select-none">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <span className="font-semibold text-sm text-text">Step 1 — Get your memories out</span>
        <span className="text-text-muted text-xs md:ml-auto">
          Copy a prompt to pull memories out of each chatbot
        </span>
      </div>

      <div className="p-5 flex flex-col gap-4">
        <div>
          <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-2">
            Chatbot
          </div>
          <div className="flex gap-2 flex-wrap select-none">
            {CHATBOTS.map((b) => {
              const active = selectedBot === b.id;
              return (
                <button
                  key={b.id}
                  onClick={() => { setSelectedBot(b.id); setCopied(false); }}
                  className={`px-4.5 py-1.5 rounded-full text-xs font-semibold transition-all border cursor-pointer ${
                    active 
                      ? "" 
                      : "bg-surface2 border-border text-text-muted hover:text-text hover:border-text-muted/30"
                  }`}
                  style={active ? { backgroundColor: `${b.color}15`, borderColor: b.color, color: b.color } : undefined}
                >
                  {b.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="bg-surface2 border border-border rounded-xl p-4 font-mono text-xs text-text whitespace-pre-wrap break-words leading-relaxed max-h-[240px] overflow-y-auto no-scrollbar">
          {bot.prompt}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <span className="text-xs text-text-muted leading-relaxed select-none">
            {bot.deeplinkUrl
              ? `Opens ${bot.label} with the prompt pre-filled`
              : `Copies prompt then opens ${bot.label} — just paste and send`}
          </span>
          <div className="flex gap-2.5 flex-shrink-0 select-none">
            <Button
              onClick={handleCopy}
              variant="outline"
              className={`h-9 px-4 font-bold text-xs select-none gap-1.5 transition-all ${
                copied 
                  ? "border-success/40 bg-success/15 text-success hover:bg-success/25 hover:border-success/50" 
                  : "hover:border-accent/40 hover:text-accent"
              }`}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
              {copied ? "Copied!" : "Copy Prompt"}
            </Button>
            <Button
              onClick={handleOpen}
              className="h-9 px-4 font-bold text-xs select-none gap-1.5 transition-all"
              style={{ backgroundColor: `${bot.color}15`, borderColor: `${bot.color}30`, color: bot.color }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              Open {bot.label}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function IngestPanel() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [inputMode, setInputMode] = useState<"paste" | "file" | "templates">("paste");
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [templateSelection, setTemplateSelection] = useState<Array<{ fact: string; category?: string; tags?: string }> | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  // Comparisons states
  const [comparisons, setComparisons] = useState<ImportComparisonItem[] | null>(null);
  const [activeTab, setActiveTab] = useState<ComparisonStatus | "all">("new");
  const [resolvedActions, setResolvedActions] = useState<Record<string, "import" | "skip" | "update" | "archive_and_import" | "exclude">>({});

  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; details?: string } | null>(null);
  const [source, setSource] = useState<string>("manual");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const comparisonsRef = useRef<HTMLDivElement>(null);

  async function handleFileRead(file: File) {
    setParseError(null);
    setComparisons(null);
    setResolvedActions({});
    setImportResult(null);

    const text = await file.text();
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";

    let contentToProcess = text;

    if (ext === "json") {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          if (typeof parsed[0] === "string") {
            contentToProcess = parsed.join("\n");
          } else if (parsed[0] && typeof parsed[0] === "object") {
            const items = parsed.map((item: any) => item.fact || item.content || JSON.stringify(item)).join("\n");
            contentToProcess = items;
          }
        }
      } catch {
        contentToProcess = text;
      }
    }

    setPasteText(contentToProcess);
    setInputMode("paste");
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0];
    if (file) {
      handleFileRead(file);
    }
  }

  const executeMutation = useMutation({
    mutationFn: ({ items, source }: { items: Array<{ fact: string; category: "rules" | "projects" | "references"; tags: string; action: "import" | "skip" | "update" | "archive_and_import" | "exclude"; matchedMemoryId?: string }>; source: string }) =>
      executeImportActions({ data: { items, source } }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["memories"] });
      setPasteText("");
      setComparisons(null);
      setResolvedActions({});
      setParseError(null);

      const importedCount = result.imported;
      const skippedCount = result.skipped;
      const updatedCount = result.updated;
      const archivedCount = result.archived;

      setImportResult({
        imported: importedCount + updatedCount,
        skipped: skippedCount,
        details: `Imported: ${importedCount} new. Updated: ${updatedCount}. Archived: ${archivedCount}. Skipped: ${skippedCount}.`
      });
      setTimeout(() => setImportResult(null), 10000);
    },
    onError: (error) => {
      setParseError((error as Error).message || "Import failed");
    },
  });

  async function handleProcess() {
    setParseError(null);
    setComparisons(null);
    setResolvedActions({});
    setImportResult(null);
    if (!pasteText.trim()) return;
    setParsing(true);
    try {
      const items = await parseMemoriesWithAI({ data: { text: pasteText } });
      if (items.length === 0) {
        setParseError("No memories could be extracted. Try adding more content.");
        setParsing(false);
        return;
      }
      
      const comparisonItems = await compareImportedMemories({ data: { items } });
      setComparisons(comparisonItems);
      
      const initialActions: Record<string, "import" | "skip" | "update" | "archive_and_import" | "exclude"> = {};
      comparisonItems.forEach((item) => {
        if (item.status === "new") {
          initialActions[item.tempId] = "import";
        } else if (item.status === "duplicate") {
          initialActions[item.tempId] = "skip";
        } else if (item.status === "update") {
          initialActions[item.tempId] = "update";
        } else if (item.status === "contradiction") {
          initialActions[item.tempId] = "archive_and_import";
        }
      });
      setResolvedActions(initialActions);
      
      // Select the first tab that has elements
      const tabsOrder: Array<ComparisonStatus> = ["new", "update", "contradiction", "duplicate"];
      const firstNonEmptyTab = tabsOrder.find(t => comparisonItems.some(item => item.status === t)) || "new";
      setActiveTab(firstNonEmptyTab);
    } catch (e) {
      setParseError((e as Error).message);
    } finally {
      setParsing(false);
    }
  }

  function handleImport() {
    if (!comparisons) return;

    const itemsToExecute = comparisons
      .filter(item => resolvedActions[item.tempId] !== "exclude")
      .map((item) => {
        const category = (item.category === "rules" || item.category === "projects" || item.category === "references")
          ? item.category
          : "references";
        return {
          fact: item.fact,
          category,
          tags: item.tags || "",
          action: resolvedActions[item.tempId] || "exclude",
          matchedMemoryId: item.matchedMemory?.id,
        };
      });

    if (itemsToExecute.length === 0) {
      alert("No items selected for import");
      return;
    }

    executeMutation.mutate({ items: itemsToExecute, source });
  }

  // Count items under each category
  const countNew = comparisons?.filter(c => c.status === "new").length ?? 0;
  const countUpdates = comparisons?.filter(c => c.status === "update").length ?? 0;
  const countContradictions = comparisons?.filter(c => c.status === "contradiction").length ?? 0;
  const countDuplicates = comparisons?.filter(c => c.status === "duplicate").length ?? 0;

  const filteredItems = comparisons 
    ? comparisons.map((item, idx) => ({ item, originalIndex: idx })).filter(({ item }) => activeTab === "all" || item.status === activeTab) 
    : [];

  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden shadow-xs">
      <div className="px-5 py-4 border-b border-border flex flex-wrap items-center gap-2.5 bg-surface2 select-none">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
          <path d="M12 5v14M5 12l7 7 7-7" />
        </svg>
        <span className="font-semibold text-sm text-text">Step 2 — Paste & import</span>
        <span className="text-text-muted text-xs md:ml-auto">
          Paste the chatbot output — AI extracts and compares memories
        </span>
      </div>

      <div className="p-5 flex flex-col gap-3">
        <div className="flex gap-1 border-b border-border overflow-x-auto no-scrollbar select-none mb-3">
          {(["paste", "file", "templates"] as const).map((mode) => {
            const labels = { paste: "Paste Text", file: "Upload File", templates: "Templates" };
            const active = inputMode === mode;
            return (
              <button
                key={mode}
                onClick={() => setInputMode(mode)}
                className={`px-4 py-2.5 text-xs md:text-sm font-semibold border-b-2 whitespace-nowrap transition-colors -mb-[1px] rounded-t-md hover:bg-surface2/40 uppercase tracking-wider text-[11px] cursor-pointer ${
                  active 
                    ? "border-accent text-accent bg-surface" 
                    : "border-transparent text-text-muted hover:text-text"
                }`}
              >
                {labels[mode]}
              </button>
            );
          })}
        </div>

        {inputMode === "paste" && (
          <textarea
            value={pasteText}
            onChange={(e) => { setPasteText(e.target.value); setParseError(null); setComparisons(null); setImportResult(null); }}
            placeholder="Paste anything — chatbot memory exports, free-form text, structured or unstructured output. AI will extract and compare them with existing memories."
            rows={8}
            maxLength={16000}
            className="w-full bg-surface2 text-text border border-border rounded-xl p-3.5 text-xs font-mono placeholder:text-text-muted focus:outline-hidden focus:border-accent focus:ring-1 focus:ring-accent leading-relaxed resize-y"
          />
        )}

        {inputMode === "file" && (
          <div 
            className="py-12 px-6 text-center border-2 border-dashed border-border hover:border-accent/40 bg-accent/3 hover:bg-accent/5 rounded-2xl cursor-pointer transition-all flex flex-col items-center justify-center gap-3.5 select-none"
            onClick={() => fileInputRef.current?.click()}
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent opacity-70">
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
            <p className="margin-0 font-medium text-xs md:text-sm text-text-muted">
              Click to upload or drag a <strong className="text-text font-bold">.json, .txt, or .md</strong> file
            </p>
            <p className="margin-0 text-[10px] text-text-muted">
              Supports ChatGPT/Claude export formats
            </p>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.txt,.md"
          onChange={handleFileInputChange}
          className="hidden"
        />

        {inputMode === "paste" && (
          <div className="flex justify-end select-none">
            <span className={`text-[10px] font-bold uppercase tracking-wider ${pasteText.length >= 16000 ? "text-error" : "text-text-muted"}`}>
              {pasteText.length.toLocaleString()} / 16,000 characters
            </span>
          </div>
        )}

        {inputMode === "templates" && !selectedTemplate && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 select-none">
            {TEMPLATES.map((template) => (
              <div
                key={template.id}
                onClick={() => {
                  setSelectedTemplate(template.id);
                  setTemplateSelection([...template.items]);
                }}
                className="p-4 bg-surface2 border border-border hover:border-accent rounded-xl cursor-pointer transition-all hover:-translate-y-0.5 shadow-3xs"
              >
                <div className="text-xs md:text-sm font-bold text-text mb-1">{template.title}</div>
                <div className="text-[11px] text-text-muted mb-3 leading-relaxed">{template.description}</div>
                <div className="text-[10px] text-accent font-bold uppercase tracking-wider">
                  {template.items.length} item{template.items.length !== 1 ? "s" : ""}
                </div>
              </div>
            ))}
          </div>
        )}

        {inputMode === "templates" && selectedTemplate && templateSelection && (
          <div className="flex flex-col gap-3">
            <div className="flex justify-between items-center select-none gap-4">
              <Button
                onClick={() => {
                  setSelectedTemplate(null);
                  setTemplateSelection(null);
                }}
                variant="outline"
                className="h-8 text-xs font-semibold"
              >
                ← Back
              </Button>
              <strong className="text-accent text-xs font-bold uppercase tracking-wider">Review & Import</strong>
              <span className="text-xs text-text-muted font-medium">{templateSelection.length} memor{templateSelection.length !== 1 ? "ies" : "y"}</span>
            </div>
            <div className="border border-accent/15 bg-accent/2 rounded-xl max-h-[320px] overflow-y-auto no-scrollbar p-1.5 flex flex-col gap-2">
              {templateSelection.map((item, idx) => (
                <div
                  key={idx}
                  className="p-3 bg-surface border border-border rounded-xl flex flex-col gap-1.5 shadow-3xs"
                >
                  <div className="text-xs text-text font-medium leading-relaxed">{item.fact}</div>
                  {item.category && (
                    <div className="flex flex-wrap items-center gap-1.5 mt-0.5 select-none">
                      <Badge variant={item.category as any} className="h-4 text-[9px] px-1.5 py-0">{item.category}</Badge>
                      {item.tags && (
                        <span className="text-[10px] text-text-muted bg-tag-bg border border-tag-border px-1.5 rounded-sm font-mono leading-none">
                          {item.tags}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <Button
              onClick={async () => {
                if (templateSelection.length > 0) {
                  setSelectedTemplate(null);
                  setTemplateSelection(null);
                  setParseError(null);
                  setComparisons(null);
                  setResolvedActions({});
                  try {
                    const formatted = templateSelection.map(t => ({ fact: t.fact, category: t.category, tags: t.tags }));
                    const res = await compareImportedMemories({ data: { items: formatted } });
                    if (res.length === 0) {
                      setParseError("No valid memories found in templates.");
                      return;
                    }
                    setComparisons(res);
                    const initialActions: Record<string, "import" | "skip" | "update" | "archive_and_import" | "exclude"> = {};
                    res.forEach((item) => {
                      if (item.status === "new") {
                        initialActions[item.tempId] = "import";
                      } else if (item.status === "duplicate") {
                        initialActions[item.tempId] = "skip";
                      } else if (item.status === "update") {
                        initialActions[item.tempId] = "update";
                      } else if (item.status === "contradiction") {
                        initialActions[item.tempId] = "archive_and_import";
                      }
                    });
                    setResolvedActions(initialActions);
                    setActiveTab("new");
                    setTimeout(() => comparisonsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
                  } catch (err) {
                    setParseError((err as Error).message || "Failed to analyze templates");
                  }
                }
              }}
              className="h-9 px-4 font-bold text-xs select-none w-fit mt-1"
            >
              Analyze {templateSelection.length} Blueprints
            </Button>
          </div>
        )}

        {parseError && (
          <div className="p-3 bg-error/10 border border-error/20 rounded-xl text-error text-xs font-medium select-none">
            {parseError}
          </div>
        )}

        {comparisons && (
          <div ref={comparisonsRef} className="flex flex-col gap-3">
            <div className="flex justify-between items-center select-none gap-4">
              <strong className="text-accent text-xs font-bold uppercase tracking-wider">Review & Edit Comparisons</strong>
              <span className="text-xs text-text-muted font-medium">{comparisons.length} extracted memory fact{comparisons.length !== 1 ? "s" : ""}</span>
            </div>

            {/* Tabbed View */}
            <div className="flex gap-1 border-b border-border overflow-x-auto no-scrollbar select-none mb-2 bg-surface2/30 p-1 rounded-t-xl">
              {[
                { key: "new", label: "New", count: countNew, badgeStyle: "bg-success/15 text-success" },
                { key: "update", label: "Updates", count: countUpdates, badgeStyle: "bg-amber-500/15 text-amber-600" },
                { key: "contradiction", label: "Contradictions", count: countContradictions, badgeStyle: "bg-rose-500/15 text-rose-600" },
                { key: "duplicate", label: "Duplicates", count: countDuplicates, badgeStyle: "bg-surface2 border border-border text-text-muted" },
                { key: "all", label: "All", count: comparisons.length, badgeStyle: "bg-accent/15 text-accent" },
              ].map((tab) => {
                const active = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key as any)}
                    className={`px-4 py-2.5 text-xs md:text-sm font-semibold border-b-2 whitespace-nowrap transition-colors -mb-[1px] rounded-t-md hover:bg-surface2/40 uppercase tracking-wider text-[11px] cursor-pointer flex items-center gap-2 ${
                      active 
                        ? "border-accent text-accent bg-surface shadow-2xs font-bold" 
                        : "border-transparent text-text-muted hover:text-text"
                    }`}
                  >
                    {tab.label}
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${tab.badgeStyle}`}>
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Comparisons List */}
            <div className="border border-accent/15 bg-accent/2 rounded-xl max-h-[420px] overflow-y-auto no-scrollbar p-2 flex flex-col gap-3">
              {filteredItems.length === 0 ? (
                <div className="py-12 text-center text-text-muted text-xs font-semibold select-none bg-surface border border-border rounded-xl">
                  No memories in this category.
                </div>
              ) : (
                filteredItems.map(({ item, originalIndex }) => {
                  const action = resolvedActions[item.tempId];
                  const isExcluded = action === "exclude";

                  return (
                    <div
                      key={item.tempId}
                      className={`p-4 bg-surface border rounded-xl flex flex-col gap-3.5 shadow-xs transition-all ${
                        isExcluded ? "opacity-60 border-border bg-surface/50" : "border-border hover:border-accent/30"
                      }`}
                    >
                      {item.status === "new" && (
                        <div className="flex justify-between items-center gap-4 select-none">
                          <span className="text-[9px] font-bold text-success uppercase tracking-wider bg-success/10 px-2.5 py-1 rounded-full border border-success/20">New Memory</span>
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => setResolvedActions(prev => ({ ...prev, [item.tempId]: "import" }))}
                              className={`h-7 px-3 text-[10px] font-bold uppercase tracking-wider rounded-md border cursor-pointer transition-colors ${
                                action === "import"
                                  ? "bg-success border-success text-white"
                                  : "bg-surface border-border text-text hover:bg-surface2"
                              }`}
                            >
                              Import
                            </button>
                            <button
                              onClick={() => setResolvedActions(prev => ({ ...prev, [item.tempId]: "exclude" }))}
                              className={`h-7 px-3 text-[10px] font-bold uppercase tracking-wider rounded-md border cursor-pointer transition-colors ${
                                action === "exclude"
                                  ? "bg-error border-error text-white"
                                  : "bg-surface border-border text-text hover:bg-error/5 hover:border-error/25 hover:text-error"
                              }`}
                            >
                              Exclude
                            </button>
                          </div>
                        </div>
                      )}

                      {item.status === "duplicate" && (
                        <div className="flex flex-col gap-2">
                          <div className="flex justify-between items-center select-none gap-4">
                            <span className="text-[9px] font-bold text-text-muted uppercase tracking-wider bg-surface2 border border-border px-2.5 py-1 rounded-full">Duplicate</span>
                            <div className="flex gap-1.5">
                              <button
                                onClick={() => setResolvedActions(prev => ({ ...prev, [item.tempId]: "skip" }))}
                                className={`h-7 px-3 text-[10px] font-bold uppercase tracking-wider rounded-md border cursor-pointer transition-colors ${
                                  action === "skip"
                                    ? "bg-accent border-accent text-white"
                                    : "bg-surface border-border text-text hover:bg-surface2"
                                }`}
                              >
                                Skip & Link Source
                              </button>
                              <button
                                onClick={() => setResolvedActions(prev => ({ ...prev, [item.tempId]: "import" }))}
                                className={`h-7 px-3 text-[10px] font-bold uppercase tracking-wider rounded-md border cursor-pointer transition-colors ${
                                  action === "import"
                                    ? "bg-success border-success text-white"
                                    : "bg-surface border-border text-text hover:bg-surface2"
                                }`}
                              >
                                Import Anyway
                              </button>
                              <button
                                onClick={() => setResolvedActions(prev => ({ ...prev, [item.tempId]: "exclude" }))}
                                className={`h-7 px-3 text-[10px] font-bold uppercase tracking-wider rounded-md border cursor-pointer transition-colors ${
                                  action === "exclude"
                                    ? "bg-error border-error text-white"
                                    : "bg-surface border-border text-text hover:bg-error/5 hover:border-error/25 hover:text-error"
                                }`}
                              >
                                Exclude
                              </button>
                            </div>
                          </div>
                          {item.matchedMemory && (
                            <div className="bg-surface2/60 border border-border rounded-xl p-3 text-xs leading-relaxed flex flex-col gap-1 select-none">
                              <div className="text-[9px] font-bold text-text-muted uppercase tracking-wider">Existing Memory Match:</div>
                              <div className="text-text-muted font-medium line-through decoration-text-muted/50">{item.matchedMemory.fact}</div>
                              {item.reason && <div className="text-[10px] text-text-muted italic mt-1 bg-surface3/40 px-2 py-1 rounded-md">{item.reason}</div>}
                            </div>
                          )}
                        </div>
                      )}

                      {item.status === "update" && (
                        <div className="flex flex-col gap-2">
                          <div className="flex justify-between items-center select-none gap-4">
                            <span className="text-[9px] font-bold text-amber-500 uppercase tracking-wider bg-amber-500/10 px-2.5 py-1 rounded-full border border-amber-500/20">Update Candidate</span>
                            <div className="flex gap-1.5">
                              <button
                                onClick={() => setResolvedActions(prev => ({ ...prev, [item.tempId]: "update" }))}
                                className={`h-7 px-3 text-[10px] font-bold uppercase tracking-wider rounded-md border cursor-pointer transition-colors ${
                                  action === "update"
                                    ? "bg-amber-500 border-amber-500 text-white"
                                    : "bg-surface border-border text-text hover:bg-surface2"
                                }`}
                              >
                                Update Existing
                              </button>
                              <button
                                onClick={() => setResolvedActions(prev => ({ ...prev, [item.tempId]: "import" }))}
                                className={`h-7 px-3 text-[10px] font-bold uppercase tracking-wider rounded-md border cursor-pointer transition-colors ${
                                  action === "import"
                                    ? "bg-success border-success text-white"
                                    : "bg-surface border-border text-text hover:bg-surface2"
                                }`}
                              >
                                Keep Both
                              </button>
                              <button
                                onClick={() => setResolvedActions(prev => ({ ...prev, [item.tempId]: "exclude" }))}
                                className={`h-7 px-3 text-[10px] font-bold uppercase tracking-wider rounded-md border cursor-pointer transition-colors ${
                                  action === "exclude"
                                    ? "bg-error border-error text-white"
                                    : "bg-surface border-border text-text hover:bg-error/5 hover:border-error/25 hover:text-error"
                                }`}
                              >
                                Keep Old Only
                              </button>
                            </div>
                          </div>
                          {item.matchedMemory && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-1 select-none">
                              <div className="bg-rose-500/4 border border-rose-500/10 rounded-xl p-3 text-xs leading-relaxed flex flex-col gap-1.5 shadow-4xs">
                                <div className="text-[9px] font-bold text-rose-500 uppercase tracking-wider flex items-center gap-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500" /> Existing (AS IS)
                                </div>
                                <div className="text-text-muted line-through decoration-rose-500/20">{item.matchedMemory.fact}</div>
                              </div>
                              <div className="bg-success/4 border border-success/10 rounded-xl p-3 text-xs leading-relaxed flex flex-col gap-1.5 shadow-4xs">
                                <div className="text-[9px] font-bold text-success uppercase tracking-wider flex items-center gap-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full bg-success" /> Proposed Update
                                </div>
                                <div className="text-text font-semibold">{item.fact}</div>
                              </div>
                            </div>
                          )}
                          {item.reason && <div className="text-[10px] text-text-muted italic select-none bg-surface3/40 px-2.5 py-1.5 rounded-md mt-1">{item.reason}</div>}
                        </div>
                      )}

                      {item.status === "contradiction" && (
                        <div className="flex flex-col gap-2">
                          <div className="flex justify-between items-center select-none gap-4">
                            <span className="text-[9px] font-bold text-rose-500 uppercase tracking-wider bg-rose-500/10 px-2.5 py-1 rounded-full border border-rose-500/20">Contradiction</span>
                            <div className="flex gap-1.5">
                              <button
                                onClick={() => setResolvedActions(prev => ({ ...prev, [item.tempId]: "archive_and_import" }))}
                                className={`h-7 px-3 text-[10px] font-bold uppercase tracking-wider rounded-md border cursor-pointer transition-colors ${
                                  action === "archive_and_import"
                                    ? "bg-rose-500 border-rose-500 text-white"
                                    : "bg-surface border-border text-text hover:bg-surface2"
                                }`}
                              >
                                Archive Old & Add New
                              </button>
                              <button
                                onClick={() => setResolvedActions(prev => ({ ...prev, [item.tempId]: "import" }))}
                                className={`h-7 px-3 text-[10px] font-bold uppercase tracking-wider rounded-md border cursor-pointer transition-colors ${
                                  action === "import"
                                    ? "bg-success border-success text-white"
                                    : "bg-surface border-border text-text hover:bg-surface2"
                                }`}
                              >
                                Keep Both
                              </button>
                              <button
                                onClick={() => setResolvedActions(prev => ({ ...prev, [item.tempId]: "exclude" }))}
                                className={`h-7 px-3 text-[10px] font-bold uppercase tracking-wider rounded-md border cursor-pointer transition-colors ${
                                  action === "exclude"
                                    ? "bg-error border-error text-white"
                                    : "bg-surface border-border text-text hover:bg-error/5 hover:border-error/25 hover:text-error"
                                }`}
                              >
                                Keep Old Only
                              </button>
                            </div>
                          </div>
                          {item.matchedMemory && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-1 select-none">
                              <div className="bg-rose-500/4 border border-rose-500/10 rounded-xl p-3 text-xs leading-relaxed flex flex-col gap-1.5 shadow-4xs">
                                <div className="text-[9px] font-bold text-rose-500 uppercase tracking-wider flex items-center gap-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500" /> Existing Obsolete Memory
                                </div>
                                <div className="text-text-muted line-through decoration-rose-500/20">{item.matchedMemory.fact}</div>
                              </div>
                              <div className="bg-success/4 border border-success/10 rounded-xl p-3 text-xs leading-relaxed flex flex-col gap-1.5 shadow-4xs">
                                <div className="text-[9px] font-bold text-success uppercase tracking-wider flex items-center gap-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full bg-success" /> New Facts
                                </div>
                                <div className="text-text font-semibold">{item.fact}</div>
                              </div>
                            </div>
                          )}
                          {item.reason && <div className="text-[10px] text-text-muted italic select-none bg-surface3/40 px-2.5 py-1.5 rounded-md mt-1">{item.reason}</div>}
                        </div>
                      )}

                      {/* Inputs to edit fields */}
                      <div className="flex flex-col gap-3 pt-3 border-t border-border/60">
                        <div className="flex gap-3 items-start justify-between">
                          <div className="flex-1">
                            <Input
                              type="text"
                              disabled={isExcluded}
                              value={item.fact}
                              onChange={(e) => {
                                const updated = [...comparisons!];
                                updated[originalIndex] = { ...updated[originalIndex], fact: e.target.value };
                                setComparisons(updated);
                              }}
                              className="h-8.5 text-xs font-semibold"
                            />
                          </div>
                          <button
                            onClick={() => {
                              const updated = comparisons.filter((_, i) => i !== originalIndex);
                              setComparisons(updated);
                            }}
                            className="h-8.5 px-3 rounded-md text-[10px] font-bold uppercase tracking-wider border border-error/20 bg-error/5 text-error hover:bg-error/15 cursor-pointer flex items-center justify-center transition-colors select-none"
                          >
                            Delete
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-3 select-none">
                          <div>
                            <Input
                              type="text"
                              disabled={isExcluded}
                              placeholder="Category (optional)"
                              value={item.category || ""}
                              onChange={(e) => {
                                const updated = [...comparisons!];
                                updated[originalIndex] = { ...updated[originalIndex], category: (e.target.value || "references") as any };
                                setComparisons(updated);
                              }}
                              className="h-8 text-[11px] font-semibold"
                            />
                          </div>
                          <div>
                            <Input
                              type="text"
                              disabled={isExcluded}
                              placeholder="Tags (optional, comma-separated)"
                              value={item.tags || ""}
                              onChange={(e) => {
                                const updated = [...comparisons!];
                                updated[originalIndex] = { ...updated[originalIndex], tags: e.target.value || undefined };
                                setComparisons(updated);
                              }}
                              className="h-8 text-[11px] font-semibold"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {executeMutation.isError && (
          <div className="p-3 bg-error/10 border border-error/20 rounded-xl text-error text-xs font-medium select-none">
            Import failed: {(executeMutation.error as Error).message}
          </div>
        )}

        {importResult && (
          <div className="p-4 bg-success/15 border border-success/30 rounded-2xl text-success text-xs font-semibold select-none flex flex-col md:flex-row md:items-center justify-between gap-3 mt-2 shadow-sm animate-fade-in">
            <div className="flex flex-col gap-0.5">
              <span className="font-bold text-sm">Import Complete!</span>
              <span className="text-text-muted font-medium mt-0.5">
                {importResult.details || `Processed memories successfully.`}
              </span>
            </div>
            <div className="flex gap-2.5 items-center flex-shrink-0 self-end md:self-auto">
              <Button
                onClick={() => navigate({ to: "/" })}
                variant="outline"
                className="h-8 px-4 text-xs border-success/30 bg-success/5 text-success hover:bg-success/15 hover:border-success/45 font-bold rounded-lg shadow-3xs"
              >
                View memories →
              </Button>
              <button onClick={() => setImportResult(null)} className="text-success hover:opacity-100 opacity-70 font-semibold text-lg cursor-pointer px-1.5 py-0.5">×</button>
            </div>
          </div>
        )}

        <div className="flex gap-3 flex-wrap items-center mt-3 select-none">
          <Button
            onClick={handleProcess}
            disabled={!pasteText.trim() || parsing || executeMutation.isPending}
            variant="outline"
            className="h-9 px-4 font-bold text-xs select-none hover:border-accent/40 hover:text-accent"
          >
            {parsing ? "Analyzing context…" : "Extract & Compare Memories"}
          </Button>
          {comparisons && (
            <Button
              onClick={handleImport}
              disabled={executeMutation.isPending}
              className="h-9 px-4 font-bold text-xs select-none"
            >
              {executeMutation.isPending ? "Executing Actions…" : `Apply Import Actions (${comparisons.filter(c => resolvedActions[c.tempId] !== "exclude").length} items)`}
            </Button>
          )}

          <div className="ml-auto flex items-center gap-2">
            <label className="text-xs text-text-muted font-semibold whitespace-nowrap">Source Provider:</label>
            <Select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="h-8 text-xs font-semibold px-2 cursor-pointer min-w-[110px]"
            >
              <option value="chatgpt">ChatGPT</option>
              <option value="claude">Claude</option>
              <option value="perplexity">Perplexity</option>
              <option value="gemini">Gemini</option>
              <option value="grok">Grok</option>
              <option value="copilot">Copilot</option>
              <option value="manual">Manual</option>
            </Select>
          </div>
        </div>
      </div>
    </div>
  );
}

function ImportPage() {
  return (
    <div className="flex-grow min-h-screen bg-background">
      <PageHeader
        title="Import"
        icon={
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12l7 7 7-7" />
          </svg>
        }
        description="Pull your memories out of ChatGPT, Claude, Gemini, Grok, Perplexity, or Copilot — then paste the output to import them into Locker."
      />

      <PageContainer>
        <div className="flex flex-col gap-6">
          <PromptPanel />
          <IngestPanel />
        </div>
      </PageContainer>
    </div>
  );
}
