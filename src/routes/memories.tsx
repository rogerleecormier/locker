import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { InfoTooltip } from "~/components/InfoTooltip";
import {
  getMemories,
  addMemory,
  deleteMemory,
  bulkDeleteMemories,
  updateMemory,
  getMemoryTimeline,
  revertMemoryVersion,
  getUserWorkspaces,
  moveMemories,
  getMemoryUsageStats,
  getArchivedMemories,
  archiveMemory,
  restoreMemory,
  permanentlyDeleteArchivedMemory,
  analyzeProjectRequirements,
  generateStackRecommendation,
  listMemoryTemplates,
  createMemoryTemplate,
} from "~/server/memoryFunctions";
import type { Memory, MemoryTemplate } from "~/db/schema";

export const Route = createFileRoute("/memories")({
  component: Dashboard,
});


const CATEGORY_LABELS: Record<string, string> = {
  rules: "Rules",
  projects: "Projects",
  references: "References",
  stack: "Stack",
};

const CATEGORY_COLORS: Record<string, string> = {
  rules: "#818cf8",
  projects: "#34d399",
  references: "#fbbf24",
  stack: "#a855f7",
};

function CategoryBadge({ category }: { category: string }) {
  const color = CATEGORY_COLORS[category] ?? "#7b80a0";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 20,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.04em",
        color,
        background: `${color}18`,
        border: `1px solid ${color}40`,
        textTransform: "uppercase",
      }}
    >
      {CATEGORY_LABELS[category] ?? category}
    </span>
  );
}

function TagChip({ tag }: { tag: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 7px",
        borderRadius: 4,
        fontSize: 11,
        background: "var(--tag-bg)",
        border: "1px solid var(--tag-border)",
        color: "var(--text-muted)",
        marginRight: 4,
        marginBottom: 2,
      }}
    >
      {tag}
    </span>
  );
}

function MemoryRow({
  memory,
  selected,
  onToggleSelect,
  onShowHistory,
  onExport,
  workspaces = [],
  currentProjectKey = "personal",
  isSelected = false,
  onSelect,
}: {
  memory: Memory;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onShowHistory: (id: string) => void;
  onExport: (memory: Memory) => void;
  workspaces?: any[];
  currentProjectKey?: string;
  isSelected?: boolean;
  onSelect?: () => void;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [moving, setMoving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [targetWorkspace, setTargetWorkspace] = useState("");

  const deleteMutation = useMutation({
    mutationFn: () => deleteMemory({ data: { id: memory.id } }),
    onMutate: () => {
      queryClient.setQueryData<Memory[]>(["memories"], (old) =>
        old ? old.filter((m) => m.id !== memory.id) : []
      );
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ["memories"] });
    },
  });

  const moveMutation = useMutation({
    mutationFn: () => moveMemories({ data: { ids: [memory.id], targetProjectKey: targetWorkspace } }),
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
    ? memory.tags.split(",").map((t) => t.trim()).filter(Boolean)
    : [];

  return (
    <div
      onClick={onSelect}
      className={`memory-item-card ${isSelected ? "selected" : ""}`}
    >
      <div>
        {/* Card Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }} onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => { e.stopPropagation(); onToggleSelect(memory.id); }}
            onClick={(e) => e.stopPropagation()}
            style={{ cursor: "pointer", accentColor: "var(--accent)" }}
          />
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <CategoryBadge category={memory.category} />
            {(() => {
              const STALE_MS = 90 * 24 * 60 * 60 * 1000;
              const lastAccessed = memory.lastAccessedAt ? Date.now() - memory.lastAccessedAt : Date.now() - memory.timestamp;
              const isStale = lastAccessed > STALE_MS;
              return isStale ? (
                <span style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "2px 6px",
                  background: "rgba(245, 158, 11, 0.15)",
                  color: "rgb(245, 158, 11)",
                  borderRadius: 3,
                  whiteSpace: "nowrap"
                }}>
                  Stale
                </span>
              ) : null;
            })()}
          </div>
        </div>

        {/* Fact Text */}
        <p className="memory-item-card-body">
          {memory.fact}
        </p>
      </div>

      {/* Card Footer */}
      <div>
        {tags.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 12 }} onClick={(e) => e.stopPropagation()}>
            {tags.map((tag) => (
              <TagChip key={tag} tag={tag} />
            ))}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }} onClick={(e) => e.stopPropagation()}>
          <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>
            {new Date(memory.timestamp).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>

          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            {moving ? (
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <select
                  value={targetWorkspace}
                  onChange={(e) => setTargetWorkspace(e.target.value)}
                  style={{ padding: "2px 4px", fontSize: 10, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: "var(--text)" }}
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
                <button
                  onClick={() => moveMutation.mutate()}
                  disabled={moveMutation.isPending || !targetWorkspace}
                  style={{ padding: "2px 6px", background: "var(--accent)", color: "#fff", fontSize: 10, borderRadius: "var(--radius)", fontWeight: 600 }}
                >
                  Go
                </button>
                <button
                  onClick={() => { setMoving(false); setTargetWorkspace(""); }}
                  style={{ padding: "2px 6px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 10, borderRadius: "var(--radius)" }}
                >
                  ✕
                </button>
              </div>
            ) : confirming ? (
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <span style={{ fontSize: 10, color: "var(--text-muted)" }}>Delete?</span>
                <button
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending}
                  style={{ padding: "2px 6px", background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.4)", color: "var(--error)", fontSize: 10, borderRadius: "var(--radius)", fontWeight: 600 }}
                >
                  Yes
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  style={{ padding: "2px 6px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 10, borderRadius: "var(--radius)" }}
                >
                  No
                </button>
              </div>
            ) : (
              <div style={{ position: "relative" }}>
                <button
                  onClick={() => setMenuOpen(!menuOpen)}
                  style={{
                    background: "transparent",
                    border: "1px solid var(--border)",
                    color: "var(--text-muted)",
                    padding: "3px 6px",
                    borderRadius: "var(--radius)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    transition: "all 0.15s",
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="1" />
                    <circle cx="12" cy="5" r="1" />
                    <circle cx="12" cy="19" r="1" />
                  </svg>
                </button>
                {menuOpen && (
                  <>
                    <div
                      onClick={() => setMenuOpen(false)}
                      style={{ position: "fixed", inset: 0, zIndex: 999, background: "transparent" }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        bottom: "100%",
                        right: 0,
                        marginBottom: 4,
                        background: "var(--surface2)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius)",
                        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                        padding: "4px 0",
                        minWidth: 110,
                        zIndex: 1000,
                        display: "flex",
                        flexDirection: "column",
                      }}
                    >
                      <button
                        onClick={() => { setMenuOpen(false); onSelect?.(); }}
                        style={{ background: "none", border: "none", color: "var(--text)", padding: "5px 10px", textAlign: "left", fontSize: 11, cursor: "pointer", width: "100%" }}
                      >
                        Manage
                      </button>
                      {workspaces.filter((w) => w.key !== currentProjectKey).length > 0 && (
                        <button
                          onClick={() => { setMenuOpen(false); setMoving(true); }}
                          style={{ background: "none", border: "none", color: "var(--text)", padding: "5px 10px", textAlign: "left", fontSize: 11, cursor: "pointer", width: "100%" }}
                        >
                          Move
                        </button>
                      )}
                      <button
                        onClick={() => { setMenuOpen(false); archiveMutation.mutate(); }}
                        style={{ background: "none", border: "none", color: "var(--text)", padding: "5px 10px", textAlign: "left", fontSize: 11, cursor: "pointer", width: "100%" }}
                      >
                        Archive
                      </button>
                      <button
                        onClick={() => { setMenuOpen(false); onExport(memory); }}
                        disabled={memory.category !== "stack"}
                        style={{ background: "none", border: "none", color: memory.category === "stack" ? "var(--text)" : "var(--text-muted)", padding: "5px 10px", textAlign: "left", fontSize: 11, cursor: memory.category === "stack" ? "pointer" : "default", width: "100%", opacity: memory.category === "stack" ? 1 : 0.5 }}
                      >
                        Export
                      </button>
                      <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
                      <button
                        onClick={() => { setMenuOpen(false); setConfirming(true); }}
                        style={{ background: "none", border: "none", color: "var(--error)", padding: "5px 10px", textAlign: "left", fontSize: 11, cursor: "pointer", width: "100%" }}
                      >
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function NewMemoryModal({
  onClose,
  onSaved,
  projectKey,
}: {
  onClose: () => void;
  onSaved: () => void;
  projectKey?: string;
}) {
  const queryClient = useQueryClient();

  // Workspaces query
  const { data: workspaces = [] } = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => getUserWorkspaces(),
  });

  // Templates query
  const { data: templates = [] } = useQuery({
    queryKey: ["templates"],
    queryFn: () => listMemoryTemplates(),
  });

  // Wizard state
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [mode, setMode] = useState<"single" | "stack" | null>(null);

  // Path A: Single Memory Fact
  const [fact, setFact] = useState("");
  const [category, setCategory] = useState<"rules" | "projects" | "references" | "stack">("references");
  const [tags, setTags] = useState("");
  const [singleLocker, setSingleLocker] = useState(projectKey || "personal");

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
    onSuccess: (newMemory) => {
      queryClient.invalidateQueries({ queryKey: ["memories"] });
      onSaved();
      onClose();
    },
  });

  // Path B: Tech Stack Creator
  const [interviewPrompt, setInterviewPrompt] = useState("");
  const [analyzingPrompt, setAnalyzingPrompt] = useState(false);
  const [preferences, setPreferences] = useState({
    language: "TypeScript",
    frontend: "React / TanStack",
    hosting: "Cloudflare Edge",
    database: "Cloudflare D1",
    storage: "Cloudflare R2",
    search: "Cloudflare Vectorize",
    orm: "Drizzle ORM",
    auth: "Better Auth",
    styling: "Vanilla CSS",
    stateCache: "TanStack Store",
    bannedProviders: [] as string[],
  });

  const [selectedTemplateId, setSelectedTemplateId] = useState("");

  const [recommendation, setRecommendation] = useState<{
    name: string;
    description: string;
    rules: string[];
  } | null>(null);
  const [generatingRecommendation, setGeneratingRecommendation] = useState(false);
  const [targetLocker, setTargetLocker] = useState(projectKey || "personal");
  const [syncOptions, setSyncOptions] = useState({
    claude: true,
    cursor: true,
    copilot: true,
    gemini: true,
    agents: true,
  });
  const [savingStack, setSavingStack] = useState(false);
  const [stackError, setStackError] = useState("");

  // Merge Templates state
  const [selectedMergeTemplateIds, setSelectedMergeTemplateIds] = useState<string[]>([]);
  const [mergeVariables, setMergeVariables] = useState<Record<string, Record<string, string>>>({});

  // Save as template option state
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");

  // CLI Downloader format state
  const [cliFormat, setCliFormat] = useState<"claude" | "cursor" | "copilot" | "gemini" | "agents">("cursor");

  // Preset list
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
        search: "Cloudflare Vectorize",
        orm: "Drizzle ORM",
        auth: "Better Auth",
        styling: "Vanilla CSS",
        stateCache: "TanStack Store",
        bannedProviders: [],
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
        search: "Pinecone",
        orm: "Prisma",
        auth: "Clerk",
        styling: "Tailwind CSS",
        stateCache: "Zustand",
        bannedProviders: [],
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
        search: "Supabase Vector",
        orm: "Kysely",
        auth: "Supabase Auth",
        styling: "Tailwind CSS",
        stateCache: "React Context",
        bannedProviders: [],
      },
    },
    {
      name: "Vercel Fullstack",
      description: "TS + Next.js + Vercel + PG + S3 + Pinecone + Prisma",
      preferences: {
        language: "TypeScript",
        frontend: "Next.js",
        hosting: "Vercel",
        database: "PostgreSQL",
        storage: "AWS S3",
        search: "Pinecone",
        orm: "Prisma",
        auth: "Auth.js (NextAuth)",
        styling: "Tailwind CSS",
        stateCache: "Zustand",
        bannedProviders: [],
      },
    },
    {
      name: "Azure Serverless",
      description: "C# + React + Functions + SQL + Blob + Search",
      preferences: {
        language: "C# / .NET",
        frontend: "React / TanStack",
        hosting: "Azure Functions",
        database: "Azure SQL",
        storage: "Azure Blob Storage",
        search: "Azure AI Search",
        orm: "SQL (Raw)",
        auth: "Custom JWT",
        styling: "Tailwind CSS",
        stateCache: "Zustand",
        bannedProviders: [],
      },
    },
    {
      name: "GCP Serverless",
      description: "Go + React + Cloud Run + Spanner + GCS + Vertex AI",
      preferences: {
        language: "Go",
        frontend: "React / TanStack",
        hosting: "GCP Cloud Run",
        database: "Cloud Spanner",
        storage: "Google Cloud Storage",
        search: "Vertex AI Vector Search",
        orm: "SQL (Raw)",
        auth: "Custom JWT",
        styling: "Tailwind CSS",
        stateCache: "Zustand",
        bannedProviders: [],
      },
    },
  ];

  const handleAnalyzePrompt = async () => {
    if (!interviewPrompt.trim()) return;
    setAnalyzingPrompt(true);
    try {
      const res = await analyzeProjectRequirements({ data: { description: interviewPrompt } });
      setPreferences({
        language: res.language || "TypeScript",
        frontend: res.frontend || "React / TanStack",
        hosting: res.hosting || "Cloudflare Edge",
        database: res.database || "Cloudflare D1",
        storage: res.storage || "Cloudflare R2",
        search: res.search || "Cloudflare Vectorize",
        orm: res.orm || "Drizzle ORM",
        auth: res.auth || "Better Auth",
        styling: res.styling || "Tailwind CSS",
        stateCache: res.stateCache || "TanStack Store",
        bannedProviders: res.bannedProviders || [],
      });
    } catch (e) {
      console.error(e);
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
      console.error(e);
      setStackError("Failed to generate stack recommendation: " + String(e));
    } finally {
      setGeneratingRecommendation(false);
    }
  };

  const nonStackTemplates = useMemo(() => {
    return templates.filter((t) => t.category !== "stack");
  }, [templates]);

  const mergedRules = useMemo(() => {
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
      const factText = `# ${recommendation.name}\n${recommendation.description}\n\n## Stack Preferences:\n- Language: ${preferences.language}\n- Frontend: ${preferences.frontend}\n- Hosting: ${preferences.hosting}\n- Database: ${preferences.database}\n- ORM/DB Access: ${preferences.orm}\n- Authentication: ${preferences.auth}\n- Styling: ${preferences.styling}\n- State/Cache: ${preferences.stateCache}\n- Storage: ${preferences.storage}\n- Search/Vector: ${preferences.search}\n- Banned Providers: ${preferences.bannedProviders.join(", ") || "None"}\n\n## Architectural Rules:\n${mergedRules.map((r) => `- ${r}`).join("\n")}`;

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
      console.error(e);
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
  };

  const handleDownloadConfig = (format: "claude" | "cursor" | "copilot" | "gemini" | "agents") => {
    if (!recommendation) return;
    let content = "";
    let filename = "";

    switch (format) {
      case "claude":
        content = `# ${recommendation.name} Rules\n\n${recommendation.description}\n\n## Development Standards and Architectural Constraints\n${mergedRules.map((r) => `- ${r}`).join("\n")}`;
        filename = ".claudemd";
        break;
      case "cursor":
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
        filename = ".cursorrules";
        break;
      case "copilot":
        content = `# Copilot Instructions for ${recommendation.name}\n\n${recommendation.description}\n\n## Rules:\n${mergedRules.map((r) => `- ${r}`).join("\n")}`;
        filename = "copilot-instructions.md";
        break;
      case "gemini":
        content = `# Gemini Rules for ${recommendation.name}\n\n${recommendation.description}\n\n## Coding Guidelines:\n${mergedRules.map((r) => `- ${r}`).join("\n")}`;
        filename = ".geminirules";
        break;
      case "agents":
        content = `# Custom Agent Rules - ${recommendation.name}\n\n${recommendation.description}\n\n## General Guidelines:\n${mergedRules.map((r) => `- ${r}`).join("\n")}`;
        filename = "agents.md";
        break;
    }

    downloadFile(content, filename, "text/plain");
  };

  // Determine dynamic width
  const modalWidth = (step === 2 || step === 3) && mode === "stack" ? 940 : step === 1 ? 680 : 580;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(8px)",
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        transition: "all 0.3s ease",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          width: "100%",
          maxWidth: modalWidth,
          boxShadow: "0 24px 48px rgba(0,0,0,0.5)",
          transition: "max-width 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
          overflow: "hidden",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "18px 24px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: "-0.01em" }}>
              {mode === "stack" ? "AI Tech Stack Creator" : "New Memory"}
            </span>
            {mode === "stack" && (
              <span style={{ fontSize: 10, background: "var(--accent-dim)", color: "var(--accent)", border: "1px solid rgba(168,85,247,0.3)", borderRadius: 20, padding: "2px 8px", fontWeight: 600 }}>
                Step {step} of 4
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              fontSize: 20,
              padding: "0 4px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
            }}
          >
            ✕
          </button>
        </div>

        {/* Content body */}
        <div style={{ padding: "24px 28px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 20 }}>
          
          {/* STEP 1: Choose Path */}
          {step === 1 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div style={{ textAlign: "center", marginBottom: 6 }}>
                <h3 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 6px 0", letterSpacing: "-0.01em" }}>Choose Memory Type</h3>
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, lineHeight: 1.5 }}>
                  Select whether you want to save a simple fact or design an AI-recommended tech stack ruleset.
                </p>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
                {/* Option A Card */}
                <div
                  onClick={() => {
                    setMode("single");
                    setStep(2);
                  }}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 14,
                    padding: "24px 20px",
                    cursor: "pointer",
                    background: "rgba(255,255,255,0.01)",
                    transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    textAlign: "center",
                    gap: 14,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--accent)";
                    e.currentTarget.style.background = "rgba(168,85,247,0.02)";
                    e.currentTarget.style.transform = "translateY(-3px)";
                    e.currentTarget.style.boxShadow = "0 8px 24px rgba(168,85,247,0.06)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--border)";
                    e.currentTarget.style.background = "rgba(255,255,255,0.01)";
                    e.currentTarget.style.transform = "none";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                >
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 12,
                      background: "rgba(168,85,247,0.1)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--accent)",
                    }}
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                  </div>
                  <div>
                    <h4 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 6px 0" }}>Single Memory Fact</h4>
                    <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0, lineHeight: 1.5 }}>
                      Directly record a single rule, preference, lookup info, or custom project note.
                    </p>
                  </div>
                </div>

                {/* Option B Card */}
                <div
                  onClick={() => {
                    setMode("stack");
                    setStep(2);
                  }}
                  style={{
                    border: "1px solid rgba(168,85,247,0.3)",
                    borderRadius: 14,
                    padding: "24px 20px",
                    cursor: "pointer",
                    background: "linear-gradient(135deg, rgba(168,85,247,0.05) 0%, rgba(139,92,246,0.02) 100%)",
                    transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    textAlign: "center",
                    gap: 14,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--accent)";
                    e.currentTarget.style.background = "linear-gradient(135deg, rgba(168,85,247,0.09) 0%, rgba(139,92,246,0.04) 100%)";
                    e.currentTarget.style.transform = "translateY(-3px)";
                    e.currentTarget.style.boxShadow = "0 8px 24px rgba(168,85,247,0.12)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "rgba(168,85,247,0.3)";
                    e.currentTarget.style.background = "linear-gradient(135deg, rgba(168,85,247,0.05) 0%, rgba(139,92,246,0.02) 100%)";
                    e.currentTarget.style.transform = "none";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                >
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 12,
                      background: "rgba(168,85,247,0.2)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--accent)",
                    }}
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="7" height="9" />
                      <rect x="14" y="3" width="7" height="5" />
                      <rect x="14" y="12" width="7" height="9" />
                      <rect x="3" y="16" width="7" height="5" />
                    </svg>
                  </div>
                  <div>
                    <h4 style={{ fontSize: 15, fontWeight: 700, color: "var(--accent)", margin: "0 0 6px 0" }}>Tech Stack Blueprint</h4>
                    <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0, lineHeight: 1.5 }}>
                      Create a consolidated architecture memory containing structured rules for coding assistants.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Path A - Single Memory Fact */}
          {step === 2 && mode === "single" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                  Fact
                </label>
                <textarea
                  autoFocus
                  value={fact}
                  onChange={(e) => setFact(e.target.value)}
                  rows={5}
                  placeholder="Enter the memory fact…"
                  style={{ width: "100%", padding: "12px 14px", fontSize: 13, lineHeight: 1.5, resize: "vertical", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: "var(--text)", outline: "none" }}
                />
              </div>

              <div style={{ display: "flex", gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                    Category
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as any)}
                    style={{ width: "100%", padding: "10px 12px", fontSize: 13, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: "var(--text)", outline: "none" }}
                  >
                    <option value="references">References</option>
                    <option value="rules">Rules</option>
                    <option value="projects">Projects</option>
                    <option value="stack">Stack</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                    Tags
                  </label>
                  <input
                    type="text"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    placeholder="comma-separated"
                    style={{ width: "100%", padding: "10px 12px", fontSize: 13, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: "var(--text)", outline: "none" }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                  Target Locker
                </label>
                <select
                  value={singleLocker}
                  onChange={(e) => setSingleLocker(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", fontSize: 13, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: "var(--text)", outline: "none" }}
                >
                  {workspaces.map((w) => (
                    <option key={w.key} value={w.key}>{w.label}</option>
                  ))}
                </select>
              </div>

              {singleMutation.isError && (
                <div style={{ padding: "8px 12px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "var(--radius)", color: "var(--error)", fontSize: 12 }}>
                  {(singleMutation.error as Error).message}
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 12 }}>
                <button
                  onClick={() => {
                    setStep(1);
                    setMode(null);
                  }}
                  style={{ padding: "10px 18px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 13, borderRadius: "var(--radius)", cursor: "pointer" }}
                >
                  Back
                </button>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={onClose}
                    style={{ padding: "10px 18px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 13, borderRadius: "var(--radius)", cursor: "pointer" }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => singleMutation.mutate()}
                    disabled={!fact.trim() || singleMutation.isPending}
                    style={{ padding: "10px 22px", background: "var(--accent)", color: "#fff", fontWeight: 600, fontSize: 13, border: "none", borderRadius: "var(--radius)", cursor: (!fact.trim() || singleMutation.isPending) ? "default" : "pointer" }}
                  >
                    {singleMutation.isPending ? "Saving…" : "Save Memory"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Path B - Preferences Builder (2-Column Redesign) */}
          {step === 2 && mode === "stack" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              
              <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 32 }}>
                
                {/* Left Column: Archetypes & AI Goals */}
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                  
                  {/* Load from Template */}
                  {templates.filter((t) => t.category === "stack").length > 0 && (
                    <div>
                      <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8, fontWeight: 600 }}>
                        Load from Memory Template
                      </label>
                      <select
                        value={selectedTemplateId}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSelectedTemplateId(val);
                          const tmpl = templates.find((t) => t.id === val);
                          if (tmpl) {
                            try {
                              const payload = JSON.parse(tmpl.configPayload);
                              setPreferences({
                                language: payload.language || "TypeScript",
                                frontend: payload.frontend || "React / TanStack",
                                hosting: payload.hosting || "Cloudflare Edge",
                                database: payload.database || "Cloudflare D1",
                                storage: payload.storage || "Cloudflare R2",
                                search: payload.search || "Cloudflare Vectorize",
                                orm: payload.orm || "Drizzle ORM",
                                auth: payload.auth || "Better Auth",
                                styling: payload.styling || "Vanilla CSS",
                                stateCache: payload.stateCache || "TanStack Store",
                                bannedProviders: payload.bannedProviders || [],
                              });
                            } catch (err) {
                              console.error(err);
                            }
                          }
                        }}
                        style={{ width: "100%", padding: "10px 12px", fontSize: 13, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: "var(--text)", outline: "none", marginBottom: 16 }}
                      >
                        <option value="">-- Choose custom template preset --</option>
                        {templates.filter((t) => t.category === "stack").map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Presets */}
                  <div>
                    <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8, fontWeight: 600 }}>
                      Quick-Select Stack Archetypes
                    </label>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      {PRESET_ARCHETYPES.map((arch) => (
                        <button
                          key={arch.name}
                          onClick={() => {
                            setPreferences({ ...arch.preferences });
                            setSelectedTemplateId("");
                          }}
                          style={{
                            padding: "10px 12px",
                            background: "var(--surface2)",
                            border: "1px solid var(--border)",
                            borderRadius: "var(--radius)",
                            color: "var(--text)",
                            fontSize: 11,
                            textAlign: "left",
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                            display: "flex",
                            flexDirection: "column",
                            gap: 4,
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.borderColor = "var(--accent)";
                            e.currentTarget.style.background = "rgba(168,85,247,0.04)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.borderColor = "var(--border)";
                            e.currentTarget.style.background = "var(--surface2)";
                          }}
                        >
                          <div style={{ fontWeight: 700 }}>{arch.name}</div>
                          <div style={{ fontSize: 10, color: "var(--text-muted)", lineHeight: 1.3 }}>
                            {arch.description}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Goal Prompt */}
                  <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                      AI Prompt Input (Interview / Goal Box)
                    </label>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
                      <textarea
                        value={interviewPrompt}
                        onChange={(e) => setInterviewPrompt(e.target.value)}
                        placeholder="Describe your project goal (e.g., I want to build a real-time multiplayer card game with room matches, low latency, and a global database...)"
                        rows={5}
                        style={{ width: "100%", flex: 1, padding: "12px", fontSize: 12.5, resize: "none", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: "var(--text)", lineHeight: 1.5, outline: "none" }}
                      />
                      <button
                        onClick={handleAnalyzePrompt}
                        disabled={analyzingPrompt || !interviewPrompt.trim()}
                        style={{
                          padding: "10px 16px",
                          background: "var(--accent)",
                          color: "#fff",
                          border: "none",
                          borderRadius: "var(--radius)",
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: (analyzingPrompt || !interviewPrompt.trim()) ? "default" : "pointer",
                          opacity: (analyzingPrompt || !interviewPrompt.trim()) ? 0.6 : 1,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 6,
                          width: "100%",
                        }}
                      >
                        {analyzingPrompt ? (
                          <>
                            <span className="spinner" style={{ border: "2px solid rgba(255,255,255,0.3)", borderTop: "2px solid #fff", borderRadius: "50%", width: 12, height: 12, display: "inline-block", animation: "spin 0.8s linear infinite" }} />
                            Analyzing Requirements…
                          </>
                        ) : (
                          "Analyze & Autofill Stack"
                        )}
                      </button>
                    </div>
                  </div>

                </div>

                {/* Right Column: Preferences Selectors & Banned List */}
                <div style={{ display: "flex", flexDirection: "column", gap: 20, borderLeft: "1px solid var(--border)", paddingLeft: 32 }}>
                  
                  <div>
                    <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10, fontWeight: 600 }}>
                      Technical Preferences
                    </label>
                    
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      {/* Language */}
                      <div>
                        <label style={{ display: "block", fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4, fontWeight: 600 }}>Language</label>
                        <select
                          value={preferences.language}
                          onChange={(e) => setPreferences({ ...preferences, language: e.target.value })}
                          style={{ width: "100%", padding: "8px 10px", fontSize: 12, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: "var(--text)", outline: "none" }}
                        >
                          {["TypeScript", "JavaScript", "Go", "Python", "Rust", "C# / .NET"].map(x => (
                            <option key={x} value={x}>{x}</option>
                          ))}
                        </select>
                      </div>

                      {/* Frontend */}
                      <div>
                        <label style={{ display: "block", fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4, fontWeight: 600 }}>Frontend Framework</label>
                        <select
                          value={preferences.frontend}
                          onChange={(e) => setPreferences({ ...preferences, frontend: e.target.value })}
                          style={{ width: "100%", padding: "8px 10px", fontSize: 12, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: "var(--text)", outline: "none" }}
                        >
                          {["React / TanStack", "Next.js", "Vue / Nuxt", "Svelte", "Solid", "Vanilla JS"].map(x => (
                            <option key={x} value={x}>{x}</option>
                          ))}
                        </select>
                      </div>

                      {/* Hosting */}
                      <div>
                        <label style={{ display: "block", fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4, fontWeight: 600 }}>Hosting / Runtime</label>
                        <select
                          value={preferences.hosting}
                          onChange={(e) => setPreferences({ ...preferences, hosting: e.target.value })}
                          style={{ width: "100%", padding: "8px 10px", fontSize: 12, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: "var(--text)", outline: "none" }}
                        >
                          {["Cloudflare Edge", "Vercel", "Netlify", "AWS Lambda", "GCP Cloud Run", "Azure Functions", "VPS / Docker"].map(x => (
                            <option key={x} value={x}>{x}</option>
                          ))}
                        </select>
                      </div>

                      {/* Database */}
                      <div>
                        <label style={{ display: "block", fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4, fontWeight: 600 }}>Database</label>
                        <select
                          value={preferences.database}
                          onChange={(e) => setPreferences({ ...preferences, database: e.target.value })}
                          style={{ width: "100%", padding: "8px 10px", fontSize: 12, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: "var(--text)", outline: "none" }}
                        >
                          {["Cloudflare D1", "PostgreSQL", "Aurora PostgreSQL", "Azure SQL", "Cloud Spanner", "MySQL", "SQLite", "MongoDB", "DynamoDB"].map(x => (
                            <option key={x} value={x}>{x}</option>
                          ))}
                        </select>
                      </div>

                      {/* ORM */}
                      <div>
                        <label style={{ display: "block", fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4, fontWeight: 600 }}>ORM / DB Access</label>
                        <select
                          value={preferences.orm}
                          onChange={(e) => setPreferences({ ...preferences, orm: e.target.value })}
                          style={{ width: "100%", padding: "8px 10px", fontSize: 12, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: "var(--text)", outline: "none" }}
                        >
                          {["Drizzle ORM", "Prisma", "Kysely", "SQL (Raw)", "SQLAlchemy", "Prisma Client Python", "None"].map(x => (
                            <option key={x} value={x}>{x}</option>
                          ))}
                        </select>
                      </div>

                      {/* Authentication */}
                      <div>
                        <label style={{ display: "block", fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4, fontWeight: 600 }}>Authentication</label>
                        <select
                          value={preferences.auth}
                          onChange={(e) => setPreferences({ ...preferences, auth: e.target.value })}
                          style={{ width: "100%", padding: "8px 10px", fontSize: 12, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: "var(--text)", outline: "none" }}
                        >
                          {["Better Auth", "Auth.js (NextAuth)", "Clerk", "Supabase Auth", "Firebase Auth", "Custom JWT", "None"].map(x => (
                            <option key={x} value={x}>{x}</option>
                          ))}
                        </select>
                      </div>

                      {/* Styling */}
                      <div>
                        <label style={{ display: "block", fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4, fontWeight: 600 }}>CSS / Styling</label>
                        <select
                          value={preferences.styling}
                          onChange={(e) => setPreferences({ ...preferences, styling: e.target.value })}
                          style={{ width: "100%", padding: "8px 10px", fontSize: 12, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: "var(--text)", outline: "none" }}
                        >
                          {["Tailwind CSS", "CSS Modules", "Styled Components", "Vanilla CSS", "Panda CSS"].map(x => (
                            <option key={x} value={x}>{x}</option>
                          ))}
                        </select>
                      </div>

                      {/* State / Cache */}
                      <div>
                        <label style={{ display: "block", fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4, fontWeight: 600 }}>State / Cache</label>
                        <select
                          value={preferences.stateCache}
                          onChange={(e) => setPreferences({ ...preferences, stateCache: e.target.value })}
                          style={{ width: "100%", padding: "8px 10px", fontSize: 12, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: "var(--text)", outline: "none" }}
                        >
                          {["TanStack Store", "Zustand", "Redux", "React Context", "Redis", "Cloudflare KV", "None"].map(x => (
                            <option key={x} value={x}>{x}</option>
                          ))}
                        </select>
                      </div>

                      {/* Storage */}
                      <div>
                        <label style={{ display: "block", fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4, fontWeight: 600 }}>Blob Storage</label>
                        <select
                          value={preferences.storage}
                          onChange={(e) => setPreferences({ ...preferences, storage: e.target.value })}
                          style={{ width: "100%", padding: "8px 10px", fontSize: 12, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: "var(--text)", outline: "none" }}
                        >
                          {["Cloudflare R2", "AWS S3", "Google Cloud Storage", "Azure Blob Storage", "Local"].map(x => (
                            <option key={x} value={x}>{x}</option>
                          ))}
                        </select>
                      </div>

                      {/* Vector search */}
                      <div>
                        <label style={{ display: "block", fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4, fontWeight: 600 }}>Vector Search</label>
                        <select
                          value={preferences.search}
                          onChange={(e) => setPreferences({ ...preferences, search: e.target.value })}
                          style={{ width: "100%", padding: "8px 10px", fontSize: 12, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: "var(--text)", outline: "none" }}
                        >
                          {["Cloudflare Vectorize", "Pinecone", "Supabase Vector", "Azure AI Search", "Vertex AI Vector Search", "Qdrant", "None"].map(x => (
                            <option key={x} value={x}>{x}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Banned Providers */}
                  <div>
                    <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8, fontWeight: 600 }}>
                      Banned Cloud Providers
                    </label>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      {["AWS", "Google Cloud", "Azure", "Vercel", "Netlify", "Supabase", "Pinecone"].map((p) => {
                        const isBanned = preferences.bannedProviders.includes(p);
                        return (
                          <label key={p} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer", padding: "4px 0" }}>
                            <input
                              type="checkbox"
                              checked={isBanned}
                              onChange={() => toggleBannedProvider(p)}
                              style={{ accentColor: "var(--accent)", cursor: "pointer", width: 14, height: 14 }}
                            />
                            <span style={{ color: isBanned ? "var(--error)" : "var(--text-muted)", fontWeight: isBanned ? 600 : 400 }}>{p}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                </div>

              </div>

              {stackError && (
                <div style={{ padding: "10px 14px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "var(--radius)", color: "var(--error)", fontSize: 12.5 }}>
                  {stackError}
                </div>
              )}

              {/* Navigation buttons */}
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, borderTop: "1px solid var(--border)", paddingTop: 18, marginTop: 4 }}>
                <button
                  onClick={() => {
                    setStep(1);
                    setMode(null);
                  }}
                  style={{ padding: "10px 18px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 13, borderRadius: "var(--radius)", cursor: "pointer", fontWeight: 500 }}
                >
                  Back
                </button>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={onClose}
                    style={{ padding: "10px 18px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 13, borderRadius: "var(--radius)", cursor: "pointer" }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleGenerateRecommendation}
                    disabled={generatingRecommendation}
                    style={{
                      padding: "10px 22px",
                      background: "var(--accent)",
                      color: "#fff",
                      border: "none",
                      borderRadius: "var(--radius)",
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: generatingRecommendation ? "default" : "pointer",
                      opacity: generatingRecommendation ? 0.6 : 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                    }}
                  >
                    {generatingRecommendation ? (
                      <>
                        <span className="spinner" style={{ border: "2px solid rgba(255,255,255,0.3)", borderTop: "2px solid #fff", borderRadius: "50%", width: 12, height: 12, display: "inline-block", animation: "spin 0.8s linear infinite" }} />
                        Analyzing Stack…
                      </>
                    ) : (
                      "Generate Blueprint"
                    )}
                  </button>
                </div>
              </div>

            </div>
          )}

          {/* STEP 3: Preview Card & Target Locker (2-Column Redesign) */}
          {step === 3 && recommendation && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              
              <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 32 }}>
                
                {/* Left Column: Stack Preview Card */}
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
                    Generated Stack Blueprint
                  </label>
                  <div
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      padding: 20,
                      background: "linear-gradient(135deg, rgba(168,85,247,0.02) 0%, rgba(139,92,246,0.01) 100%)",
                      flex: 1,
                      overflowY: "auto",
                      maxHeight: "360px",
                      minHeight: "260px",
                    }}
                  >
                    <h4 style={{ fontSize: 16, fontWeight: 800, color: "var(--accent)", margin: "0 0 8px 0" }}>{recommendation.name}</h4>
                    <p style={{ fontSize: 13, color: "var(--text)", margin: "0 0 16px 0", lineHeight: 1.5 }}>{recommendation.description}</p>
                    
                    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", display: "block", marginBottom: 8, letterSpacing: "0.04em" }}>Architectural Rules:</span>
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--text-muted)", display: "flex", flexDirection: "column", gap: 6, lineHeight: 1.5 }}>
                        {mergedRules.map((rule, idx) => (
                          <li key={idx}>{rule}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>

                {/* Right Column: Save Destination & Config File Generator */}
                <div style={{ display: "flex", flexDirection: "column", gap: 16, borderLeft: "1px solid var(--border)", paddingLeft: 32, maxHeight: "420px", overflowY: "auto" }}>
                  
                  {/* Locker selector */}
                  <div>
                    <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, fontWeight: 600 }}>
                      Save To Locker
                    </label>
                    <select
                      value={targetLocker}
                      onChange={(e) => setTargetLocker(e.target.value)}
                      style={{ width: "100%", padding: "8px 10px", fontSize: 12.5, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: "var(--text)", outline: "none" }}
                    >
                      {workspaces.map((w) => (
                        <option key={w.key} value={w.key}>{w.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Save as template options */}
                  <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={saveAsTemplate}
                        onChange={(e) => setSaveAsTemplate(e.target.checked)}
                        style={{ accentColor: "var(--accent)", cursor: "pointer" }}
                      />
                      <span style={{ fontWeight: 600 }}>Save as Memory Template</span>
                    </label>
                    {saveAsTemplate && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8, padding: 8, background: "var(--surface2)", borderRadius: "var(--radius)" }}>
                        <div>
                          <label style={{ display: "block", fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 2 }}>Template Name</label>
                          <input
                            type="text"
                            value={templateName}
                            onChange={(e) => setTemplateName(e.target.value)}
                            placeholder={recommendation.name}
                            style={{ width: "100%", padding: "4px 6px", fontSize: 11, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}
                          />
                        </div>
                        <div>
                          <label style={{ display: "block", fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 2 }}>Template Description</label>
                          <input
                            type="text"
                            value={templateDescription}
                            onChange={(e) => setTemplateDescription(e.target.value)}
                            placeholder={recommendation.description}
                            style={{ width: "100%", padding: "4px 6px", fontSize: 11, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Config Files Checkboxes */}
                  <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                    <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8, fontWeight: 600 }}>
                      Generate Assistant Config Files
                    </label>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {[
                        { id: "claude", label: ".claudemd (Claude)" },
                        { id: "cursor", label: ".cursorrules (Cursor)" },
                        { id: "copilot", label: ".github/copilot-instructions.md" },
                        { id: "gemini", label: ".geminirules (Gemini)" },
                        { id: "agents", label: "agents.md (General)" },
                      ].map((cf) => (
                        <label key={cf.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, cursor: "pointer", padding: "2px 0" }}>
                          <input
                            type="checkbox"
                            checked={(syncOptions as any)[cf.id]}
                            onChange={() => setSyncOptions(prev => ({ ...prev, [cf.id]: !(prev as any)[cf.id] }))}
                            style={{ accentColor: "var(--accent)", cursor: "pointer", width: 14, height: 14 }}
                          />
                          <span style={{ color: (syncOptions as any)[cf.id] ? "var(--text)" : "var(--text-muted)", fontWeight: (syncOptions as any)[cf.id] ? 500 : 400 }}>{cf.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Multi-template Composition */}
                  {nonStackTemplates.length > 0 && (
                    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                      <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8, fontWeight: 600 }}>
                        Merge Additional Guidelines
                      </label>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {nonStackTemplates.map((tmpl) => {
                          const isChecked = selectedMergeTemplateIds.includes(tmpl.id);
                          let payload: any = { rules: [], variables: [] };
                          try {
                            payload = JSON.parse(tmpl.configPayload);
                          } catch {}
                          const hasVars = payload.variables && payload.variables.length > 0;
                          return (
                            <div key={tmpl.id} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 8, background: isChecked ? "rgba(168,85,247,0.02)" : "transparent" }}>
                              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer" }}>
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedMergeTemplateIds(prev => [...prev, tmpl.id]);
                                      const defaultVars: Record<string, string> = {};
                                      (payload.variables || []).forEach((v: any) => {
                                        defaultVars[v.key] = v.default;
                                      });
                                      setMergeVariables(prev => ({ ...prev, [tmpl.id]: defaultVars }));
                                    } else {
                                      setSelectedMergeTemplateIds(prev => prev.filter(id => id !== tmpl.id));
                                    }
                                  }}
                                  style={{ accentColor: "var(--accent)", cursor: "pointer" }}
                                />
                                <div>
                                  <span style={{ fontWeight: 600 }}>{tmpl.name}</span>
                                  <span style={{ fontSize: 9, marginLeft: 6, padding: "1px 4px", background: "var(--surface2)", borderRadius: 10, color: "var(--text-muted)", textTransform: "uppercase" }}>{tmpl.category}</span>
                                </div>
                              </label>
                              {isChecked && hasVars && (
                                <div style={{ marginTop: 6, padding: "6px 8px", background: "var(--surface2)", borderRadius: 4, display: "flex", flexDirection: "column", gap: 6 }}>
                                  {payload.variables.map((v: any) => (
                                    <div key={v.key} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                      <label style={{ fontSize: 9, fontWeight: 600 }}>{v.key} ({v.description})</label>
                                      <input
                                        type="text"
                                        value={mergeVariables[tmpl.id]?.[v.key] ?? v.default}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          setMergeVariables(prev => ({
                                            ...prev,
                                            [tmpl.id]: {
                                              ...(prev[tmpl.id] || {}),
                                              [v.key]: val
                                            }
                                          }));
                                        }}
                                        style={{ padding: "2px 4px", fontSize: 10, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", width: "100%" }}
                                      />
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                </div>

              </div>

              {stackError && (
                <div style={{ padding: "10px 14px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "var(--radius)", color: "var(--error)", fontSize: 12.5 }}>
                  {stackError}
                </div>
              )}

              {/* Navigation buttons */}
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, borderTop: "1px solid var(--border)", paddingTop: 18, marginTop: 4 }}>
                <button
                  onClick={() => setStep(2)}
                  style={{ padding: "10px 18px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 13, borderRadius: "var(--radius)", cursor: "pointer", fontWeight: 500 }}
                >
                  Back
                </button>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={onClose}
                    style={{ padding: "10px 18px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 13, borderRadius: "var(--radius)", cursor: "pointer" }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveStack}
                    disabled={savingStack}
                    style={{
                      padding: "10px 22px",
                      background: "var(--accent)",
                      color: "#fff",
                      border: "none",
                      borderRadius: "var(--radius)",
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: savingStack ? "default" : "pointer",
                      opacity: savingStack ? 0.6 : 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                    }}
                  >
                    {savingStack ? (
                      <>
                        <span className="spinner" style={{ border: "2px solid rgba(255,255,255,0.3)", borderTop: "2px solid #fff", borderRadius: "50%", width: 12, height: 12, display: "inline-block", animation: "spin 0.8s linear infinite" }} />
                        Saving Stack…
                      </>
                    ) : (
                      "Save to Locker"
                    )}
                  </button>
                </div>
              </div>

            </div>
          )}

          {/* STEP 4: Success & Config Downloads */}
          {step === 4 && recommendation && (
            <div style={{ display: "flex", flexDirection: "column", gap: 18, alignItems: "center", textAlign: "center", padding: "10px 0" }}>
              
              {/* Success checkmark */}
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: "50%",
                  background: "rgba(52,211,153,0.1)",
                  color: "#34d399",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 26,
                  fontWeight: "bold",
                  marginBottom: 6,
                }}
              >
                ✓
              </div>

              <div>
                <h3 style={{ fontSize: 18, fontWeight: 800, margin: "0 0 6px 0", letterSpacing: "-0.01em" }}>Tech Stack Saved Successfully!</h3>
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, lineHeight: 1.5, maxWidth: 400 }}>
                  Consolidated blueprint ruleset added to your target locker. Download your coding assistant configuration files below.
                </p>
              </div>

              {/* Config Files download grid */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%", marginTop: 12 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", display: "block", textAlign: "left", letterSpacing: "0.04em" }}>
                  Download Generated Config Files:
                </span>
                
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, width: "100%" }}>
                  {[
                    { id: "claude", label: ".claudemd", filename: ".claudemd" },
                    { id: "cursor", label: ".cursorrules", filename: ".cursorrules" },
                    { id: "copilot", label: ".github/copilot-instructions.md", filename: "copilot-instructions.md" },
                    { id: "gemini", label: ".geminirules", filename: ".geminirules" },
                    { id: "agents", label: "agents.md", filename: "agents.md" },
                  ].map((cf) => {
                    const isSelected = (syncOptions as any)[cf.id];
                    if (!isSelected) return null;
                    return (
                      <button
                        key={cf.id}
                        onClick={() => handleDownloadConfig(cf.id as any)}
                        style={{
                          padding: "12px 14px",
                          background: "var(--surface2)",
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius)",
                          color: "var(--text)",
                          fontSize: 12.5,
                          fontWeight: 600,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          transition: "all 0.15s ease",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = "var(--accent)";
                          e.currentTarget.style.background = "rgba(168,85,247,0.04)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = "var(--border)";
                          e.currentTarget.style.background = "var(--surface2)";
                        }}
                      >
                        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                          </svg>
                          {cf.label}
                        </span>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* CLI Downloader Block */}
              <div style={{ width: "100%", textAlign: "left", marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    Or Sync via CLI (MCP CURL Downloader):
                  </span>
                  <select
                    value={cliFormat}
                    onChange={(e) => setCliFormat(e.target.value as any)}
                    style={{ padding: "4px 8px", fontSize: 11, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: "var(--text)", outline: "none" }}
                  >
                    <option value="cursor">.cursorrules (Cursor)</option>
                    <option value="claude">.claudemd (Claude)</option>
                    <option value="copilot">copilot-instructions.md</option>
                    <option value="gemini">.geminirules (Gemini)</option>
                    <option value="agents">agents.md (General)</option>
                  </select>
                </div>
                
                <div style={{ position: "relative", background: "rgba(0,0,0,0.2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "10px 12px", fontFamily: "monospace", fontSize: 11, color: "var(--text-muted)", wordBreak: "break-all", whiteSpace: "pre-wrap", lineHeight: 1.4, minHeight: "60px" }}>
                  {(() => {
                    const origin = typeof window !== "undefined" ? window.location.origin : "https://locker.rcormier.dev";
                    const projectParam = targetLocker === "personal" ? "personal" : targetLocker;
                    const redirectCmd = cliFormat === "copilot"
                      ? `mkdir -p .github && curl -s -X POST -H "Authorization: Bearer <API_KEY>" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"sync_workspace_agent_configs","arguments":{"projectKey":"${projectParam}","formatType":"${cliFormat}"}}}' ${origin}/api/mcp | jq -r '.result.content[0].text' | jq -r '.markdown' > .github/copilot-instructions.md`
                      : `curl -s -X POST -H "Authorization: Bearer <API_KEY>" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"sync_workspace_agent_configs","arguments":{"projectKey":"${projectParam}","formatType":"${cliFormat}"}}}' ${origin}/api/mcp | jq -r '.result.content[0].text' | jq -r '.markdown' > .${cliFormat === "agents" ? "agents.md" : cliFormat === "claude" ? "claudemd" : cliFormat + "rules"}`;
                    return (
                      <>
                        <span style={{ display: "block", paddingRight: "45px" }}>{redirectCmd}</span>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(redirectCmd);
                            alert("Copied to clipboard!");
                          }}
                          style={{ position: "absolute", top: 6, right: 6, padding: "3px 6px", fontSize: 10, background: "var(--surface2)", border: "1px solid var(--border)", cursor: "pointer", color: "var(--text)", borderRadius: 3 }}
                        >
                          Copy
                        </button>
                      </>
                    );
                  })()}
                </div>
                <span style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginTop: 6 }}>
                  * Replace <code>&lt;API_KEY&gt;</code> with your active personal API token (generated from the API Keys tab in settings). Requires <code>jq</code>.
                </span>
              </div>

              <button
                onClick={onClose}
                style={{
                  padding: "10px 24px",
                  background: "var(--accent)",
                  color: "#fff",
                  border: "none",
                  borderRadius: "var(--radius)",
                  fontSize: 13.5,
                  fontWeight: 600,
                  marginTop: 14,
                  cursor: "pointer",
                  width: "100%",
                }}
              >
                Close & Return to Dashboard
              </button>

            </div>
          )}

        </div>
      </div>
      

    </div>
  );
}

function downloadFile(content: string, filename: string, contentType: string) {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportToJson(memoriesToExport: Memory[]) {
  const data = memoriesToExport.map(({ id, fact, category, tags, timestamp }) => ({
    id,
    fact,
    category,
    tags,
    timestamp,
  }));
  return JSON.stringify(data, null, 2);
}

function exportToMarkdown(memoriesToExport: Memory[]) {
  const categories = {
    rules: memoriesToExport.filter((m) => m.category === "rules"),
    projects: memoriesToExport.filter((m) => m.category === "projects"),
    references: memoriesToExport.filter((m) => m.category === "references"),
  };

  let md = `# Locker Memories Export - ${new Date().toLocaleDateString()}\n\n`;

  for (const [cat, items] of Object.entries(categories)) {
    if (items.length === 0) continue;
    md += `## ${cat.charAt(0).toUpperCase() + cat.slice(1)}\n\n`;
    for (const item of items) {
      const tags = item.tags
        ? ` [tags: ${item.tags}]`
        : "";
      md += `- ${item.fact}${tags}\n`;
    }
    md += `\n`;
  }
  return md;
}

function compileRulesContent({
  scope,
  memory,
  allMemories,
  targetFile,
}: {
  scope: "single" | "all";
  memory: Memory;
  allMemories: Memory[];
  targetFile: string;
}) {
  let lines: string[] = [];
  if (scope === "single") {
    lines = memory.fact.split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.startsWith("- ") ? line.slice(2) : line);
  } else {
    // Compile active memories that are stack OR tagged architecture/baseline/stack/blueprint
    const filtered = allMemories.filter((m) => {
      if (!m.isActive) return false;
      if (m.category === "stack") return true;
      const tagsList = (m.tags || "").split(",").map((t: string) => t.trim().toLowerCase());
      return (
        tagsList.includes("architecture") ||
        tagsList.includes("baseline") ||
        tagsList.includes("stack") ||
        tagsList.includes("blueprint")
      );
    });

    lines = filtered.flatMap((m) =>
      m.fact.split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.startsWith("- ") ? line.slice(2) : line)
    );
  }

  if (targetFile === ".cursorrules") {
    return JSON.stringify(
      {
        name: scope === "single" ? "Single Rule Guideline" : "Workspace Guidelines",
        description: scope === "single" ? "Architectural rule synced from Locker" : "Architectural rules synced from Locker",
        globs: ["*"],
        rules: lines,
      },
      null,
      2
    );
  } else {
    let title = "Developer Agent Rules";
    let section = "Guidelines";
    if (targetFile === "CLAUDE.md") {
      title = "Claude System Instructions";
      section = "Enforced Guidelines";
    } else if (targetFile === ".github/copilot-instructions.md") {
      title = "Copilot Instructions";
      section = "Rules";
    } else if (targetFile === ".geminirules") {
      title = "Gemini Rules";
      section = "Coding Guidelines";
    } else if (targetFile === ".antigravityrules") {
      title = "Antigravity Rules";
      section = "Guidelines";
    } else if (targetFile === ".codexrules") {
      title = "Codex Rules";
      section = "Rules";
    }

    const sectionHeader = lines.length > 0 ? `## ${section}\n${lines.map((line) => `- ${line}`).join("\n")}\n\n` : "";

    return `# ${title} - Technical Stack Blueprint\n\nThis manifesto specifies the architectural boundaries, tech stack enforcements, and directory mapping rules for developer agents working in this repository.\n\n${sectionHeader}---\n*Generated by Locker at: ${new Date().toLocaleString()}*\n`;
  }
}

function ExportMemoryModal({
  memory,
  allMemories,
  onClose,
}: {
  memory: Memory;
  allMemories: Memory[];
  onClose: () => void;
}) {
  const [exportScope, setExportScope] = useState<"single" | "all">("single");
  const [targetFile, setTargetFile] = useState<
    "CLAUDE.md" | ".cursorrules" | ".github/copilot-instructions.md" | ".codexrules" | ".antigravityrules" | ".geminirules"
  >("CLAUDE.md");

  const handleDownload = () => {
    const content = compileRulesContent({
      scope: exportScope,
      memory,
      allMemories,
      targetFile,
    });
    const mimeType = targetFile === ".cursorrules" ? "application/json" : "text/markdown";
    downloadFile(content, targetFile, mimeType);
    onClose();
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(8px)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          width: "100%",
          maxWidth: 500,
          boxShadow: "0 24px 48px rgba(0,0,0,0.5)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "var(--text)" }}>Export Memory Rule</h3>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 18 }}
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Scope selection */}
          <div>
            <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
              Export Scope
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", padding: "10px 12px", border: `1px solid ${exportScope === "single" ? "var(--accent)" : "var(--border)"}`, borderRadius: "var(--radius)", background: exportScope === "single" ? "rgba(168,85,247,0.04)" : "transparent", transition: "all 0.15s" }}>
                <input
                  type="radio"
                  name="exportScope"
                  checked={exportScope === "single"}
                  onChange={() => setExportScope("single")}
                  style={{ marginTop: 2, accentColor: "var(--accent)", cursor: "pointer" }}
                />
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Just this memory</span>
                  <span style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 380 }}>
                    "{memory.fact}"
                  </span>
                </div>
              </label>

              <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", padding: "10px 12px", border: `1px solid ${exportScope === "all" ? "var(--accent)" : "var(--border)"}`, borderRadius: "var(--radius)", background: exportScope === "all" ? "rgba(168,85,247,0.04)" : "transparent", transition: "all 0.15s" }}>
                <input
                  type="radio"
                  name="exportScope"
                  checked={exportScope === "all"}
                  onChange={() => setExportScope("all")}
                  style={{ marginTop: 2, accentColor: "var(--accent)", cursor: "pointer" }}
                />
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>All active rules in this workspace</span>
                  <span style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                    Compiles active stack rules and tagged architectural memories.
                  </span>
                </div>
              </label>
            </div>
          </div>

          {/* Target format selection */}
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
              Target File Format
            </label>
            <select
              value={targetFile}
              onChange={(e) => setTargetFile(e.target.value as any)}
              style={{ width: "100%", padding: "10px 12px", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 13, borderRadius: "var(--radius)", cursor: "pointer" }}
            >
              <option value="CLAUDE.md">CLAUDE.md (Claude Desktop/CLI)</option>
              <option value=".cursorrules">.cursorrules (Cursor)</option>
              <option value=".github/copilot-instructions.md">.github/copilot-instructions.md (GitHub Copilot)</option>
              <option value=".codexrules">.codexrules (Codex)</option>
              <option value=".antigravityrules">.antigravityrules (Antigravity)</option>
              <option value=".geminirules">.geminirules (Gemini)</option>
            </select>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: "16px 24px", background: "var(--surface2)", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button
            onClick={onClose}
            style={{ padding: "8px 16px", background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 13, fontWeight: 600, borderRadius: "var(--radius)", cursor: "pointer" }}
          >
            Cancel
          </button>
          <button
            onClick={handleDownload}
            style={{ padding: "8px 16px", background: "var(--accent)", color: "#fff", border: "none", fontSize: 13, fontWeight: 600, borderRadius: "var(--radius)", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            Download Rules
          </button>
        </div>
      </div>
    </div>
  );
}
function DetailEmptyState() {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: "40px 24px",
        textAlign: "center",
        color: "var(--text-muted)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 280,
        height: "100%",
        boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: "50%",
          background: "var(--surface2)",
          border: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 16,
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7 }}>
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </div>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>No Memory Selected</h3>
      <p style={{ fontSize: 12, color: "var(--text-muted)", maxWidth: 220, margin: "0 auto", lineHeight: 1.5 }}>
        Select a memory entry from the list to view its complete timeline history, edit tags, or change categories.
      </p>
    </div>
  );
}

function MemoryDetailPanel({
  memory,
  onClose,
  workspaces = [],
  currentProjectKey = "personal",
}: {
  memory: Memory;
  onClose: () => void;
  workspaces?: any[];
  currentProjectKey?: string;
}) {
  const queryClient = useQueryClient();
  const [editFact, setEditFact] = useState(memory.fact);
  const [editCategory, setEditCategory] = useState(memory.category);
  const [editTags, setEditTags] = useState(memory.tags);
  const [targetWorkspace, setTargetWorkspace] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Sync state with memory when it changes
  useEffect(() => {
    setEditFact(memory.fact);
    setEditCategory(memory.category);
    setEditTags(memory.tags);
    setTargetWorkspace("");
    setConfirmDelete(false);
  }, [memory]);

  const hasChanges =
    editFact !== memory.fact ||
    editCategory !== memory.category ||
    editTags !== memory.tags;

  const updateMutation = useMutation({
    mutationFn: () =>
      updateMemory({
        data: {
          id: memory.id,
          fact: editFact,
          category: editCategory,
          tags: editTags,
        },
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData<Memory[]>(["memories"], (old) =>
        old ? old.map((m) => (m.id === updated.id ? updated : m)) : []
      );
      alert("Changes saved successfully!");
    },
    onError: (err: any) => {
      alert("Failed to save changes: " + String(err.message || err));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteMemory({ data: { id: memory.id } }),
    onSuccess: () => {
      queryClient.setQueryData<Memory[]>(["memories"], (old) =>
        old ? old.filter((m) => m.id !== memory.id) : []
      );
      onClose();
    },
    onError: (err: any) => {
      alert("Failed to delete memory: " + String(err.message || err));
    },
  });

  const archiveMutation = useMutation({
    mutationFn: () => archiveMemory({ data: { id: memory.id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memories"] });
      queryClient.invalidateQueries({ queryKey: ["memories-archived"] });
      onClose();
    },
    onError: (err: any) => {
      alert("Failed to archive memory: " + String(err.message || err));
    },
  });

  const moveMutation = useMutation({
    mutationFn: () =>
      moveMemories({
        data: { ids: [memory.id], targetProjectKey: targetWorkspace },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memories"] });
      setTargetWorkspace("");
      onClose();
      alert("Memory moved successfully!");
    },
    onError: (err: any) => {
      alert("Failed to move memory: " + String(err.message || err));
    },
  });

  const { data: versions = [], isLoading: isTimelineLoading } = useQuery({
    queryKey: ["memory-timeline", memory.id],
    queryFn: () => getMemoryTimeline({ data: { memoryId: memory.id } }),
  });

  const revertMutation = useMutation({
    mutationFn: (versionId: string) => revertMemoryVersion({ data: { versionId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memories"] });
      queryClient.invalidateQueries({ queryKey: ["memory-timeline", memory.id] });
      alert("Reverted memory version successfully!");
    },
    onError: (err: any) => {
      alert("Revert failed: " + String(err.message || err));
    },
  });

  const tagsList = useMemo(() => {
    return editTags
      ? editTags.split(",").map((t) => t.trim()).filter(Boolean)
      : [];
  }, [editTags]);

  return (
    <div className="detail-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border)", paddingBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--text)" }}>Memory Details</h3>
        <button
          onClick={onClose}
          style={{ background: "transparent", border: "none", color: "var(--text-muted)", fontSize: 16, cursor: "pointer", padding: "0 4px" }}
        >
          ✕
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
            Fact Content
          </label>
          <textarea
            value={editFact}
            onChange={(e) => setEditFact(e.target.value)}
            rows={4}
            style={{ width: "100%", padding: "8px 10px", fontSize: 13, lineHeight: 1.5, resize: "vertical" }}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
              Category
            </label>
            <select
              value={editCategory}
              onChange={(e) => setEditCategory(e.target.value as any)}
              style={{ width: "100%", padding: "6px 8px", fontSize: 12 }}
            >
              <option value="rules">Rules</option>
              <option value="projects">Projects</option>
              <option value="references">References</option>
              <option value="stack">Stack</option>
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
              Tags (Comma Separated)
            </label>
            <input
              type="text"
              value={editTags}
              onChange={(e) => setEditTags(e.target.value)}
              placeholder="e.g. manual, profile"
              style={{ width: "100%", padding: "6px 8px", fontSize: 12 }}
            />
          </div>
        </div>

        {tagsList.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {tagsList.map((tag) => (
              <span
                key={tag}
                style={{
                  display: "inline-block",
                  padding: "2px 8px",
                  borderRadius: 4,
                  fontSize: 10,
                  background: "var(--tag-bg)",
                  border: "1px solid var(--tag-border)",
                  color: "var(--accent)",
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {hasChanges && (
          <div style={{ display: "flex", gap: 8, padding: "8px 0" }}>
            <button
              onClick={() => updateMutation.mutate()}
              disabled={updateMutation.isPending || !editFact.trim()}
              style={{
                flex: 1,
                padding: "6px 12px",
                background: "var(--accent)",
                color: "#fff",
                fontWeight: 600,
                fontSize: 12,
              }}
            >
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </button>
            <button
              onClick={() => {
                setEditFact(memory.fact);
                setEditCategory(memory.category);
                setEditTags(memory.tags);
              }}
              style={{
                padding: "6px 12px",
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                color: "var(--text-muted)",
                fontSize: 12,
              }}
            >
              Discard
            </button>
          </div>
        )}

        <div style={{ height: 1, background: "var(--border)", margin: "8px 0" }} />

        {/* Workspace mover */}
        {workspaces.filter((w) => w.key !== currentProjectKey).length > 0 && (
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
              Move to Workspace
            </label>
            <div style={{ display: "flex", gap: 6 }}>
              <select
                value={targetWorkspace}
                onChange={(e) => setTargetWorkspace(e.target.value)}
                style={{ flex: 1, padding: "5px 8px", fontSize: 11, background: "var(--surface2)", color: "var(--text)" }}
              >
                <option value="">Select workspace...</option>
                {workspaces
                  .filter((w) => w.key !== currentProjectKey)
                  .map((w) => (
                    <option key={w.key} value={w.key}>
                      {w.label}
                    </option>
                  ))}
              </select>
              <button
                onClick={() => moveMutation.mutate()}
                disabled={moveMutation.isPending || !targetWorkspace}
                style={{
                  padding: "5px 12px",
                  background: "var(--accent)",
                  color: "#fff",
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                {moveMutation.isPending ? "Moving..." : "Move"}
              </button>
            </div>
          </div>
        )}

        {/* Delete & Archive actions */}
        <div>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
            Locker Status Operations
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {confirmDelete ? (
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Confirm delete?</span>
                <button
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending}
                  style={{
                    padding: "4px 10px",
                    background: "rgba(239,68,68,0.15)",
                    border: "1px solid rgba(239,68,68,0.4)",
                    color: "var(--error)",
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  Yes
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  style={{
                    padding: "4px 8px",
                    background: "var(--surface2)",
                    border: "1px solid var(--border)",
                    color: "var(--text-muted)",
                    fontSize: 11,
                  }}
                >
                  No
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                style={{
                  padding: "6px 12px",
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.25)",
                  color: "var(--error)",
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                Delete Memory
              </button>
            )}
            <button
              onClick={() => archiveMutation.mutate()}
              disabled={archiveMutation.isPending}
              style={{
                padding: "6px 12px",
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                color: "var(--text-muted)",
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {archiveMutation.isPending ? "Archiving..." : "Archive Entry"}
            </button>
          </div>
        </div>
      </div>

      {/* Version History Timeline */}
      <div style={{ marginTop: 20, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
        <h4 style={{ margin: "0 0 12px 0", fontSize: 13, fontWeight: 700, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          Version History
        </h4>

        {isTimelineLoading ? (
          <div style={{ padding: 12, color: "var(--text-muted)", fontSize: 12, textAlign: "center" }}>
            Loading history...
          </div>
        ) : versions.length === 0 ? (
          <div style={{ padding: 12, color: "var(--text-muted)", fontSize: 12, textAlign: "center" }}>
            No history found.
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              position: "relative",
              paddingLeft: 12,
              borderLeft: "2px solid var(--border)",
              marginLeft: 4,
            }}
          >
            {versions.map((v: any, index: number) => {
              const isLatest = index === 0;
              return (
                <div key={v.id} style={{ position: "relative", fontSize: 12 }}>
                  {/* Timeline dot */}
                  <div
                    style={{
                      position: "absolute",
                      left: -17,
                      top: 4,
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: isLatest ? "var(--accent)" : "var(--border)",
                      border: isLatest ? "2px solid var(--accent)" : "none",
                    }}
                  />

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: isLatest ? "var(--accent)" : "var(--text-muted)" }}>
                      {v.changeReason || "changed"}
                    </span>
                    <span style={{ fontSize: 9, color: "var(--text-muted)" }}>
                      {new Date(v.timestamp).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>

                  <p style={{ margin: "0 0 6px 0", color: isLatest ? "var(--text)" : "var(--text-muted)", lineHeight: 1.4, wordBreak: "break-word" }}>
                    {v.fact}
                  </p>

                  {!isLatest && (
                    <button
                      onClick={() => {
                        if (confirm("Revert to this version? This will update the active memory.")) {
                          revertMutation.mutate(v.id);
                        }
                      }}
                      disabled={revertMutation.isPending}
                      style={{
                        padding: "2px 8px",
                        background: "var(--surface2)",
                        border: "1px solid var(--border)",
                        color: "var(--accent)",
                        fontSize: 10,
                        fontWeight: 600,
                        borderRadius: 4,
                      }}
                    >
                      {revertMutation.isPending ? "Reverting..." : "Revert"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function MemoryTable({
  memories,
  filter,
  categoryFilter,
  sortBy,
  dateStart,
  dateEnd,
  onShowHistory,
  onExportZip,
  workspaces = [],
  currentProjectKey = "personal",
}: {
  memories: Memory[];
  filter: string;
  categoryFilter: string;
  sortBy: 'newest' | 'oldest' | 'alphabetical';
  dateStart: string;
  dateEnd: string;
  onShowHistory: (id: string) => void;
  onExportZip: () => void;
  workspaces?: any[];
  currentProjectKey?: string;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkConfirming, setBulkConfirming] = useState(false);
  const [bulkMoving, setBulkMoving] = useState(false);
  const [bulkTargetWorkspace, setBulkTargetWorkspace] = useState("");
  const [exportMemory, setExportMemory] = useState<Memory | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);

  const [activeSelectedId, setActiveSelectedId] = useState<string | null>(null);

  const PAGE_SIZE = 20;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  function handleExport(itemsToExport: Memory[], format: "json" | "md") {
    if (format === "json") {
      const jsonContent = exportToJson(itemsToExport);
      downloadFile(jsonContent, `locker_memories_${new Date().toISOString().split("T")[0]}.json`, "application/json");
    } else {
      const mdContent = exportToMarkdown(itemsToExport);
      downloadFile(mdContent, `locker_memories_${new Date().toISOString().split("T")[0]}.md`, "text/markdown");
    }
  }

  const filtered = useMemo(() => {
    const q = filter.toLowerCase();
    const startDate = dateStart ? new Date(dateStart).getTime() : null;
    const endDate = dateEnd ? new Date(dateEnd).getTime() : null;

    let results = memories.filter((m) => {
      const matchesCat = !categoryFilter || m.category === categoryFilter;
      const matchesText =
        !q ||
        m.fact.toLowerCase().includes(q) ||
        (m.tags?.toLowerCase().includes(q) ?? false);
      const mTime = new Date(m.timestamp).getTime();
      const matchesDate =
        (!startDate || mTime >= startDate) &&
        (!endDate || mTime <= endDate + 86400000);
      return matchesCat && matchesText && matchesDate;
    });

    if (sortBy === 'newest') {
      results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    } else if (sortBy === 'oldest') {
      results.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    } else if (sortBy === 'alphabetical') {
      results.sort((a, b) => a.fact.localeCompare(b.fact));
    }

    return results;
  }, [memories, filter, categoryFilter, sortBy, dateStart, dateEnd]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [filter, categoryFilter, sortBy, dateStart, dateEnd]);

  const visibleMemories = useMemo(() => {
    return filtered.slice(0, visibleCount);
  }, [filtered, visibleCount]);

  const activeMemory = useMemo(() => {
    return filtered.find((m) => m.id === activeSelectedId) || null;
  }, [filtered, activeSelectedId]);

  const hasMore = visibleCount < filtered.length;

  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
      if (node && hasMore) {
        observerRef.current = new IntersectionObserver(
          (entries) => {
            if (entries[0].isIntersecting) {
              setVisibleCount((prev) => prev + PAGE_SIZE);
            }
          },
          { threshold: 0.1, rootMargin: "150px" }
        );
        observerRef.current.observe(node);
      }
    },
    [hasMore]
  );

  const filteredIds = useMemo(() => new Set(filtered.map((m) => m.id)), [filtered]);
  const allSelected = filtered.length > 0 && filtered.every((m) => selected.has(m.id));
  const someSelected = filtered.some((m) => selected.has(m.id));
  const selectedInView = filtered.filter((m) => selected.has(m.id));

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => bulkDeleteMemories({ data: { ids } }),
    onMutate: (ids) => {
      const idSet = new Set(ids);
      queryClient.setQueryData<Memory[]>(["memories"], (old) =>
        old ? old.filter((m) => !idSet.has(m.id)) : []
      );
      setSelected(new Set());
      setBulkConfirming(false);
      setActiveSelectedId(null);
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ["memories"] });
    },
  });

  const bulkMoveMutation = useMutation({
    mutationFn: (ids: string[]) => moveMemories({ data: { ids, targetProjectKey: bulkTargetWorkspace } }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["memories"] });
      setSelected(new Set());
      setBulkMoving(false);
      setBulkTargetWorkspace("");
      setActiveSelectedId(null);
      alert(`Successfully moved ${res.moved} memories.`);
    },
    onError: (err: Error) => {
      alert("Failed to move memories: " + err.message);
    },
  });

  function toggleSelectAll() {
    if (allSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        filteredIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        filteredIds.forEach((id) => next.add(id));
        return next;
      });
    }
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  if (filtered.length === 0) {
    return (
      <div
        style={{
          textAlign: "center",
          padding: "48px 24px",
          color: "var(--text-muted)",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
        }}
      >
        {memories.length === 0 ? "No memories stored yet." : "No memories match your filters."}
      </div>
    );
  }

  const percentLoaded = Math.min(100, Math.floor((visibleMemories.length / filtered.length) * 100));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "10px 18px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: 12,
            background: "var(--surface2)",
            flexWrap: "wrap",
          }}
        >
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
            onChange={toggleSelectAll}
            style={{ cursor: "pointer", accentColor: "var(--accent)" }}
          />
          {someSelected ? (
            <>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {selectedInView.length} selected
              </span>
              {bulkConfirming ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
                  <span style={{ fontSize: 12, color: "var(--error)" }}>
                    Delete {selectedInView.length} memor{selectedInView.length !== 1 ? "ies" : "y"}?
                  </span>
                  <button
                    onClick={() => bulkDeleteMutation.mutate(selectedInView.map((m) => m.id))}
                    disabled={bulkDeleteMutation.isPending}
                    style={{
                      padding: "4px 12px",
                      background: "rgba(239,68,68,0.15)",
                      border: "1px solid rgba(239,68,68,0.4)",
                      color: "var(--error)",
                      fontSize: 12,
                      fontWeight: 600,
                      borderRadius: "var(--radius)",
                    }}
                  >
                    {bulkDeleteMutation.isPending ? "Deleting…" : "Yes, delete"}
                  </button>
                  <button
                    onClick={() => setBulkConfirming(false)}
                    disabled={bulkDeleteMutation.isPending}
                    style={{
                      padding: "4px 10px",
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      color: "var(--text-muted)",
                      fontSize: 12,
                      borderRadius: "var(--radius)",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ) : bulkMoving ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    Move {selectedInView.length} to:
                  </span>
                  <select
                    value={bulkTargetWorkspace}
                    onChange={(e) => setBulkTargetWorkspace(e.target.value)}
                    style={{ padding: "4px 8px", fontSize: 12, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: "var(--text)" }}
                  >
                    <option value="">Select workspace...</option>
                    {workspaces
                      .filter((w) => w.key !== currentProjectKey)
                      .map((w) => (
                        <option key={w.key} value={w.key}>
                          {w.label}
                        </option>
                      ))}
                  </select>
                  <button
                    onClick={() => bulkMoveMutation.mutate(selectedInView.map((m) => m.id))}
                    disabled={bulkMoveMutation.isPending || !bulkTargetWorkspace}
                    style={{
                      padding: "4px 12px",
                      background: "var(--accent)",
                      color: "#fff",
                      fontSize: 12,
                      fontWeight: 600,
                      borderRadius: "var(--radius)",
                    }}
                  >
                    {bulkMoveMutation.isPending ? "Moving…" : "Move"}
                  </button>
                  <button
                    onClick={() => { setBulkMoving(false); setBulkTargetWorkspace(""); }}
                    disabled={bulkMoveMutation.isPending}
                    style={{
                      padding: "4px 10px",
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      color: "var(--text-muted)",
                      fontSize: 12,
                      borderRadius: "var(--radius)",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <button
                    onClick={() => handleExport(selectedInView, "json")}
                    style={{
                      padding: "4.5px 12px",
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      color: "var(--text)",
                      fontSize: 11,
                      fontWeight: 600,
                      borderRadius: "var(--radius)",
                      cursor: "pointer",
                      transition: "all 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      const b = e.currentTarget as HTMLButtonElement;
                      b.style.borderColor = "var(--accent)";
                      b.style.color = "var(--accent)";
                    }}
                    onMouseLeave={(e) => {
                      const b = e.currentTarget as HTMLButtonElement;
                      b.style.borderColor = "var(--border)";
                      b.style.color = "var(--text)";
                    }}
                  >
                    Export JSON
                  </button>
                  <button
                    onClick={() => handleExport(selectedInView, "md")}
                    style={{
                      padding: "4.5px 12px",
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      color: "var(--text)",
                      fontSize: 11,
                      fontWeight: 600,
                      borderRadius: "var(--radius)",
                      cursor: "pointer",
                      transition: "all 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      const b = e.currentTarget as HTMLButtonElement;
                      b.style.borderColor = "var(--accent)";
                      b.style.color = "var(--accent)";
                    }}
                    onMouseLeave={(e) => {
                      const b = e.currentTarget as HTMLButtonElement;
                      b.style.borderColor = "var(--border)";
                      b.style.color = "var(--text)";
                    }}
                  >
                    Export Markdown
                  </button>
                  <button
                    onClick={onExportZip}
                    style={{
                      padding: "4.5px 12px",
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      color: "var(--text)",
                      fontSize: 11,
                      fontWeight: 600,
                      borderRadius: "var(--radius)",
                      cursor: "pointer",
                      transition: "all 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      const b = e.currentTarget as HTMLButtonElement;
                      b.style.borderColor = "var(--accent)";
                      b.style.color = "var(--accent)";
                    }}
                    onMouseLeave={(e) => {
                      const b = e.currentTarget as HTMLButtonElement;
                      b.style.borderColor = "var(--border)";
                      b.style.color = "var(--text)";
                    }}
                  >
                    Export Zip
                  </button>
                  {workspaces.filter((w) => w.key !== currentProjectKey).length > 0 && (
                    <button
                      onClick={() => setBulkMoving(true)}
                      style={{
                        padding: "4.5px 12px",
                        background: "var(--surface)",
                        border: "1px solid var(--border)",
                        color: "var(--text)",
                        fontSize: 11,
                        fontWeight: 600,
                        borderRadius: "var(--radius)",
                        cursor: "pointer",
                        transition: "all 0.15s",
                      }}
                      onMouseEnter={(e) => {
                        const b = e.currentTarget as HTMLButtonElement;
                        b.style.borderColor = "var(--accent)";
                        b.style.color = "var(--accent)";
                      }}
                      onMouseLeave={(e) => {
                        const b = e.currentTarget as HTMLButtonElement;
                        b.style.borderColor = "var(--border)";
                        b.style.color = "var(--text)";
                      }}
                    >
                      Move selected
                    </button>
                  )}
                  <button
                    onClick={() => setBulkConfirming(true)}
                    style={{
                      padding: "4.5px 12px",
                      background: "rgba(239,68,68,0.1)",
                      border: "1px solid rgba(239,68,68,0.3)",
                      color: "var(--error)",
                      fontSize: 12,
                      fontWeight: 600,
                      borderRadius: "var(--radius)",
                    }}
                  >
                    Delete selected
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {filtered.length} memor{filtered.length !== 1 ? "ies" : "y"}
              </span>
              {filtered.length > 0 && (
                <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <button
                    onClick={() => handleExport(filtered, "json")}
                    style={{
                      padding: "4.5px 12px",
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      color: "var(--text)",
                      fontSize: 11,
                      fontWeight: 600,
                      borderRadius: "var(--radius)",
                      cursor: "pointer",
                      transition: "all 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      const b = e.currentTarget as HTMLButtonElement;
                      b.style.borderColor = "var(--accent)";
                      b.style.color = "var(--accent)";
                    }}
                    onMouseLeave={(e) => {
                      const b = e.currentTarget as HTMLButtonElement;
                      b.style.borderColor = "var(--border)";
                      b.style.color = "var(--text)";
                    }}
                  >
                    Export JSON
                  </button>
                  <button
                    onClick={() => handleExport(filtered, "md")}
                    style={{
                      padding: "4.5px 12px",
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      color: "var(--text)",
                      fontSize: 11,
                      fontWeight: 600,
                      borderRadius: "var(--radius)",
                      cursor: "pointer",
                      transition: "all 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      const b = e.currentTarget as HTMLButtonElement;
                      b.style.borderColor = "var(--accent)";
                      b.style.color = "var(--accent)";
                    }}
                    onMouseLeave={(e) => {
                      const b = e.currentTarget as HTMLButtonElement;
                      b.style.borderColor = "var(--border)";
                      b.style.color = "var(--text)";
                    }}
                  >
                    Export Markdown
                  </button>
                  <button
                    onClick={onExportZip}
                    style={{
                      padding: "4.5px 12px",
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      color: "var(--text)",
                      fontSize: 11,
                      fontWeight: 600,
                      borderRadius: "var(--radius)",
                      cursor: "pointer",
                      transition: "all 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      const b = e.currentTarget as HTMLButtonElement;
                      b.style.borderColor = "var(--accent)";
                      b.style.color = "var(--accent)";
                    }}
                    onMouseLeave={(e) => {
                      const b = e.currentTarget as HTMLButtonElement;
                      b.style.borderColor = "var(--border)";
                      b.style.color = "var(--text)";
                    }}
                  >
                    Export Zip
                  </button>
                  <button
                    onClick={() => {
                      setSelected(new Set(filtered.map((m) => m.id)));
                      setBulkConfirming(true);
                    }}
                    style={{
                      padding: "4.5px 12.5px",
                      background: "rgba(239,68,68,0.08)",
                      border: "1px solid rgba(239,68,68,0.25)",
                      color: "var(--error)",
                      fontSize: 11,
                      borderRadius: "var(--radius)",
                      opacity: 0.6,
                    }}
                  >
                    Delete All
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ padding: "8px 18px", background: "var(--surface)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>
            Showing {visibleMemories.length} of {filtered.length} entries
          </span>
          <div style={{ width: 80, height: 4, background: "var(--surface2)", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ width: `${percentLoaded}%`, height: "100%", background: "var(--accent)", transition: "width 0.25s" }} />
          </div>
        </div>
      </div>

      <div className="memories-grid-container">
        {visibleMemories.map((m) => (
          <MemoryRow
            key={m.id}
            memory={m}
            selected={selected.has(m.id)}
            onToggleSelect={toggleOne}
            onShowHistory={onShowHistory}
            onExport={(mem) => { setExportMemory(mem); setShowExportModal(true); }}
            workspaces={workspaces}
            currentProjectKey={currentProjectKey}
            isSelected={activeSelectedId === m.id}
            onSelect={() => setActiveSelectedId(m.id)}
          />
        ))}
      </div>

      {hasMore && (
        <div ref={sentinelRef} style={{ padding: "20px", display: "flex", justifyContent: "center", alignItems: "center", border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--surface2)" }}>
          <button
            onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
            style={{
              padding: "8px 16px",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              color: "var(--text-muted)",
              fontSize: 12,
              borderRadius: "var(--radius)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span className="spinner" style={{ width: 12, height: 12, border: "2px solid var(--text-muted)", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin 1s linear infinite" }} />
            Loading more memories...
          </button>
        </div>
      )}

      {!hasMore && filtered.length > 0 && (
        <div style={{ padding: "24px 20px", textAlign: "center", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: "var(--text-muted)", background: "var(--surface2)", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span style={{ fontSize: 11, fontWeight: 500 }}>Vault list fully loaded ({filtered.length} entries)</span>
        </div>
      )}

      {/* Details drawer overlay */}
      {activeMemory && (
        <div className="details-drawer-overlay" onClick={() => setActiveSelectedId(null)}>
          <div className="details-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="details-drawer-content">
              <MemoryDetailPanel
                memory={activeMemory}
                onClose={() => setActiveSelectedId(null)}
                workspaces={workspaces}
                currentProjectKey={currentProjectKey}
              />
            </div>
          </div>
        </div>
      )}

      {showExportModal && exportMemory && (
        <ExportMemoryModal
          memory={exportMemory}
          allMemories={memories}
          onClose={() => { setShowExportModal(false); setExportMemory(null); }}
        />
      )}
    </div>
  );
}

function Dashboard() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'alphabetical'>('newest');
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [showNewMemory, setShowNewMemory] = useState(false);
  const [activeTimelineId, setActiveTimelineId] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("onboarding-dismissed") !== "true";
    }
    return true;
  });
  const [onboardingSteps, setOnboardingSteps] = useState<Record<string, boolean>>(() => {
    if (typeof window !== "undefined") {
      try {
        return JSON.parse(localStorage.getItem("onboarding-steps") || "{}");
      } catch {
        return {};
      }
    }
    return {};
  });

  const [projectKey, setProjectKey] = useState<string>("personal");
  const [memoryTab, setMemoryTab] = useState<"active" | "archived">("active");

  // Shortcut to focus search when pressing '/'
  useEffect(() => {
    const handleShortcut = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        document.getElementById("search-input")?.focus();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  const { data: workspaces = [] } = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => getUserWorkspaces(),
  });

  const { data: memories = [], isLoading, isError } = useQuery({
    queryKey: ["memories", projectKey],
    queryFn: () => getMemories({ data: { projectKey: projectKey === "personal" ? undefined : projectKey } }),
    enabled: memoryTab === "active",
  });

  const { data: archivedData } = useQuery({
    queryKey: ["memories-archived", projectKey],
    queryFn: () => getArchivedMemories({ data: { projectKey: projectKey === "personal" ? undefined : projectKey } }),
    enabled: memoryTab === "archived",
  });

  const { data: usageStats } = useQuery({
    queryKey: ["memory-usage"],
    queryFn: () => getMemoryUsageStats(),
    enabled: projectKey === "personal",
  });

  async function triggerExport() {
    try {
      const res = await fetch("/api/export", { method: "POST" });
      if (!res.ok) {
        alert("Export failed: " + res.statusText);
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `locker_export.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert("Error triggering export: " + String(err));
    }
  }



  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["memories"] });
  }

  const totalByCategory = useMemo(() => {
    const counts: Record<string, number> = { rules: 0, projects: 0, references: 0, stack: 0 };
    for (const m of memories) counts[m.category] = (counts[m.category] ?? 0) + 1;
    return counts;
  }, [memories]);

  function dismissOnboarding() {
    setShowOnboarding(false);
    localStorage.setItem("onboarding-dismissed", "true");
  }

  function updateOnboardingStep(step: string, completed: boolean) {
    const updated = { ...onboardingSteps, [step]: completed };
    setOnboardingSteps(updated);
    localStorage.setItem("onboarding-steps", JSON.stringify(updated));
  }

  return (
    <div>
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .memories-grid-container {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 20px;
          align-items: stretch;
        }
        @media (max-width: 640px) {
          .memories-grid-container {
            grid-template-columns: 1fr;
          }
        }
        .details-drawer-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.4);
          backdrop-filter: blur(4px);
          z-index: 1000;
          animation: fadeIn 0.2s ease-out;
          display: flex;
          justify-content: flex-end;
        }
        .details-drawer {
          position: fixed;
          right: 0;
          top: 0;
          width: 480px;
          max-width: 100%;
          height: 100vh;
          background: var(--surface);
          border-left: 1px solid var(--border);
          box-shadow: -10px 0 30px rgba(0, 0, 0, 0.25);
          z-index: 1001;
          display: flex;
          flex-direction: column;
          animation: slideInRight 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .details-drawer-content {
          padding: 24px;
          overflow-y: auto;
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .stat-card {
          background: linear-gradient(135deg, rgba(168,85,247,0.03) 0%, rgba(139,92,246,0.01) 100%);
          border: 1px solid rgba(168,85,247,0.12);
          border-radius: 12px;
          padding: 16px 18px;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          position: relative;
          overflow: hidden;
          width: 100%;
          outline: none;
        }
        .stat-card:hover {
          transform: translateY(-2px);
          border-color: rgba(168,85,247,0.35);
          box-shadow: 0 8px 24px rgba(168,85,247,0.08);
        }
        .stat-card.active {
          background: linear-gradient(135deg, rgba(168,85,247,0.08) 0%, rgba(139,92,246,0.03) 100%);
          border-color: var(--accent);
          box-shadow: 0 0 16px rgba(168,85,247,0.15);
        }
        .stat-card::after {
          content: '';
          position: absolute;
          inset: 0;
          background: radial-gradient(circle at 50% 50%, rgba(168,85,247,0.08) 0%, transparent 60%);
          opacity: 0;
          transition: opacity 0.3s;
          pointer-events: none;
        }
        .stat-card:hover::after {
          opacity: 1;
        }
        .search-input-wrapper {
          position: relative;
          flex: 1;
        }
        .search-input-wrapper input {
          width: 100%;
          padding: 8px 12px 8px 32px;
          background: var(--surface2);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          color: var(--text);
          transition: all 0.2s;
          outline: none;
        }
        .search-input-wrapper input:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 2px rgba(168, 85, 247, 0.15);
          background: var(--surface);
        }
        .memory-item-card {
          padding: 18px;
          border-radius: 12px;
          border: 1px solid var(--border);
          background: var(--surface);
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          min-height: 220px;
          height: 100%;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          box-sizing: border-box;
        }
        .memory-item-card:hover {
          transform: translateY(-4px);
          border-color: rgba(168,85,247,0.35);
          box-shadow: 0 10px 30px rgba(168,85,247,0.08);
          background: var(--surface2);
        }
        .memory-item-card.selected {
          background: rgba(168, 85, 247, 0.04) !important;
          border: 1.5px solid var(--accent) !important;
          box-shadow: 0 0 16px rgba(168, 85, 247, 0.15) !important;
        }
        .memory-item-card-body {
          font-size: 13.5px;
          line-height: 1.5;
          color: var(--text-muted);
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 5;
          -webkit-box-orient: vertical;
          margin: 0 0 12px 0;
          word-break: break-word;
          opacity: 0.95;
        }
      `}</style>
      {/* Page header bar */}
      <div style={{ background: "var(--surface2)", borderBottom: "1px solid var(--border)", padding: "20px 24px" }}>
        <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="3" />
                <path d="M3 9h18M9 21V9" />
              </svg>
              <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>Memory Locker</h1>
              <span style={{ fontSize: 11, background: "var(--accent-dim)", color: "var(--accent)", border: "1px solid rgba(168,85,247,0.3)", borderRadius: 20, padding: "2px 8px", fontWeight: 600 }}>
                {memories.length} entries
              </span>
            </div>
            <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0 }}>
              Long-term technical context. Semantic retrieval via{" "}
              <code style={{ color: "var(--accent)", fontSize: 12 }}>/api/mcp</code> MCP endpoint.
            </p>
            {usageStats && usageStats.limit && usageStats.used / usageStats.limit > 0.8 && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>Memory usage</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: usageStats.used >= usageStats.limit ? "var(--error)" : "var(--accent)" }}>
                    {usageStats.used} / {usageStats.limit}
                  </span>
                </div>
                <div style={{ width: "100%", maxWidth: 300, height: 6, background: "var(--surface)", borderRadius: 3, overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.min(100, (usageStats.used / usageStats.limit) * 100)}%`,
                      background: usageStats.used >= usageStats.limit ? "var(--error)" : "var(--accent)",
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
            <select
              value={projectKey}
              onChange={(e) => setProjectKey(e.target.value)}
              style={{ padding: "6px 12px", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 12, borderRadius: "var(--radius)", cursor: "pointer" }}
            >
              {workspaces.map((w) => (
                <option key={w.key} value={w.key}>{w.label}</option>
              ))}
            </select>


            <button
              onClick={() => setShowNewMemory(true)}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 16px", background: "var(--accent)", color: "#fff", fontWeight: 600, fontSize: 13, borderRadius: "var(--radius)", marginLeft: 8 }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              New Memory
            </button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "28px 24px" }}>

      {memories.length === 0 && showOnboarding && (
        <div style={{
          background: "linear-gradient(135deg, rgba(168,85,247,0.08) 0%, rgba(139,92,246,0.04) 100%)",
          border: "1px solid rgba(168,85,247,0.25)",
          borderRadius: 12,
          padding: "20px 22px",
          marginBottom: 24,
          display: "flex",
          alignItems: "flex-start",
          gap: 16,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/>
                <path d="M10 16.5l-3-3 1.41-1.41L10 13.68l5.59-5.59L17 9.5l-7 7z"/>
              </svg>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", margin: 0 }}>Get started with Locker</h3>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                { id: "connect", label: "Connect an AI client", desc: "Link Claude Desktop, VS Code, or Claude Web", href: "/docs" },
                { id: "first-memory", label: "Add your first memory", desc: "Create a rule, project note, or reference" },
                { id: "import", label: "Import from ChatGPT", desc: "Bulk import existing conversation history", href: "/import" },
              ].map(item => (
                <label key={item.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={onboardingSteps[item.id] || false}
                    onChange={(e) => updateOnboardingStep(item.id, e.target.checked)}
                    style={{ marginTop: 4, accentColor: "var(--accent)", cursor: "pointer", flex: 0 }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: onboardingSteps[item.id] ? "var(--text-muted)" : "var(--text)", textDecoration: onboardingSteps[item.id] ? "line-through" : "none" }}>
                      {item.href ? <a href={item.href} style={{ color: "inherit", textDecoration: "none" }}>{item.label}</a> : item.label}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{item.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
          <button
            onClick={dismissOnboarding}
            style={{
              flex: 0,
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              padding: 0,
              fontSize: 18,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 28 }}>
        {[
          { label: "Total", value: memories.length, color: "var(--text)", category: "" },
          { label: "Stacks", value: totalByCategory.stack, color: CATEGORY_COLORS.stack, category: "stack" },
          { label: "Rules", value: totalByCategory.rules, color: CATEGORY_COLORS.rules, category: "rules" },
          { label: "Projects", value: totalByCategory.projects, color: CATEGORY_COLORS.projects, category: "projects" },
          { label: "References", value: totalByCategory.references, color: CATEGORY_COLORS.references, category: "references" },
        ].map(({ label, value, color, category }) => {
          const isActive = categoryFilter === category;
          return (
            <button
              key={label}
              onClick={() => setCategoryFilter(isActive ? "" : category)}
              className={`stat-card ${isActive ? "active" : ""}`}
            >
              <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, fontWeight: 600 }}>
                {label}
              </div>
              <div style={{ fontSize: 32, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
            </button>
          );
        })}
      </div>

      {/* Memory tabs */}
      <div style={{ marginBottom: 20, display: "flex", gap: 2, borderBottom: "1px solid var(--border)", alignItems: "flex-end" }}>
        <button
          onClick={() => setMemoryTab("active")}
          style={{
            padding: "8px 16px",
            background: memoryTab === "active" ? "var(--surface)" : "transparent",
            border: "none",
            borderTop: memoryTab === "active" ? "3px solid var(--accent)" : "3px solid transparent",
            borderLeft: memoryTab === "active" ? "1px solid var(--border)" : "1px solid transparent",
            borderRight: memoryTab === "active" ? "1px solid var(--border)" : "1px solid transparent",
            borderBottom: memoryTab === "active" ? "1px solid var(--surface)" : "none",
            color: memoryTab === "active" ? "var(--text)" : "var(--text-muted)",
            fontSize: 13,
            fontWeight: memoryTab === "active" ? 600 : 400,
            cursor: "pointer",
            marginBottom: -1,
            borderRadius: "4px 4px 0 0",
          }}
        >
          Active {memories.length > 0 && <span style={{ marginLeft: 4, fontSize: 11, opacity: 0.7 }}>({memories.length})</span>}
        </button>
        <button
          onClick={() => setMemoryTab("archived")}
          style={{
            padding: "8px 16px",
            background: memoryTab === "archived" ? "var(--surface)" : "transparent",
            border: "none",
            borderTop: memoryTab === "archived" ? "3px solid var(--accent)" : "3px solid transparent",
            borderLeft: memoryTab === "archived" ? "1px solid var(--border)" : "1px solid transparent",
            borderRight: memoryTab === "archived" ? "1px solid var(--border)" : "1px solid transparent",
            borderBottom: memoryTab === "archived" ? "1px solid var(--surface)" : "none",
            color: memoryTab === "archived" ? "var(--text)" : "var(--text-muted)",
            fontSize: 13,
            fontWeight: memoryTab === "archived" ? 600 : 400,
            cursor: "pointer",
            marginBottom: -1,
            borderRadius: "4px 4px 0 0",
          }}
        >
          Archived {archivedData?.total ? <span style={{ marginLeft: 4, fontSize: 11, opacity: 0.7 }}>({archivedData.total})</span> : null}
        </button>
      </div>

      {memoryTab === "active" && (
        <div style={{ marginBottom: 16, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div className="search-input-wrapper">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--text-muted)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", zIndex: 1 }}
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by keyword or tag… (Press '/' to search)"
              id="search-input"
            />
            <span
              style={{
                position: "absolute",
                right: 10,
                top: "50%",
                transform: "translateY(-50%)",
                fontSize: 10,
                color: "var(--text-muted)",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                padding: "2px 6px",
                pointerEvents: "none",
                fontWeight: 600,
              }}
            >
              /
            </span>
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            style={{ padding: "8px 12px", minWidth: 140, height: 38 }}
          >
            <option value="">All categories</option>
            <option value="stack">Stacks</option>
            <option value="rules">Rules</option>
            <option value="projects">Projects</option>
            <option value="references">References</option>
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'newest' | 'oldest' | 'alphabetical')}
            style={{ padding: "8px 12px", minWidth: 120, height: 38 }}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="alphabetical">Alphabetical</option>
          </select>

          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="date"
              value={dateStart}
              onChange={(e) => setDateStart(e.target.value)}
              title="Filter from date"
              style={{ padding: "8px 12px", minWidth: 120, height: 38 }}
            />
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>to</span>
            <input
              type="date"
              value={dateEnd}
              onChange={(e) => setDateEnd(e.target.value)}
              title="Filter to date"
              style={{ padding: "8px 12px", minWidth: 120, height: 38 }}
            />
          </div>

          {(filter || categoryFilter || sortBy !== 'newest' || dateStart || dateEnd) && (
            <button
              onClick={() => { setFilter(""); setCategoryFilter(""); setSortBy('newest'); setDateStart(""); setDateEnd(""); }}
              style={{
                padding: "8px 16px",
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                color: "var(--accent)",
                fontSize: 12,
                fontWeight: 600,
                height: 38,
                borderRadius: "var(--radius)",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--accent)";
                e.currentTarget.style.background = "var(--accent-dim)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--border)";
                e.currentTarget.style.background = "var(--surface2)";
              }}
            >
              Clear all
            </button>
          )}
        </div>
      )}

      {memoryTab === "archived" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {archivedData?.archived && archivedData.archived.length > 0 ? (
            archivedData.archived.map((memory: any) => {
              const restoreMut = useMutation({
                mutationFn: () => restoreMemory({ data: { id: memory.id } }),
                onSuccess: () => {
                  queryClient.invalidateQueries({ queryKey: ["memories-archived"] });
                  queryClient.invalidateQueries({ queryKey: ["memories"] });
                },
              });

              const deleteMut = useMutation({
                mutationFn: () => permanentlyDeleteArchivedMemory({ data: { id: memory.id } }),
                onSuccess: () => {
                  queryClient.invalidateQueries({ queryKey: ["memories-archived"] });
                },
              });

              return (
                <div
                  key={memory.id}
                  style={{
                    padding: "14px 18px",
                    borderBottom: "1px solid var(--border)",
                    background: "rgba(168,85,247,0.02)",
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: "16px",
                    alignItems: "start",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <p style={{ marginBottom: 6, lineHeight: 1.5, wordBreak: "break-word", color: "var(--text-muted)" }}>
                      {memory.fact}
                    </p>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{
                        fontSize: 10,
                        fontWeight: 600,
                        padding: "2px 8px",
                        background: `${CATEGORY_COLORS[memory.category]}18`,
                        color: CATEGORY_COLORS[memory.category],
                        borderRadius: 3,
                      }}>
                        {CATEGORY_LABELS[memory.category]}
                      </span>
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {new Date(memory.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      onClick={() => restoreMut.mutate()}
                      disabled={restoreMut.isPending}
                      style={{
                        padding: "4px 10px",
                        background: "rgba(76,175,80,0.15)",
                        border: "1px solid rgba(76,175,80,0.4)",
                        color: "rgb(76,175,80)",
                        fontSize: 11,
                        fontWeight: 600,
                        borderRadius: "var(--radius)",
                        cursor: restoreMut.isPending ? "default" : "pointer",
                      }}
                    >
                      {restoreMut.isPending ? "Restoring…" : "Restore"}
                    </button>
                    <button
                      onClick={() => {
                        if (confirm("Permanently delete this archived memory?")) {
                          deleteMut.mutate();
                        }
                      }}
                      disabled={deleteMut.isPending}
                      style={{
                        padding: "4px 10px",
                        background: "rgba(239,68,68,0.15)",
                        border: "1px solid rgba(239,68,68,0.4)",
                        color: "var(--error)",
                        fontSize: 11,
                        fontWeight: 600,
                        borderRadius: "var(--radius)",
                        cursor: deleteMut.isPending ? "default" : "pointer",
                      }}
                    >
                      {deleteMut.isPending ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <p style={{ color: "var(--text-muted)", fontSize: 13, textAlign: "center", padding: "48px 24px" }}>
              No archived memories
            </p>
          )}
        </div>
      )}

      {memoryTab === "active" && isLoading && (
        <div style={{ textAlign: "center", padding: "48px 24px", color: "var(--text-muted)" }}>
          Loading memories…
        </div>
      )}
      {memoryTab === "active" && isError && (
        <div
          style={{
            textAlign: "center",
            padding: "24px",
            color: "var(--error)",
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.25)",
            borderRadius: "var(--radius)",
          }}
        >
          Failed to load memories.
        </div>
      )}
      {!isLoading && !isError && memories.length === 0 && (
        <div
          style={{
            textAlign: "center",
            padding: "56px 24px",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
          }}
        >
          <svg
            width="56"
            height="56"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--border)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ marginBottom: 16, display: "block", margin: "0 auto 16px" }}
          >
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <path d="M3 9h18M9 21V9" />
            <line x1="12" y1="13" x2="12" y2="17" />
            <line x1="10" y1="15" x2="14" y2="15" />
          </svg>
          <p style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>
            No memories yet
          </p>
          <p style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 320, margin: "0 auto" }}>
            Paste some memories using the Bulk Ingest panel above to get started. They'll appear here and become searchable via the MCP endpoint.
          </p>
        </div>
      )}
      {memoryTab === "active" && !isLoading && !isError && memories.length > 0 && (
        <MemoryTable
          memories={memories}
          filter={filter}
          categoryFilter={categoryFilter}
          sortBy={sortBy}
          dateStart={dateStart}
          dateEnd={dateEnd}
          onShowHistory={setActiveTimelineId}
          onExportZip={triggerExport}
          workspaces={workspaces}
          currentProjectKey={projectKey}
        />
      )}

      {showNewMemory && (
        <NewMemoryModal
          onClose={() => setShowNewMemory(false)}
          onSaved={invalidate}
          projectKey={projectKey === "personal" ? undefined : projectKey}
        />
      )}

      {activeTimelineId && (
        <HistoryModal
          memoryId={activeTimelineId}
          onClose={() => setActiveTimelineId(null)}
          onReverted={() => {
            setActiveTimelineId(null);
            invalidate();
          }}
        />
      )}
      </div>
    </div>
  );
}

function HistoryModal({
  memoryId,
  onClose,
  onReverted,
}: {
  memoryId: string;
  onClose: () => void;
  onReverted: () => void;
}) {
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
      alert("Revert failed: " + String(err));
    },
  });

  return (
    <div style={{
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: "rgba(0, 0, 0, 0.4)",
      backdropFilter: "blur(4px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 1000,
    }}>
      <div style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        width: "90%",
        maxWidth: 600,
        maxHeight: "80vh",
        display: "flex",
        flexDirection: "column",
        boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
      }}>
        <div style={{
          padding: "16px 20px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Version History</h3>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 16,
            }}
          >
            ✕
          </button>
        </div>

        <div style={{
          padding: 20,
          overflowY: "auto",
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}>
          {isLoading && <div style={{ color: "var(--text-muted)", textAlign: "center" }}>Loading history…</div>}
          {isError && <div style={{ color: "var(--error)", textAlign: "center" }}>Failed to load timeline.</div>}
          {!isLoading && !isError && versions.length === 0 && (
            <div style={{ color: "var(--text-muted)", textAlign: "center" }}>No history found for this memory.</div>
          )}

          {!isLoading && !isError && versions.map((v: any, index: number) => {
            const isLatest = index === 0;
            return (
              <div
                key={v.id}
                style={{
                  borderLeft: "2px solid var(--accent)",
                  paddingLeft: 16,
                  position: "relative",
                  marginBottom: index === versions.length - 1 ? 0 : 8,
                }}
              >
                <div style={{
                  position: "absolute",
                  left: -5,
                  top: 4,
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "var(--accent)",
                }} />
                
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 6,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{
                      fontSize: 10,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      color: "var(--accent)",
                      background: "var(--tag-bg)",
                      border: "1px solid var(--tag-border)",
                      padding: "2px 6px",
                      borderRadius: 4,
                    }}>
                      {v.changeReason || "changed"}
                    </span>
                    {isLatest && (
                      <span style={{
                        fontSize: 11,
                        color: "var(--text-muted)",
                        fontStyle: "italic",
                      }}>
                        (Current)
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {new Date(v.timestamp).toLocaleString()}
                  </span>
                </div>

                <p style={{ margin: "0 0 8px 0", fontSize: 13, lineHeight: 1.5, wordBreak: "break-word" }}>
                  {v.fact}
                </p>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 10, color: "var(--text-muted)", background: "var(--surface2)", padding: "2px 6px", borderRadius: 4 }}>
                      {v.category}
                    </span>
                    {(v.tags || "").split(",").map((t: string) => t.trim()).filter(Boolean).map((tag: string) => (
                      <span key={tag} style={{ fontSize: 10, color: "var(--text-muted)", background: "var(--tag-bg)", border: "1px solid var(--tag-border)", padding: "1px 5px", borderRadius: 4 }}>
                        {tag}
                      </span>
                    ))}
                  </div>

                  {!isLatest && (
                    <button
                      onClick={() => revertMutation.mutate(v.id)}
                      disabled={revertMutation.isPending}
                      style={{
                        padding: "3.5px 8px",
                        background: "var(--accent)",
                        color: "#fff",
                        border: "none",
                        fontSize: 11,
                        fontWeight: 600,
                        borderRadius: 4,
                        cursor: "pointer",
                      }}
                    >
                      {revertMutation.isPending ? "Reverting…" : "Revert"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
