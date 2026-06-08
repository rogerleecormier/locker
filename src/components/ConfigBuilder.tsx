/**
 * ConfigBuilder — unified Agent Config editor (replaces AgentConfigBuilder + TemplateFormModal).
 *
 * Modes:
 *   "memory"   — commit to vault as a configs-category memory entry (default)
 *   "template" — save as a reusable memory template (no vault entry)
 *
 * Access: only this component is allowed to write to the configs category via
 * saveAgentConfig() / createMemoryTemplate() / updateMemoryTemplate() on the server.
 * Generic commit_memory / update_memory MCP calls are blocked from the configs
 * category at the backend ABAC layer.
 *
 * Template export panel (step "Export"): workflow-category templates are UI-only
 * and never surfaced in the MCP tool schema.
 */
import * as React from "react";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createMemoryTemplate,
  getUserWorkspaces,
  saveAgentConfig,
  updateMemoryTemplate,
} from "~/server/memoryFunctions";
import { Button } from "./ui/button";
import { Label, Input, Textarea, Select } from "./ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import { FIELD_OPTIONS, DEFAULT_STACK_PREFERENCES } from "~/lib/stackFields";

// ── Constants ─────────────────────────────────────────────────────────────────

const TEMPLATE_CATEGORY_OPTIONS = [
  { value: "configs", label: "Agent Config" },
  { value: "compliance", label: "Compliance" },
  { value: "project_management", label: "Project Management" },
  { value: "product_management", label: "Product Management" },
  { value: "devops", label: "DevOps" },
  { value: "devsecops", label: "DevSecOps" },
  { value: "cicd", label: "CI/CD" },
] as const;

type TemplateCategoryValue = typeof TEMPLATE_CATEGORY_OPTIONS[number]["value"];
type WorkflowCategoryValue = Exclude<TemplateCategoryValue, "configs">;

const WORKFLOW_CATEGORIES: WorkflowCategoryValue[] = [
  "compliance",
  "project_management",
  "product_management",
  "devops",
  "devsecops",
  "cicd",
];

const CATEGORY_PRESET_RULES: Record<TemplateCategoryValue, string[]> = {
  configs: [
    "Always check Locker for existing rules before proposing new ones.",
    "Prefer atomic, declarative facts over long narrative blocks.",
    "Tag memories with lowercase, hyphenated identifiers.",
  ],
  compliance: [
    "All data at rest must be encrypted using AES-256-GCM.",
    "PII must never be stored in plain-text memory — use store_credential.",
    "Access logs must be retained for at least 90 days.",
    "Enforce least-privilege access controls on all vault scopes.",
  ],
  project_management: [
    "Every task must have an owner, description, and due date.",
    "Separate decisions into: context, decision, and outcome sections.",
    "Action items must be tagged with #action and include a priority level.",
    "Sprint goals must be measurable and time-boxed.",
  ],
  product_management: [
    "Features require a problem statement before implementation begins.",
    "Acceptance criteria must be written in Given/When/Then format.",
    "Validation gates: design review → engineering review → QA → launch.",
    "KPIs must be defined before a feature ships to production.",
  ],
  devops: [
    "All infrastructure must be defined as code (IaC).",
    "Secrets must never appear in environment variables without a secrets manager.",
    "Container images must be scanned for CVEs before deployment.",
    "All deployments must have a documented rollback procedure.",
  ],
  devsecops: [
    "SAST and DAST scans are required on every PR.",
    "Dependency vulnerability scanning must run in CI.",
    "Security findings above CVSS 7.0 must be remediated before merge.",
    "Zero-trust: every service-to-service call requires mutual TLS.",
  ],
  cicd: [
    "Every pipeline stage must have explicit pass/fail criteria.",
    "Build artifacts must be immutable and versioned.",
    "Production deployments require at least one human approval gate.",
    "Pipeline secrets must be stored in a vault, never in pipeline config files.",
  ],
};

const STEPS = [
  "Metadata",
  "Core Tech",
  "Infrastructure",
  "Additional Specs",
  "Parameters",
  "Variables",
  "Rules",
  "Code Style",
  "System Prompt",
  "Export",
] as const;

type StepLabel = typeof STEPS[number];

const DEFAULT_SYSTEM_PROMPT = `# Locker Memory Vault Integration — Custom Instructions

You have access to Locker (MCP memory vault) for user profile, projects, rules, and secrets. Proactively read/write to it throughout our chat without prompting.

1. READ:
- Start: Call get_memory_summary or list_accessible_scopes on first turn to align context.
- Before coding/answering: Search relevant guidelines using recall_context (use optimize:true for summaries) or search_memories. Don't assume; check Locker first.

2. WRITE:
- Automatically call commit_memory when I state preferences, tech stack choices, rules, or project paths.
- Fact format: Atomic, third-person declarative statements (no "I" or "You").
- Categories: "rules" (guidelines), "projects" (configs/state), "references" (background). Assign lowercase tags.
- Update/Delete: If a rule/state changes, find the ID and call update_memory or delete_memory. Prevent duplicate/stale data.

3. SECRETS:
- Never commit plaintext API keys/secrets to normal memories. Use store_credential and retrieve_credential.

4. PROTOCOLS:
- Background use: Execute calls silently.
- Priority: Locker memories supersede your defaults.`;

// ── Zod schemas ───────────────────────────────────────────────────────────────

const AgentConfigFormSchema = z.object({
  name: z.string().min(1, "Name is required").max(128),
  systemPrompt: z.string().max(50000).optional().default(""),
  techStack: z.record(z.string(), z.string()),
  codeStyle: z.record(z.string(), z.string()),
  params: z.record(z.string(), z.string()),
  variables: z.array(z.object({
    key: z.string().min(1),
    description: z.string().optional().default(""),
    default: z.string().optional().default(""),
  })),
  systemProperties: z.record(z.string(), z.string()),
  ruleInclusions: z.array(z.string()),
  tags: z.string(),
  projectKey: z.string().optional(),
  exportAsTemplate: z.boolean(),
  templateCategory: z.enum(["configs", "compliance", "project_management", "product_management", "devops", "devsecops", "cicd"]),
  templateDescription: z.string().max(512),
  // Workflow export (UI-only, never sent to MCP)
  exportWorkflowTemplates: z.array(z.enum(["compliance", "project_management", "product_management", "devops", "devsecops", "cicd"])).default([]),
});

type AgentConfigFormData = z.infer<typeof AgentConfigFormSchema>;

// ── Sub-components ────────────────────────────────────────────────────────────

function StackPillField({ label, options, value, onChange }: {
  label: string; options: string[]; value: string; onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors cursor-pointer ${
              value === opt
                ? "bg-accent/15 border-accent/60 text-accent"
                : "bg-surface2 border-border text-text-muted hover:border-border-hover hover:text-text"
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

function KVEditor({ title, entries, onAdd, onRemove, keyPlaceholder, valPlaceholder, className }: {
  title: string;
  entries: Record<string, string>;
  onAdd: (k: string, v: string) => void;
  onRemove: (k: string) => void;
  keyPlaceholder?: string;
  valPlaceholder?: string;
  className?: string;
}) {
  const [newKey, setNewKey] = React.useState("");
  const [newVal, setNewVal] = React.useState("");

  function submit() {
    if (!newKey.trim() || !newVal.trim()) return;
    onAdd(newKey.trim(), newVal.trim());
    setNewKey("");
    setNewVal("");
  }

  return (
    <div className={`bg-surface2 border border-border p-4 rounded-xl flex flex-col gap-3 ${className ?? ""}`}>
      <span className="text-[10px] font-bold text-accent uppercase tracking-wider">{title}</span>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <Label className="text-[9px]">Key</Label>
          <Input value={newKey} onChange={(e) => setNewKey(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} className="h-8 text-xs font-mono" placeholder={keyPlaceholder ?? "key"} />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[9px]">Value</Label>
          <Input value={newVal} onChange={(e) => setNewVal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} className="h-8 text-xs" placeholder={valPlaceholder ?? "value"} />
        </div>
      </div>
      <Button onClick={submit} disabled={!newKey.trim() || !newVal.trim()} size="sm" variant="outline">+ Add Entry</Button>
      {Object.keys(entries).length > 0 && (
        <div className="flex flex-col gap-1.5 mt-1 border border-border rounded-lg p-3 bg-surface max-h-40 overflow-y-auto no-scrollbar">
          {Object.entries(entries).map(([k, v]) => (
            <div key={k} className="flex justify-between items-center text-xs">
              <span><span className="font-mono font-bold text-accent mr-2">{k}</span>{v}</span>
              <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-error hover:bg-error/5"
                onClick={() => onRemove(k)}>✕</Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getDefaultTechStack() {
  return {
    language: DEFAULT_STACK_PREFERENCES.language,
    frontend: DEFAULT_STACK_PREFERENCES.frontend,
    hosting: DEFAULT_STACK_PREFERENCES.hosting,
    database: DEFAULT_STACK_PREFERENCES.database,
    orm: DEFAULT_STACK_PREFERENCES.orm,
    auth: DEFAULT_STACK_PREFERENCES.auth,
    styling: DEFAULT_STACK_PREFERENCES.styling,
    stateCache: DEFAULT_STACK_PREFERENCES.stateCache,
    storage: DEFAULT_STACK_PREFERENCES.storage,
    search: DEFAULT_STACK_PREFERENCES.search,
    vector: DEFAULT_STACK_PREFERENCES.vector,
    componentLibrary: DEFAULT_STACK_PREFERENCES.componentLibrary,
  };
}

function parseJsonSafe<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function normalizeEditingTemplate(t: any): Partial<AgentConfigFormData> | null {
  if (!t?.configPayload) return null;
  try {
    const p = JSON.parse(t.configPayload);
    const stack = { ...getDefaultTechStack(), ...(p.techStack ?? {}) };
    return {
      name: t.name ?? "",
      tags: p.tags ?? "",
      systemPrompt: p.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
      techStack: stack,
      codeStyle: p.codeStyle ?? {},
      params: parseJsonSafe<Record<string, string>>(t.params, p.params ?? {}),
      variables: parseJsonSafe<Array<{ key: string; description: string; default: string }>>(t.variables, p.variables ?? []),
      systemProperties: parseJsonSafe<Record<string, string>>(t.systemProperties, p.systemProperties ?? {}),
      ruleInclusions: p.ruleInclusions ?? p.rules ?? [],
      templateCategory: (t.category as TemplateCategoryValue) ?? "configs",
      templateDescription: t.description ?? "",
    };
  } catch { return null; }
}

// ── Main component ────────────────────────────────────────────────────────────

export interface ConfigBuilderProps {
  isOpen: boolean;
  onClose: () => void;
  /** "memory" saves a vault entry; "template" saves only a reusable template record. */
  mode?: "memory" | "template";
  /** When set, pre-populates the form for editing an existing template. */
  editingTemplate?: any;
}

export function ConfigBuilder({ isOpen, onClose, mode = "memory", editingTemplate }: ConfigBuilderProps) {
  const queryClient = useQueryClient();
  const isTemplateMode = mode === "template";
  const isEdit = !!editingTemplate;

  const [step, setStep] = React.useState(1);
  const [validationError, setValidationError] = React.useState<string | null>(null);

  // ── Form state ─────────────────────────────────────────────────────────────
  const [name, setName] = React.useState("");
  const [tags, setTags] = React.useState("");
  const [projectKey, setProjectKey] = React.useState("personal");
  const [templateCategory, setTemplateCategory] = React.useState<TemplateCategoryValue>("configs");
  const [templateDescription, setTemplateDescription] = React.useState("");
  const [exportAsTemplate, setExportAsTemplate] = React.useState(isTemplateMode);
  const [exportWorkflowTemplates, setExportWorkflowTemplates] = React.useState<WorkflowCategoryValue[]>([]);

  // Tech stack
  const [techStack, setTechStack] = React.useState<Record<string, string>>(getDefaultTechStack());

  // Params (arbitrary k/v config parameters)
  const [params, setParams] = React.useState<Record<string, string>>({});

  // Variables ({{KEY}} template placeholders)
  const [variables, setVariables] = React.useState<Array<{ key: string; description: string; default: string }>>([]);
  const [newVarKey, setNewVarKey] = React.useState("");
  const [newVarDesc, setNewVarDesc] = React.useState("");
  const [newVarDefault, setNewVarDefault] = React.useState("");

  // System properties (runtime/env system-level config)
  const [systemProperties, setSystemProperties] = React.useState<Record<string, string>>({});

  // Rules
  const [ruleInclusions, setRuleInclusions] = React.useState<string[]>(CATEGORY_PRESET_RULES.configs);
  const [newRule, setNewRule] = React.useState("");

  // Code style
  const [codeStyle, setCodeStyle] = React.useState<Record<string, string>>({});

  // System prompt
  const [systemPrompt, setSystemPrompt] = React.useState(DEFAULT_SYSTEM_PROMPT);

  const totalSteps = STEPS.length;

  const { data: workspacesList = [] } = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => getUserWorkspaces(),
  });
  const workspaces = Array.isArray(workspacesList) ? workspacesList : [];

  // ── Reset on open ──────────────────────────────────────────────────────────
  React.useEffect(() => {
    if (!isOpen) return;
    setStep(1);
    setValidationError(null);
    setExportAsTemplate(isTemplateMode);
    setExportWorkflowTemplates([]);

    const parsed = editingTemplate ? normalizeEditingTemplate(editingTemplate) : null;
    if (parsed) {
      setName(parsed.name ?? "");
      setTags(parsed.tags ?? "");
      setProjectKey("personal");
      setTemplateCategory((parsed.templateCategory as TemplateCategoryValue) ?? "configs");
      setTemplateDescription(parsed.templateDescription ?? "");
      setSystemPrompt(parsed.systemPrompt ?? DEFAULT_SYSTEM_PROMPT);
      setTechStack(parsed.techStack ?? getDefaultTechStack());
      setCodeStyle(parsed.codeStyle ?? {});
      setParams(parsed.params ?? {});
      setVariables(parsed.variables ?? []);
      setSystemProperties(parsed.systemProperties ?? {});
      setRuleInclusions(parsed.ruleInclusions?.length ? parsed.ruleInclusions : CATEGORY_PRESET_RULES.configs);
    } else {
      setName("");
      setTags("");
      setProjectKey("personal");
      setTemplateCategory("configs");
      setTemplateDescription("");
      setSystemPrompt(DEFAULT_SYSTEM_PROMPT);
      setTechStack(getDefaultTechStack());
      setCodeStyle({});
      setParams({});
      setVariables([]);
      setSystemProperties({});
      setRuleInclusions(CATEGORY_PRESET_RULES.configs);
    }
  }, [editingTemplate, isOpen, isTemplateMode]);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async () => {
      const formData: AgentConfigFormData = {
        name: name.trim(),
        systemPrompt: systemPrompt.trim(),
        techStack,
        codeStyle,
        params,
        variables,
        systemProperties,
        ruleInclusions,
        tags,
        projectKey: projectKey === "personal" ? undefined : projectKey,
        exportAsTemplate: isTemplateMode ? true : exportAsTemplate,
        templateCategory: "configs",
        templateDescription,
        exportWorkflowTemplates,
      };

      const result = AgentConfigFormSchema.safeParse(formData);
      if (!result.success) {
        throw new Error(result.error.issues[0]?.message ?? "Validation error");
      }

      const configPayload = JSON.stringify({
        systemPrompt: result.data.systemPrompt,
        techStack: result.data.techStack,
        codeStyle: result.data.codeStyle,
        ruleInclusions: result.data.ruleInclusions,
        tags: result.data.tags,
        params: result.data.params,
        variables: result.data.variables,
        systemProperties: result.data.systemProperties,
      });

      if (isTemplateMode) {
        const templateData = {
          name: result.data.name,
          description: result.data.templateDescription || `Agent config: ${result.data.name}`,
          category: "configs" as const,
          configPayload,
          params: result.data.params,
          variables: result.data.variables,
          systemProperties: result.data.systemProperties,
          workflowCategory: "configs" as const,
        };
        if (isEdit) {
          return updateMemoryTemplate({ data: { ...templateData, id: editingTemplate.id } });
        }
        return createMemoryTemplate({ data: templateData });
      }

      return saveAgentConfig({ data: result.data });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memories"] });
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      onClose();
    },
    onError: (err: any) => {
      setValidationError(err.message || "Failed to save agent config");
    },
  });

  // ── Helpers ────────────────────────────────────────────────────────────────
  function addVariable() {
    if (!newVarKey.trim()) return;
    if (variables.some((v) => v.key === newVarKey.trim())) {
      setValidationError("Variable key already exists");
      return;
    }
    setVariables([...variables, { key: newVarKey.trim(), description: newVarDesc.trim(), default: newVarDefault.trim() }]);
    setNewVarKey(""); setNewVarDesc(""); setNewVarDefault("");
    setValidationError(null);
  }

  function addRule() {
    if (!newRule.trim()) return;
    setRuleInclusions([...ruleInclusions, newRule.trim()]);
    setNewRule("");
  }

  function toggleWorkflowExport(cat: WorkflowCategoryValue) {
    setExportWorkflowTemplates((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  }

  const stepLabel = STEPS[step - 1] as StepLabel;
  const isLastStep = step === totalSteps;
  const canAdvance = step === 1 ? name.trim().length > 0 && (!isTemplateMode || templateDescription.trim().length > 0) : true;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Dialog open={isOpen} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-[1120px] min-w-0">
        <DialogHeader>
          <DialogTitle>
            {isTemplateMode
              ? (isEdit ? "Edit Agent Config Template" : "New Agent Config Template")
              : "Agent Config Builder"}
          </DialogTitle>
          <DialogDescription>
            {isTemplateMode
              ? "Build a reusable Agent Config template with tech stack, parameters, variables, rules, and system prompt."
              : <>Build and commit a structured agent configuration to your vault under the protected <code className="text-xs font-mono text-accent bg-accent/10 px-1 py-0.5 rounded">configs</code> category.</>
            }
          </DialogDescription>

          {/* Step progress bar */}
          <div className="mt-3 -mb-2">
            <div className="flex items-center gap-1 pb-3 border-b border-border">
              {STEPS.map((label, i) => {
                const s = i + 1;
                const active = step === s;
                const done = step > s;
                return (
                  <React.Fragment key={s}>
                    <button
                      type="button"
                      onClick={() => done && setStep(s)}
                      title={label}
                      className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[9px] font-bold flex-shrink-0 transition-colors ${
                        active
                          ? "bg-accent text-white"
                          : done
                          ? "bg-accent/20 text-accent cursor-pointer hover:bg-accent/40"
                          : "bg-border text-text-muted/40 cursor-default"
                      }`}
                    >
                      {done ? "✓" : s}
                    </button>
                    {i < STEPS.length - 1 && (
                      <div className={`flex-1 h-px ${done ? "bg-accent/30" : "bg-border"}`} />
                    )}
                  </React.Fragment>
                );
              })}
            </div>
            <div className="pt-2 text-xs font-semibold text-accent">
              Step {step} of {STEPS.length} — {STEPS[step - 1]}
            </div>
          </div>
        </DialogHeader>

        <div className="py-2 overflow-y-auto overflow-x-hidden max-h-[60vh] pr-1 flex flex-col gap-4 min-w-0">
          {validationError && (
            <div className="p-3 bg-error/10 border border-error/20 rounded-lg text-error text-xs font-medium">
              {validationError}
            </div>
          )}

          {/* ── Step 1: Metadata ────────────────────────────────────────────── */}
          {stepLabel === "Metadata" && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cb-name">Config Name</Label>
                <Input
                  id="cb-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. claude-code-baseline, my-next-app-rules"
                />
              </div>
              {isTemplateMode ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="cb-tmpl-desc">Template Description</Label>
                  <Textarea
                    id="cb-tmpl-desc"
                    value={templateDescription}
                    onChange={(e) => setTemplateDescription(e.target.value)}
                    placeholder="Describe the purpose and scope of this template..."
                    rows={3}
                  />
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="cb-tags">Tags</Label>
                    <Input
                      id="cb-tags"
                      value={tags}
                      onChange={(e) => setTags(e.target.value)}
                      placeholder="e.g. architecture, baseline, llm-config"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="cb-workspace">Destination Workspace</Label>
                    <Select id="cb-workspace" value={projectKey} onChange={(e) => setProjectKey(e.target.value)}>
                      {workspaces.map((w: any) => (
                        <option key={w.key} value={w.key}>{w.label}</option>
                      ))}
                    </Select>
                  </div>
                </>
              )}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cb-cat">Config Type</Label>
                <Select id="cb-cat" value={templateCategory} disabled onChange={() => {}}>
                  {TEMPLATE_CATEGORY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </Select>
                <span className="text-[10px] text-text-muted leading-relaxed">
                  Agent Config builders are locked to the protected configs category.
                </span>
              </div>
            </>
          )}

          {/* ── Step 2: Core Tech ───────────────────────────────────────────── */}
          {stepLabel === "Core Tech" && (
            <div className="flex flex-col gap-3">
              <StackPillField label="Language" options={FIELD_OPTIONS.language} value={techStack.language ?? ""} onChange={(v) => setTechStack({ ...techStack, language: v })} />
              <StackPillField label="Frontend" options={FIELD_OPTIONS.frontend} value={techStack.frontend ?? ""} onChange={(v) => setTechStack({ ...techStack, frontend: v })} />
              <StackPillField label="Styling" options={FIELD_OPTIONS.styling} value={techStack.styling ?? ""} onChange={(v) => setTechStack({ ...techStack, styling: v })} />
              <StackPillField label="Component Library" options={FIELD_OPTIONS.componentLibrary} value={techStack.componentLibrary ?? ""} onChange={(v) => setTechStack({ ...techStack, componentLibrary: v })} />
            </div>
          )}

          {/* ── Step 3: Infrastructure ──────────────────────────────────────── */}
          {stepLabel === "Infrastructure" && (
            <div className="flex flex-col gap-3">
              <StackPillField label="Hosting" options={FIELD_OPTIONS.hosting} value={techStack.hosting ?? ""} onChange={(v) => setTechStack({ ...techStack, hosting: v })} />
              <StackPillField label="Database" options={FIELD_OPTIONS.database} value={techStack.database ?? ""} onChange={(v) => setTechStack({ ...techStack, database: v })} />
              <StackPillField label="ORM / Data Access" options={FIELD_OPTIONS.orm} value={techStack.orm ?? ""} onChange={(v) => setTechStack({ ...techStack, orm: v })} />
              <StackPillField label="State & Cache" options={FIELD_OPTIONS.stateCache} value={techStack.stateCache ?? ""} onChange={(v) => setTechStack({ ...techStack, stateCache: v })} />
              <StackPillField label="File Storage" options={FIELD_OPTIONS.storage} value={techStack.storage ?? ""} onChange={(v) => setTechStack({ ...techStack, storage: v })} />
            </div>
          )}

          {/* ── Step 4: Additional Specs ────────────────────────────────────── */}
          {stepLabel === "Additional Specs" && (
            <div className="flex flex-col gap-3">
              <StackPillField label="Auth" options={FIELD_OPTIONS.auth} value={techStack.auth ?? ""} onChange={(v) => setTechStack({ ...techStack, auth: v })} />
              <StackPillField label="Search" options={FIELD_OPTIONS.search} value={techStack.search ?? ""} onChange={(v) => setTechStack({ ...techStack, search: v })} />
              <StackPillField label="Vector / AI Storage" options={FIELD_OPTIONS.vector} value={techStack.vector ?? ""} onChange={(v) => setTechStack({ ...techStack, vector: v })} />
            </div>
          )}

          {/* ── Step 5: Parameters ─────────────────────────────────────────── */}
          {stepLabel === "Parameters" && (
            <div className="flex flex-col gap-4">
              <div className="text-xs text-text-muted leading-relaxed">
                Arbitrary configuration parameters for the agent — LLM settings, API endpoints, feature flags, or any key/value config your workflow requires.
              </div>
              <KVEditor
                title="Configuration Parameters"
                entries={params}
                onAdd={(k, v) => setParams({ ...params, [k]: v })}
                onRemove={(k) => { const s = { ...params }; delete s[k]; setParams(s); }}
                keyPlaceholder="e.g. max_tokens, api_base_url"
                valPlaceholder="e.g. 4096, https://api.example.com"
              />
              <KVEditor
                title="System Properties"
                entries={systemProperties}
                onAdd={(k, v) => setSystemProperties({ ...systemProperties, [k]: v })}
                onRemove={(k) => { const s = { ...systemProperties }; delete s[k]; setSystemProperties(s); }}
                keyPlaceholder="e.g. NODE_ENV, REGION"
                valPlaceholder="e.g. production, us-east-1"
              />
            </div>
          )}

          {/* ── Step 6: Variables ──────────────────────────────────────────── */}
          {stepLabel === "Variables" && (
            <div className="flex flex-col gap-4">
              <div className="text-xs text-text-muted leading-relaxed">
                Define named placeholders (<code className="font-mono text-accent bg-accent/10 px-1 rounded">{"{{KEY}}"}</code>) that can be substituted when applying this config to a specific project or environment.
              </div>
              <div className="bg-surface2 border border-border p-4 rounded-xl flex flex-col gap-3">
                <span className="text-[10px] font-bold text-accent uppercase tracking-wider">Define Variable</span>
                <div className="grid grid-cols-3 gap-3">
                  <div className="flex flex-col gap-1">
                    <Label className="text-[9px]">Key (e.g. API_URL)</Label>
                    <Input
                      value={newVarKey}
                      onChange={(e) => setNewVarKey(e.target.value.replace(/[^A-Z0-9_]/gi, "_").toUpperCase())}
                      className="h-8 text-xs font-mono"
                      placeholder="MY_VAR"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-[9px]">Description</Label>
                    <Input value={newVarDesc} onChange={(e) => setNewVarDesc(e.target.value)} className="h-8 text-xs" placeholder="What this variable controls" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-[9px]">Default Value</Label>
                    <Input value={newVarDefault} onChange={(e) => setNewVarDefault(e.target.value)} className="h-8 text-xs" placeholder="optional" />
                  </div>
                </div>
                <Button onClick={addVariable} disabled={!newVarKey.trim()} size="sm" variant="outline">+ Add Variable</Button>
              </div>
              {variables.length > 0 && (
                <div className="flex flex-col gap-2 border border-border bg-surface2 p-3 rounded-lg max-h-[220px] overflow-y-auto no-scrollbar">
                  {variables.map((v) => (
                    <div key={v.key} className="flex justify-between items-center text-xs border-b border-border/40 pb-2 last:border-0 last:pb-0">
                      <div>
                        <span className="font-mono font-bold text-accent mr-2">{`{{${v.key}}}`}</span>
                        {v.description && <span className="text-text-muted">({v.description})</span>}
                        {v.default && <span className="text-text-muted/60 ml-1">default: {v.default}</span>}
                      </div>
                      <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-error hover:bg-error/5"
                        onClick={() => setVariables(variables.filter((x) => x.key !== v.key))}>✕</Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Step 7: Rules ──────────────────────────────────────────────── */}
          {stepLabel === "Rules" && (
            <div className="flex flex-col gap-3">
              <Label>Rule Inclusions</Label>
              <div className="text-[10px] text-text-muted">
                Coding rules, architectural constraints, and behavioral guidelines compiled into every generated config file.
              </div>
              <div className="flex gap-2">
                <Input
                  value={newRule}
                  onChange={(e) => setNewRule(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addRule()}
                  placeholder="Enter a coding rule, guideline, or constraint…"
                  className="flex-1 text-xs"
                />
                <Button onClick={addRule} disabled={!newRule.trim()} size="sm" variant="outline">Add</Button>
              </div>
              {ruleInclusions.length === 0 ? (
                <p className="text-xs text-text-muted italic">No rules defined.</p>
              ) : (
                <div className="flex flex-col gap-2 border border-border bg-surface2 p-3 rounded-lg max-h-[280px] overflow-y-auto no-scrollbar">
                  {ruleInclusions.map((rule, idx) => (
                    <div key={idx} className="flex justify-between items-start text-xs border-b border-border/40 pb-2 last:border-0 last:pb-0 gap-3">
                      <span className="text-text leading-relaxed flex-1">{rule}</span>
                      <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-error hover:bg-error/5 flex-shrink-0"
                        onClick={() => setRuleInclusions(ruleInclusions.filter((_, i) => i !== idx))}>✕</Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Step 8: Code Style ─────────────────────────────────────────── */}
          {stepLabel === "Code Style" && (
            <KVEditor
              title="Code Style Preferences"
              entries={codeStyle}
              onAdd={(k, v) => setCodeStyle({ ...codeStyle, [k]: v })}
              onRemove={(k) => { const s = { ...codeStyle }; delete s[k]; setCodeStyle(s); }}
              keyPlaceholder="e.g. indentation"
              valPlaceholder="e.g. 2-space tabs"
            />
          )}

          {/* ── Step 9: System Prompt ──────────────────────────────────────── */}
          {stepLabel === "System Prompt" && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <Label htmlFor="cb-prompt">System Prompt / LLM Instructions</Label>
                <span className="text-[10px] text-text-muted border border-border rounded-full px-2 py-0.5 leading-tight">Optional</span>
              </div>
              <Textarea
                id="cb-prompt"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="Paste your agent system prompt, coding directives, or LLM parameter block here..."
                rows={14}
                className="font-mono text-xs leading-relaxed"
              />
              <span className="text-[10px] text-text-muted">
                {systemPrompt.length.toLocaleString()} / 50,000 characters
              </span>
            </div>
          )}

          {/* ── Step 10: Export ────────────────────────────────────────────── */}
          {stepLabel === "Export" && (
            <div className="flex flex-col gap-4">
              {/* Vault memory toggle (non-template mode) */}
              <div className="flex items-start gap-3 p-4 bg-surface2 border border-border rounded-xl">
                <input
                  type="checkbox"
                  id="cb-export-tmpl"
                  checked={isTemplateMode ? true : exportAsTemplate}
                  disabled={isTemplateMode}
                  onChange={(e) => setExportAsTemplate(e.target.checked)}
                  className="mt-0.5 cursor-pointer h-4 w-4 rounded accent-accent disabled:cursor-not-allowed disabled:opacity-70"
                />
                <div className="flex flex-col gap-1">
                  <label htmlFor="cb-export-tmpl" className={`text-sm font-semibold ${isTemplateMode ? "cursor-default" : "cursor-pointer"}`}>
                    Export as Reusable Template
                  </label>
                  <span className="text-xs text-text-muted leading-relaxed">
                    {isTemplateMode
                      ? "Template builders always save as reusable templates — option locked."
                      : "Also saves this config as a local template so it can be imported by other workspaces or team members. Templates are UI-only and never exposed via MCP."}
                  </span>
                </div>
              </div>

              {!isTemplateMode && exportAsTemplate && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="cb-tmpl-desc2">Template Description</Label>
                  <Textarea
                    id="cb-tmpl-desc2"
                    value={templateDescription}
                    onChange={(e) => setTemplateDescription(e.target.value)}
                    placeholder="Describe the purpose and scope of this template for future users…"
                    rows={3}
                  />
                </div>
              )}

              {/* Workflow template export (UI-only, never MCP-visible) */}
              <div className="flex flex-col gap-2 p-4 bg-surface2 border border-border rounded-xl">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold">Export Workflow Templates</span>
                  <span className="text-xs text-text-muted leading-relaxed">
                    Generate specialized workflow-category templates from this config. These live exclusively in the frontend templates library and are never exposed through the MCP tool schema.
                  </span>
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {WORKFLOW_CATEGORIES.map((cat) => {
                    const opt = TEMPLATE_CATEGORY_OPTIONS.find((o) => o.value === cat)!;
                    const selected = exportWorkflowTemplates.includes(cat as WorkflowCategoryValue);
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => toggleWorkflowExport(cat as WorkflowCategoryValue)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                          selected
                            ? "bg-accent/15 border-accent/60 text-accent"
                            : "bg-surface border-border text-text-muted hover:border-border-hover hover:text-text"
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
                {exportWorkflowTemplates.length > 0 && (
                  <div className="mt-2 p-3 bg-accent/5 border border-accent/20 rounded-lg">
                    <p className="text-[11px] text-accent font-medium">
                      Will create {exportWorkflowTemplates.length} additional template{exportWorkflowTemplates.length !== 1 ? "s" : ""} with category-specific preset rules merged in.
                    </p>
                  </div>
                )}
              </div>

              {/* Summary */}
              <div className="p-4 border border-accent/20 bg-accent/5 rounded-xl flex flex-col gap-2">
                <span className="text-xs font-bold text-accent uppercase tracking-wider">Summary</span>
                <div className="text-xs text-text space-y-1">
                  <div><span className="text-text-muted">Config Name:</span> {name || "—"}</div>
                  {!isTemplateMode && <div><span className="text-text-muted">Workspace:</span> {projectKey}</div>}
                  <div><span className="text-text-muted">Type:</span> Agent Config</div>
                  <div><span className="text-text-muted">System Prompt:</span> {systemPrompt.trim() ? `${systemPrompt.trim().length.toLocaleString()} chars` : <span className="text-text-muted/60 italic">not set</span>}</div>
                  <div><span className="text-text-muted">Rules:</span> {ruleInclusions.length} inclusions</div>
                  <div><span className="text-text-muted">Tech Stack:</span> {Object.keys(techStack).filter((k) => techStack[k]).length} fields</div>
                  <div><span className="text-text-muted">Parameters:</span> {Object.keys(params).length} entries</div>
                  <div><span className="text-text-muted">Variables:</span> {variables.length} defined</div>
                  <div><span className="text-text-muted">System Properties:</span> {Object.keys(systemProperties).length} entries</div>
                  <div><span className="text-text-muted">Export as Template:</span> {isTemplateMode || exportAsTemplate ? "Yes" : "No"}</div>
                  {exportWorkflowTemplates.length > 0 && (
                    <div><span className="text-text-muted">Workflow Exports:</span> {exportWorkflowTemplates.map((c) => TEMPLATE_CATEGORY_OPTIONS.find((o) => o.value === c)?.label).join(", ")}</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex justify-between items-center sm:justify-between">
          <div>
            {step > 1 && <Button variant="ghost" onClick={() => setStep((s) => s - 1)}>Back</Button>}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            {!isLastStep ? (
              <Button onClick={() => { setValidationError(null); setStep((s) => s + 1); }} disabled={!canAdvance}>
                Next
              </Button>
            ) : (
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || !name.trim() || (isTemplateMode && !templateDescription.trim())}
              >
                {saveMutation.isPending
                  ? "Saving…"
                  : isTemplateMode
                  ? "Commit as Template"
                  : "Commit to Vault"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
