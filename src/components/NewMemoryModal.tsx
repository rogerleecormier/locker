import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addMemory,
  getUserWorkspaces,
  listMemoryTemplates,
  createMemoryTemplate,
  analyzeProjectRequirements,
  generateStackRecommendation,
} from "~/server/memoryFunctions";
import { Button } from "./ui/button";
import { cn } from "~/lib/utils";
import { Badge } from "./ui/badge";
import { Label, Input, Textarea, Select } from "./ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";

interface NewMemoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  projectKey?: string;
}

const PRESET_ARCHETYPES = [
  {
    name: "Cloudflare Edge",
    description: "TS + TanStack + Edge + D1 + R2 + Vectorize + Drizzle",
    preferences: {
      language: "TypeScript",
      frontend: "React / TanStack",
      hosting: "Cloudflare Edge",
      database: "Cloudflare D1",
      storage: "Cloudflare R2",
      search: "None",
      vector: "Cloudflare Vectorize",
      componentLibrary: "None",
      orm: "Drizzle ORM",
      auth: "Better Auth",
      styling: "Vanilla CSS",
      stateCache: "TanStack Store",
      bannedProviders: [] as string[],
    },
  },
  {
    name: "AWS Serverless",
    description: "TS + React + Lambda + Aurora PG + S3 + Pinecone + Prisma",
    preferences: {
      language: "TypeScript",
      frontend: "React / TanStack",
      hosting: "AWS Lambda",
      database: "Aurora PostgreSQL",
      storage: "AWS S3",
      search: "None",
      vector: "Pinecone",
      componentLibrary: "None",
      orm: "Prisma",
      auth: "Clerk",
      styling: "Tailwind CSS",
      stateCache: "Zustand",
      bannedProviders: [] as string[],
    },
  },
  {
    name: "Netlify Jamstack",
    description: "TS + Next.js + Netlify + Supabase + Vector + Kysely",
    preferences: {
      language: "TypeScript",
      frontend: "Next.js",
      hosting: "Netlify",
      database: "PostgreSQL",
      storage: "Supabase Storage",
      search: "None",
      vector: "Supabase Vector",
      componentLibrary: "None",
      orm: "Kysely",
      auth: "Supabase Auth",
      styling: "Tailwind CSS",
      stateCache: "React Context",
      bannedProviders: [] as string[],
    },
  },
];
import { FIELD_OPTIONS, DEFAULT_STACK_PREFERENCES } from "~/lib/stackFields";

function downloadFile(content: string, filename: string, contentType: string) {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function NewMemoryModal({ isOpen, onClose, onSaved, projectKey }: NewMemoryModalProps) {
  const queryClient = useQueryClient();

  const { data: workspaces = [] } = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => getUserWorkspaces(),
    enabled: isOpen,
  });

  const { data: templates = [] } = useQuery({
    queryKey: ["templates"],
    queryFn: () => listMemoryTemplates(),
    enabled: isOpen,
  });

  // Wizard state
  const [step, setStep] = React.useState<1 | 2 | 3 | 4>(1);
  const [mode, setMode] = React.useState<"single" | "stack" | null>(null);

  // Path A: Single Memory
  const [fact, setFact] = React.useState("");
  const [category, setCategory] = React.useState<"rules" | "projects" | "references" | "stack">("references");
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

  // Path B: Tech Stack Creator
  const [interviewPrompt, setInterviewPrompt] = React.useState("");
  const [analyzingPrompt, setAnalyzingPrompt] = React.useState(false);
  const [preferences, setPreferences] = React.useState({
    ...DEFAULT_STACK_PREFERENCES
  });

  const [recommendation, setRecommendation] = React.useState<{
    name: string;
    description: string;
    rules: string[];
  } | null>(null);
  const [generatingRecommendation, setGeneratingRecommendation] = React.useState(false);
  const [targetLocker, setTargetLocker] = React.useState(projectKey || "personal");
  const [savingStack, setSavingStack] = React.useState(false);
  const [stackError, setStackError] = React.useState("");

  // Merge Templates state
  const [selectedMergeTemplateIds, setSelectedMergeTemplateIds] = React.useState<string[]>([]);
  const [mergeVariables, setMergeVariables] = React.useState<Record<string, Record<string, string>>>({});

  // Save as template option
  const [saveAsTemplate, setSaveAsTemplate] = React.useState(false);
  const [templateName, setTemplateName] = React.useState("");
  const [templateDescription, setTemplateDescription] = React.useState("");

  // CLI Downloader format state
  const [cliFormat, setCliFormat] = React.useState<
    "CLAUDE.md" | ".cursorrules" | ".github/copilot-instructions.md" | ".codexrules" | ".antigravityrules" | ".geminirules"
  >(".cursorrules");

  const handleAnalyzePrompt = async () => {
    if (!interviewPrompt.trim()) return;
    setAnalyzingPrompt(true);
    try {
      const res = await analyzeProjectRequirements({ data: { description: interviewPrompt } });
      setPreferences({
        language: res.language || DEFAULT_STACK_PREFERENCES.language,
        frontend: res.frontend || DEFAULT_STACK_PREFERENCES.frontend,
        hosting: res.hosting || DEFAULT_STACK_PREFERENCES.hosting,
        database: res.database || DEFAULT_STACK_PREFERENCES.database,
        storage: res.storage || DEFAULT_STACK_PREFERENCES.storage,
        search: res.search || DEFAULT_STACK_PREFERENCES.search,
        vector: res.vector || DEFAULT_STACK_PREFERENCES.vector,
        componentLibrary: res.componentLibrary || DEFAULT_STACK_PREFERENCES.componentLibrary,
        orm: res.orm || DEFAULT_STACK_PREFERENCES.orm,
        auth: res.auth || DEFAULT_STACK_PREFERENCES.auth,
        styling: res.styling || DEFAULT_STACK_PREFERENCES.styling,
        stateCache: res.stateCache || DEFAULT_STACK_PREFERENCES.stateCache,
        bannedProviders: res.bannedProviders || DEFAULT_STACK_PREFERENCES.bannedProviders,
      });
      setRecommendation(null);
    } catch (e) {
      alert("Failed to analyze requirements: " + String(e));
    } finally {
      setAnalyzingPrompt(false);
    }
  };

  const handleGenerateRecommendation = async () => {
    setGeneratingRecommendation(true);
    setStackError("");
    try {
      const res = await generateStackRecommendation({ data: preferences });
      setRecommendation(res);
      setStep(3);
    } catch (e) {
      setStackError("Failed to generate stack recommendation: " + String(e));
    } finally {
      setGeneratingRecommendation(false);
    }
  };

  const nonStackTemplates = React.useMemo(() => {
    return templates.filter((t) => t.category !== "stack");
  }, [templates]);

  const mergedRules = React.useMemo(() => {
    if (!recommendation) return [];
    const list = [...recommendation.rules];

    selectedMergeTemplateIds.forEach((tmplId) => {
      const tmpl = templates.find((t) => t.id === tmplId);
      if (!tmpl) return;
      try {
        const payload = JSON.parse(tmpl.configPayload);
        const tmplRules = payload.rules || [];
        const vars = mergeVariables[tmplId] || {};

        tmplRules.forEach((rule: string) => {
          let finalRule = rule;
          Object.entries(vars).forEach(([k, v]) => {
            finalRule = finalRule.replaceAll(`{{${k}}}`, v);
          });
          list.push(finalRule);
        });
      } catch (e) {
        console.error(e);
      }
    });

    return list;
  }, [recommendation, selectedMergeTemplateIds, templates, mergeVariables]);

  const handleSaveStack = async () => {
    if (!recommendation) return;
    setSavingStack(true);
    setStackError("");
    try {
      const factText = `# ${recommendation.name}\n${recommendation.description}\n\n## Stack Preferences:\n- Language: ${preferences.language}\n- Frontend: ${preferences.frontend}\n- Hosting: ${preferences.hosting}\n- Database: ${preferences.database}\n- ORM/DB Access: ${preferences.orm}\n- Authentication: ${preferences.auth}\n- Styling: ${preferences.styling}\n- State/Cache: ${preferences.stateCache}\n- Storage: ${preferences.storage}\n- Search Index: ${preferences.search}\n- Vector Database: ${preferences.vector}\n- Component Library: ${preferences.componentLibrary}\n- Banned Providers: ${preferences.bannedProviders.join(", ") || "None"}\n\n## Architectural Rules:\n${mergedRules.map((r) => `- ${r}`).join("\n")}`;

      await addMemory({
        data: {
          fact: factText,
          category: "stack",
          tags: "stack,blueprint",
          projectKey: targetLocker === "personal" ? undefined : targetLocker,
        },
      });

      if (saveAsTemplate) {
        await createMemoryTemplate({
          data: {
            name: templateName.trim() || recommendation.name,
            description: templateDescription.trim() || recommendation.description,
            category: "stack",
            configPayload: JSON.stringify({
              ...preferences,
              rules: recommendation.rules,
              variables: [],
            }),
          },
        });
        queryClient.invalidateQueries({ queryKey: ["templates"] });
      }

      queryClient.invalidateQueries({ queryKey: ["memories"] });
      onSaved();
      setStep(4);
    } catch (e) {
      setStackError("Failed to save tech stack: " + String(e));
    } finally {
      setSavingStack(false);
    }
  };

  const toggleBannedProvider = (p: string) => {
    setPreferences((prev) => {
      const list = prev.bannedProviders.includes(p)
        ? prev.bannedProviders.filter((item) => item !== p)
        : [...prev.bannedProviders, p];
      return { ...prev, bannedProviders: list };
    });
    setRecommendation(null);
  };

  const handleDownloadConfig = (
    format: "CLAUDE.md" | ".cursorrules" | ".github/copilot-instructions.md" | ".codexrules" | ".antigravityrules" | ".geminirules"
  ) => {
    if (!recommendation) return;
    let content = "";
    const mimeType = format === ".cursorrules" ? "application/json" : "text/markdown";

    if (format === ".cursorrules") {
      content = JSON.stringify(
        {
          name: recommendation.name,
          description: recommendation.description,
          globs: ["*"],
          rules: mergedRules,
        },
        null,
        2
      );
    } else {
      let title = "Developer Agent Rules";
      let section = "Guidelines";
      if (format === "CLAUDE.md") {
        title = "Claude System Instructions";
        section = "Enforced Guidelines";
      } else if (format === ".github/copilot-instructions.md") {
        title = "Copilot Instructions";
        section = "Rules";
      } else if (format === ".geminirules") {
        title = "Gemini Rules";
        section = "Coding Guidelines";
      } else if (format === ".antigravityrules") {
        title = "Antigravity Rules";
        section = "Guidelines";
      } else if (format === ".codexrules") {
        title = "Codex Rules";
        section = "Rules";
      }

      const sectionHeader = mergedRules.length > 0 ? `## ${section}\n${mergedRules.map((r) => `- ${r}`).join("\n")}\n\n` : "";

      content = `# ${title} - Technical Stack Blueprint\n\nThis blueprint specifies the architectural boundaries, tech stack enforcements, and directory mapping rules for developer agents working in this repository.\n\n${sectionHeader}---\n*Generated by Locker at: ${new Date().toLocaleString()}*\n`;
    }

    downloadFile(content, format, mimeType);
  };

  const resetModal = () => {
    setStep(1);
    setMode(null);
    setFact("");
    setTags("");
    setInterviewPrompt("");
    setRecommendation(null);
    setSelectedMergeTemplateIds([]);
    setMergeVariables({});
    setSaveAsTemplate(false);
  };

  const modalWidthClass = React.useMemo(() => {
    if (mode === "stack" && (step === 2 || step === 3)) return "max-w-[940px]";
    if (step === 1) return "max-w-[680px]";
    return "max-w-[580px]";
  }, [mode, step]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) { resetModal(); onClose(); } }}>
      <DialogContent className={cn("duration-300", modalWidthClass)}>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>
              {mode === "stack" ? "Tech Stack Creator" : "New Memory"}
            </DialogTitle>
            {mode === "stack" && (
              <Badge variant="accent" className="font-bold tracking-normal normal-case">
                Step {step} of 4
              </Badge>
            )}
          </div>
          <DialogDescription>
            {mode === "stack"
              ? "Prefill archetypes, customize constraints, and download agent config files."
              : "Commit facts, rules, or system configuration directly to your vault."}
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
                setMode("stack");
                setStep(2);
              }}
              className="flex flex-col gap-2 p-5 text-left border border-border bg-surface2 hover:bg-surface-hover hover:border-accent rounded-xl transition-all cursor-pointer select-none group"
            >
              <span className="text-2xl group-hover:scale-110 duration-200 self-start">⚡</span>
              <span className="font-bold text-sm text-text">Tech Stack Creator</span>
              <span className="text-xs text-text-muted leading-relaxed">
                Provide project descriptions to prefills, compile frameworks constraints, and build custom agent configs.
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
                  <option value="stack">Stack</option>
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

        {/* STEP 2: Stack Settings Wizard */}
        {step === 2 && mode === "stack" && (
          <div className="flex flex-col gap-5 py-2">
            {/* Presets & Custom Blueprints */}
            <div className="bg-surface2 border border-border rounded-xl p-4 flex flex-col gap-4">
              <div>
                <span className="text-xs font-bold text-accent uppercase tracking-wider block mb-2.5">
                  Load Presets Archetypes
                </span>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {PRESET_ARCHETYPES.map((arch) => (
                    <div
                      key={arch.name}
                      onClick={() => {
                        setPreferences({ ...arch.preferences });
                        setRecommendation(null);
                      }}
                      className="flex flex-col p-3 rounded-lg border border-border bg-surface hover:border-accent transition-all cursor-pointer"
                    >
                      <span className="text-xs font-bold text-text mb-1">{arch.name}</span>
                      <span className="text-[10px] text-text-muted leading-relaxed">
                        {arch.description}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {templates.filter((t) => t.category === "stack").length > 0 && (
                <div>
                  <span className="text-xs font-bold text-accent uppercase tracking-wider block mb-2.5">
                    Load Custom Stack Blueprints
                  </span>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {templates
                      .filter((t) => t.category === "stack")
                      .map((tmpl) => (
                        <div
                          key={tmpl.id}
                          onClick={() => {
                            try {
                              const payload = JSON.parse(tmpl.configPayload);
                              setPreferences({
                                language: payload.language || DEFAULT_STACK_PREFERENCES.language,
                                frontend: payload.frontend || DEFAULT_STACK_PREFERENCES.frontend,
                                hosting: payload.hosting || DEFAULT_STACK_PREFERENCES.hosting,
                                database: payload.database || DEFAULT_STACK_PREFERENCES.database,
                                storage: payload.storage || DEFAULT_STACK_PREFERENCES.storage,
                                search: payload.search || DEFAULT_STACK_PREFERENCES.search,
                                vector: payload.vector || DEFAULT_STACK_PREFERENCES.vector,
                                componentLibrary: payload.componentLibrary || DEFAULT_STACK_PREFERENCES.componentLibrary,
                                orm: payload.orm || DEFAULT_STACK_PREFERENCES.orm,
                                auth: payload.auth || DEFAULT_STACK_PREFERENCES.auth,
                                styling: payload.styling || DEFAULT_STACK_PREFERENCES.styling,
                                stateCache: payload.stateCache || DEFAULT_STACK_PREFERENCES.stateCache,
                                bannedProviders: payload.bannedProviders || DEFAULT_STACK_PREFERENCES.bannedProviders,
                              });

                              if (payload.rules && payload.rules.length > 0) {
                                setRecommendation({
                                  name: tmpl.name,
                                  description: tmpl.description,
                                  rules: payload.rules,
                                });
                              } else {
                                setRecommendation(null);
                              }
                            } catch (e) {
                              console.error("Failed to parse custom blueprint template payload:", e);
                            }
                          }}
                          className="flex flex-col p-3 rounded-lg border border-border bg-surface hover:border-accent transition-all cursor-pointer relative group"
                        >
                          <span className="text-xs font-bold text-text mb-1 flex items-center justify-between gap-2">
                            <span>{tmpl.name}</span>
                            <span className="text-[9px] bg-accent/10 text-accent font-semibold px-1 rounded-sm border border-accent/20">Saved</span>
                          </span>
                          <span className="text-[10px] text-text-muted leading-relaxed">
                            {tmpl.description}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>

            {/* Prompt interview */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="stack-prompt">AI Requirements Helper</Label>
              <div className="flex gap-2">
                <Input
                  id="stack-prompt"
                  value={interviewPrompt}
                  onChange={(e) => setInterviewPrompt(e.target.value)}
                  placeholder="Describe your requirements (e.g. 'Build a secure API server using Python & FastAPI hosted on Azure...')"
                  className="flex-1"
                />
                <Button
                  onClick={handleAnalyzePrompt}
                  disabled={analyzingPrompt || !interviewPrompt.trim()}
                  variant="outline"
                >
                  {analyzingPrompt ? "Analyzing..." : "Analyze"}
                </Button>
              </div>
            </div>

            {/* Selects Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Object.keys(FIELD_OPTIONS).map((key) => (
                <div key={key} className="flex flex-col gap-1.5">
                  <Label htmlFor={`stack-${key}`} className="capitalize">
                    {key}
                  </Label>
                  <Select
                    id={`stack-${key}`}
                    value={(preferences as any)[key] || "None"}
                    onChange={(e) => {
                      setPreferences({ ...preferences, [key]: e.target.value });
                      setRecommendation(null);
                    }}
                  >
                    {FIELD_OPTIONS[key].map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>

            {/* Target Locker */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="stack-target-locker">Commit target workspace</Label>
              <Select
                id="stack-target-locker"
                value={targetLocker}
                onChange={(e) => setTargetLocker(e.target.value)}
                className="max-w-[280px]"
              >
                <option value="personal">Personal Vault</option>
                {workspaces.map((w) => (
                  <option key={w.key} value={w.key}>
                    {w.label}
                  </option>
                ))}
              </Select>
            </div>

            {/* Footer */}
            <div className="flex justify-between items-center mt-4 pt-4 border-t border-border">
              <Button variant="ghost" onClick={() => setStep(1)}>
                Back
              </Button>
              <div className="flex gap-2">
                {recommendation && (
                  <Button
                    onClick={() => setStep(3)}
                    variant="outline"
                  >
                    Use Loaded Template Rules →
                  </Button>
                )}
                <Button
                  onClick={handleGenerateRecommendation}
                  disabled={generatingRecommendation}
                >
                  {generatingRecommendation ? "Compiling Stack Constraints..." : "Compile Stack Guidelines →"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: Stack Recommendations & Merging */}
        {step === 3 && mode === "stack" && recommendation && (
          <div className="flex flex-col gap-4 py-2 max-h-[60vh] overflow-y-auto pr-1">
            <div className="bg-accent-dim border border-accent/25 rounded-xl p-4">
              <h4 className="text-sm font-bold text-accent mb-1">{recommendation.name}</h4>
              <p className="text-xs text-text-muted leading-relaxed">{recommendation.description}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Rules List */}
              <div className="flex flex-col gap-2">
                <span className="text-xs font-semibold text-text uppercase tracking-wider mb-1">
                  Compiled Architecture Guidelines
                </span>
                <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto bg-surface2 border border-border p-3 rounded-lg no-scrollbar">
                  {mergedRules.map((rule, i) => (
                    <div key={i} className="text-xs text-text-muted leading-relaxed border-b border-border/40 pb-2 last:border-0 last:pb-0">
                      • {rule}
                    </div>
                  ))}
                </div>
              </div>

              {/* Merge Templates option */}
              <div className="flex flex-col gap-3">
                <span className="text-xs font-semibold text-text uppercase tracking-wider">
                  Merge Additional Blueprints
                </span>
                {nonStackTemplates.length === 0 ? (
                  <p className="text-xs text-text-muted">No custom governance templates stored.</p>
                ) : (
                  <div className="flex flex-col gap-2.5 max-h-[300px] overflow-y-auto no-scrollbar pr-1">
                    {nonStackTemplates.map((tmpl) => {
                      const isMerged = selectedMergeTemplateIds.includes(tmpl.id);
                      return (
                        <div key={tmpl.id} className="flex flex-col border border-border p-2.5 rounded-lg bg-surface2">
                          <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={isMerged}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedMergeTemplateIds([...selectedMergeTemplateIds, tmpl.id]);
                                } else {
                                  setSelectedMergeTemplateIds(selectedMergeTemplateIds.filter((id) => id !== tmpl.id));
                                }
                              }}
                              className="cursor-pointer accent-accent"
                            />
                            <span className="text-xs font-bold text-text">{tmpl.name}</span>
                          </label>
                          
                          {/* Variables inputs if merged */}
                          {isMerged && (() => {
                            let tmplVars: any[] = [];
                            try {
                              tmplVars = JSON.parse(tmpl.configPayload).variables || [];
                            } catch {}
                            if (tmplVars.length === 0) return null;
                            return (
                              <div className="mt-2.5 border-t border-border pt-2.5 flex flex-col gap-2">
                                {tmplVars.map((v) => (
                                  <div key={v.key} className="flex flex-col gap-1">
                                    <Label className="text-[9px] uppercase font-bold tracking-wider">{v.key}</Label>
                                    <Input
                                      size={1}
                                      value={mergeVariables[tmpl.id]?.[v.key] ?? v.default}
                                      onChange={(e) => {
                                        const oldVars = mergeVariables[tmpl.id] || {};
                                        setMergeVariables({
                                          ...mergeVariables,
                                          [tmpl.id]: {
                                            ...oldVars,
                                            [v.key]: e.target.value,
                                          },
                                        });
                                      }}
                                      className="h-7 text-xs"
                                    />
                                  </div>
                                ))}
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Template options */}
            <div className="border-t border-border pt-4 mt-2 flex flex-col gap-3">
              <label className="flex items-center gap-2 cursor-pointer select-none self-start">
                <input
                  type="checkbox"
                  checked={saveAsTemplate}
                  onChange={(e) => setSaveAsTemplate(e.target.checked)}
                  className="cursor-pointer accent-accent"
                />
                <span className="text-xs font-bold text-text">Save compiled stack as template for future reuse</span>
              </label>

              {saveAsTemplate && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="tmpl-name">Template Name</Label>
                    <Input
                      id="tmpl-name"
                      value={templateName}
                      onChange={(e) => setTemplateName(e.target.value)}
                      placeholder={recommendation.name}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="tmpl-desc">Template Description</Label>
                    <Input
                      id="tmpl-desc"
                      value={templateDescription}
                      onChange={(e) => setTemplateDescription(e.target.value)}
                      placeholder={recommendation.description}
                    />
                  </div>
                </div>
              )}
            </div>

            {stackError && <p className="text-xs text-error font-semibold mt-2">{stackError}</p>}

            {/* Footer */}
            <div className="flex justify-between items-center mt-4 pt-4 border-t border-border">
              <Button variant="ghost" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button onClick={handleSaveStack} disabled={savingStack}>
                {savingStack ? "Saving Tech Stack..." : "Commit Tech Stack Blueprint"}
              </Button>
            </div>
          </div>
        )}

        {/* STEP 4: Success & CLI Downloader */}
        {step === 4 && recommendation && (
          <div className="flex flex-col gap-4 py-2 text-center items-center">
            <div className="w-12 h-12 rounded-full bg-success/15 border border-success/35 text-success flex items-center justify-center text-xl mb-2 select-none animate-bounce">
              ✓
            </div>
            <h3 className="text-base font-bold text-text">Tech Stack Vault Stored!</h3>
            <p className="text-xs text-text-muted leading-relaxed max-w-sm">
              Your architectural constraints have been stored and synced globally. You can now compile the local configuration file for your development agent.
            </p>

            <div className="w-full bg-surface2 border border-border rounded-xl p-4 mt-2 flex flex-col gap-3 text-left">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">
                  Agent File Compiler
                </span>
                <Select
                  value={cliFormat}
                  onChange={(e: any) => setCliFormat(e.target.value)}
                  className="h-8.5 max-w-[280px] min-w-[240px] w-fit cursor-pointer"
                >
                  <option value="CLAUDE.md">CLAUDE.md (Claude Desktop/CLI)</option>
                  <option value=".cursorrules">.cursorrules (Cursor)</option>
                  <option value=".github/copilot-instructions.md">copilot-instructions.md (GitHub Copilot)</option>
                  <option value=".codexrules">.codexrules (Codex)</option>
                  <option value=".antigravityrules">.antigravityrules (Antigravity)</option>
                  <option value=".geminirules">.geminirules (Gemini)</option>
                </Select>
              </div>
              <Button onClick={() => handleDownloadConfig(cliFormat)} className="w-full">
                Download {cliFormat === ".github/copilot-instructions.md" ? "copilot-instructions.md" : cliFormat} File
              </Button>
            </div>

            <Button onClick={() => { resetModal(); onClose(); }} variant="ghost" className="mt-4">
              Close Wizard
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
