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

// ── Zod schemas (mirrors server-side AgentConfigSchema) ───────────────────────
const TechStackSchema = z.record(z.string(), z.string());
const CodeStyleSchema = z.record(z.string(), z.string());

const AgentConfigFormSchema = z.object({
  name: z.string().min(1, "Name is required").max(128),
  systemPrompt: z.string().max(50000).optional().default(""),
  techStack: TechStackSchema,
  codeStyle: CodeStyleSchema,
  ruleInclusions: z.array(z.string()),
  tags: z.string(),
  projectKey: z.string().optional(),
  exportAsTemplate: z.boolean(),
  templateCategory: z.enum(["configs", "compliance", "project_management", "product_management", "devops", "devsecops", "cicd"]),
  templateDescription: z.string().max(512),
});

type AgentConfigFormData = z.infer<typeof AgentConfigFormSchema>;

// ── Template-category preset field architectures ──────────────────────────────
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
  "Rules",
  "Code Style",
  "System Prompt",
  "Export Options",
] as const;

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

interface StackPillFieldProps {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}

function StackPillField({ label, options, value, onChange }: StackPillFieldProps) {
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

interface AgentConfigBuilderProps {
  isOpen: boolean;
  onClose: () => void;
  mode?: "memory" | "template";
  editingTemplate?: any;
}

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

function normalizeTemplatePayload(editingTemplate: any) {
  if (!editingTemplate?.configPayload) return null;
  try {
    const payload = JSON.parse(editingTemplate.configPayload);
    return {
      systemPrompt: payload.systemPrompt || "",
      techStack: {
        ...getDefaultTechStack(),
        ...(payload.techStack || {}),
        language: payload.techStack?.language || payload.language || DEFAULT_STACK_PREFERENCES.language,
        frontend: payload.techStack?.frontend || payload.frontend || DEFAULT_STACK_PREFERENCES.frontend,
        hosting: payload.techStack?.hosting || payload.hosting || DEFAULT_STACK_PREFERENCES.hosting,
        database: payload.techStack?.database || payload.database || DEFAULT_STACK_PREFERENCES.database,
        orm: payload.techStack?.orm || payload.orm || DEFAULT_STACK_PREFERENCES.orm,
        auth: payload.techStack?.auth || payload.auth || DEFAULT_STACK_PREFERENCES.auth,
        styling: payload.techStack?.styling || payload.styling || DEFAULT_STACK_PREFERENCES.styling,
        stateCache: payload.techStack?.stateCache || payload.stateCache || DEFAULT_STACK_PREFERENCES.stateCache,
        storage: payload.techStack?.storage || payload.storage || DEFAULT_STACK_PREFERENCES.storage,
        search: payload.techStack?.search || payload.search || DEFAULT_STACK_PREFERENCES.search,
        vector: payload.techStack?.vector || payload.vector || DEFAULT_STACK_PREFERENCES.vector,
        componentLibrary: payload.techStack?.componentLibrary || payload.componentLibrary || DEFAULT_STACK_PREFERENCES.componentLibrary,
      },
      codeStyle: payload.codeStyle || {},
      rules: payload.ruleInclusions || payload.rules || [],
      tags: payload.tags || "",
    };
  } catch (e) {
    console.error(e);
    return null;
  }
}

export function AgentConfigBuilder({ isOpen, onClose, mode = "memory", editingTemplate }: AgentConfigBuilderProps) {
  const queryClient = useQueryClient();
  const isTemplateMode = mode === "template";
  const isEdit = !!editingTemplate;
  const [step, setStep] = React.useState(1);
  const [validationError, setValidationError] = React.useState<string | null>(null);

  // Step 1: Metadata
  const [name, setName] = React.useState("");
  const [tags, setTags] = React.useState("");
  const [projectKey, setProjectKey] = React.useState("personal");

  // Step 2: System Prompt
  const [systemPrompt, setSystemPrompt] = React.useState(DEFAULT_SYSTEM_PROMPT);

  // Step 3: Tech Stack
  const [techStack, setTechStack] = React.useState<Record<string, string>>(getDefaultTechStack());

  // Step 4: Style + Rules
  const [codeStyle, setCodeStyle] = React.useState<Record<string, string>>({});
  const [newStyleKey, setNewStyleKey] = React.useState("");
  const [newStyleVal, setNewStyleVal] = React.useState("");
  const [ruleInclusions, setRuleInclusions] = React.useState<string[]>(CATEGORY_PRESET_RULES.configs);
  const [newRule, setNewRule] = React.useState("");
  const [templateCategory, setTemplateCategory] = React.useState<TemplateCategoryValue>("configs");

  // Step 5: Export Options
  const [exportAsTemplate, setExportAsTemplate] = React.useState(isTemplateMode);
  const [templateDescription, setTemplateDescription] = React.useState("");

  const totalSteps = STEPS.length;

  const { data: workspacesList = [] } = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => getUserWorkspaces(),
  });
  const workspaces = Array.isArray(workspacesList) ? workspacesList : [];

  React.useEffect(() => {
    if (!isOpen) return;

    setStep(1);
    setValidationError(null);
    setTemplateCategory("configs");
    setExportAsTemplate(isTemplateMode);

    if (editingTemplate) {
      const payload = normalizeTemplatePayload(editingTemplate);
      setName(editingTemplate.name || "");
      setTemplateDescription(editingTemplate.description || "");
      setTags(payload?.tags || "");
      setProjectKey("personal");
      setSystemPrompt(payload?.systemPrompt || DEFAULT_SYSTEM_PROMPT);
      setTechStack(payload?.techStack || getDefaultTechStack());
      setCodeStyle(payload?.codeStyle || {});
      setRuleInclusions(payload?.rules?.length ? payload.rules : CATEGORY_PRESET_RULES.configs);
    } else {
      setName("");
      setTags("");
      setProjectKey("personal");
      setSystemPrompt(DEFAULT_SYSTEM_PROMPT);
      setTechStack(getDefaultTechStack());
      setCodeStyle({});
      setRuleInclusions(CATEGORY_PRESET_RULES.configs);
      setTemplateDescription("");
    }
  }, [editingTemplate, isOpen, isTemplateMode]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const formData: AgentConfigFormData = {
        name: name.trim(),
        systemPrompt: systemPrompt.trim(),
        techStack,
        codeStyle,
        ruleInclusions,
        tags,
        projectKey: projectKey === "personal" ? undefined : projectKey,
        exportAsTemplate: isTemplateMode ? true : exportAsTemplate,
        templateCategory: "configs",
        templateDescription,
      };

      const result = AgentConfigFormSchema.safeParse(formData);
      if (!result.success) {
        throw new Error(result.error.issues[0]?.message ?? "Validation error");
      }

      if (isTemplateMode) {
        const configPayload = JSON.stringify({
          systemPrompt: result.data.systemPrompt,
          techStack: result.data.techStack,
          codeStyle: result.data.codeStyle,
          ruleInclusions: result.data.ruleInclusions,
          tags: result.data.tags,
        });
        const payload = {
          name: result.data.name,
          description: result.data.templateDescription || `Agent config: ${result.data.name}`,
          category: "configs" as const,
          configPayload,
        };
        if (isEdit) {
          return updateMemoryTemplate({ data: { ...payload, id: editingTemplate.id } });
        }
        return createMemoryTemplate({ data: payload });
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

  function addStyleEntry() {
    if (!newStyleKey.trim() || !newStyleVal.trim()) return;
    setCodeStyle({ ...codeStyle, [newStyleKey.trim()]: newStyleVal.trim() });
    setNewStyleKey("");
    setNewStyleVal("");
  }

  function addRule() {
    if (!newRule.trim()) return;
    setRuleInclusions([...ruleInclusions, newRule.trim()]);
    setNewRule("");
  }

  const stepLabel = STEPS[step - 1];
  const isLastStep = step === totalSteps;
  const canAdvance = step === 1 ? name.trim().length > 0 && (!isTemplateMode || templateDescription.trim().length > 0) : true;

  return (
    <Dialog open={isOpen} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-[1120px] min-w-0 overflow-hidden">
        <DialogHeader>
          <DialogTitle>{isTemplateMode ? "Agent Config Template Builder" : "Agent Config Builder"}</DialogTitle>
          <DialogDescription>
            {isTemplateMode
              ? "Build and commit a reusable agent configuration template with the same stack, rules, style, and prompt setup."
              : <>Build and commit a structured agent configuration to your Locker vault under the protected <code className="text-xs font-mono text-accent bg-accent/10 px-1 py-0.5 rounded">configs</code> category.</>}
          </DialogDescription>

          {/* Step tab bar */}
          <div className="flex max-w-full min-w-0 border-b border-border mt-3 -mb-2 overflow-x-auto no-scrollbar">
            {STEPS.map((label, i) => {
              const s = i + 1;
              const active = step === s;
              const done = step > s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => done && setStep(s)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 -mb-px whitespace-nowrap transition-colors flex-shrink-0 ${
                    active
                      ? "border-accent text-accent"
                      : done
                      ? "border-transparent text-text-muted hover:text-text cursor-pointer"
                      : "border-transparent text-text-muted/40 cursor-default"
                  }`}
                >
                  <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold flex-shrink-0 ${
                    active ? "bg-accent text-white" : done ? "bg-accent/20 text-accent" : "bg-border text-text-muted/40"
                  }`}>
                    {done ? "✓" : s}
                  </span>
                  {label}
                </button>
              );
            })}
          </div>
        </DialogHeader>

        <div className="py-2 overflow-y-auto overflow-x-hidden max-h-[60vh] pr-1 flex flex-col gap-4 min-w-0">
          {validationError && (
            <div className="p-3 bg-error/10 border border-error/20 rounded-lg text-error text-xs font-medium">
              {validationError}
            </div>
          )}

          {/* Step 1: Metadata */}
          {stepLabel === "Metadata" && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="acb-name">Config Name</Label>
                <Input
                  id="acb-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. claude-code-baseline, my-next-app-rules"
                />
              </div>
              {isTemplateMode ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="acb-tmpl-desc">Template Description</Label>
                  <Textarea
                    id="acb-tmpl-desc"
                    value={templateDescription}
                    onChange={(e) => setTemplateDescription(e.target.value)}
                    placeholder="Describe the purpose and scope of this template for future users..."
                    rows={3}
                  />
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="acb-tags">Tags</Label>
                    <Input
                      id="acb-tags"
                      value={tags}
                      onChange={(e) => setTags(e.target.value)}
                      placeholder="e.g. architecture, baseline, llm-config"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="acb-workspace">Destination Workspace</Label>
                    <Select
                      id="acb-workspace"
                      value={projectKey}
                      onChange={(e) => setProjectKey(e.target.value)}
                    >
                      {workspaces.map((w: any) => (
                        <option key={w.key} value={w.key}>{w.label}</option>
                      ))}
                    </Select>
                  </div>
                </>
              )}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="acb-tmpl-cat">Config Type</Label>
                <Select
                  id="acb-tmpl-cat"
                  value={templateCategory}
                  disabled
                  onChange={(e) => setTemplateCategory(e.target.value as TemplateCategoryValue)}
                >
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

          {/* Stack: Core Tech */}
          {stepLabel === "Core Tech" && (
            <div className="flex flex-col gap-3">
              <StackPillField label="Language" options={FIELD_OPTIONS.language} value={techStack.language ?? ""} onChange={(v) => setTechStack({ ...techStack, language: v })} />
              <StackPillField label="Frontend" options={FIELD_OPTIONS.frontend} value={techStack.frontend ?? ""} onChange={(v) => setTechStack({ ...techStack, frontend: v })} />
              <StackPillField label="Styling" options={FIELD_OPTIONS.styling} value={techStack.styling ?? ""} onChange={(v) => setTechStack({ ...techStack, styling: v })} />
              <StackPillField label="Component Library" options={FIELD_OPTIONS.componentLibrary} value={techStack.componentLibrary ?? ""} onChange={(v) => setTechStack({ ...techStack, componentLibrary: v })} />
            </div>
          )}

          {/* Stack: Infrastructure */}
          {stepLabel === "Infrastructure" && (
            <div className="flex flex-col gap-3">
              <StackPillField label="Hosting" options={FIELD_OPTIONS.hosting} value={techStack.hosting ?? ""} onChange={(v) => setTechStack({ ...techStack, hosting: v })} />
              <StackPillField label="Database" options={FIELD_OPTIONS.database} value={techStack.database ?? ""} onChange={(v) => setTechStack({ ...techStack, database: v })} />
              <StackPillField label="ORM / Data Access" options={FIELD_OPTIONS.orm} value={techStack.orm ?? ""} onChange={(v) => setTechStack({ ...techStack, orm: v })} />
              <StackPillField label="State & Cache" options={FIELD_OPTIONS.stateCache} value={techStack.stateCache ?? ""} onChange={(v) => setTechStack({ ...techStack, stateCache: v })} />
              <StackPillField label="File Storage" options={FIELD_OPTIONS.storage} value={techStack.storage ?? ""} onChange={(v) => setTechStack({ ...techStack, storage: v })} />
            </div>
          )}

          {/* Stack: Additional Specs */}
          {stepLabel === "Additional Specs" && (
            <div className="flex flex-col gap-3">
              <StackPillField label="Auth" options={FIELD_OPTIONS.auth} value={techStack.auth ?? ""} onChange={(v) => setTechStack({ ...techStack, auth: v })} />
              <StackPillField label="Search" options={FIELD_OPTIONS.search} value={techStack.search ?? ""} onChange={(v) => setTechStack({ ...techStack, search: v })} />
              <StackPillField label="Vector / AI Storage" options={FIELD_OPTIONS.vector} value={techStack.vector ?? ""} onChange={(v) => setTechStack({ ...techStack, vector: v })} />
            </div>
          )}

          {/* Step 5: Rules */}
          {stepLabel === "Rules" && (
              <div className="flex flex-col gap-3">
                <Label>Rule Inclusions</Label>
                <div className="text-[10px] text-text-muted">
                  Pre-filled with Agent Config presets. Add or remove rules as needed.
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
                  <div className="flex flex-col gap-2 border border-border bg-surface2 p-3 rounded-lg max-h-[240px] overflow-y-auto no-scrollbar">
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

          {/* Step 6: Code Style */}
          {stepLabel === "Code Style" && (
            <div className="bg-surface2 border border-border p-4 rounded-xl flex flex-col gap-3">
              <span className="text-[10px] font-bold text-accent uppercase tracking-wider">Code Style Preferences</span>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <Label className="text-[9px]">Preference Key</Label>
                  <Input value={newStyleKey} onChange={(e) => setNewStyleKey(e.target.value)} className="h-8 text-xs font-mono" placeholder="e.g. indentation" />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-[9px]">Value</Label>
                  <Input value={newStyleVal} onChange={(e) => setNewStyleVal(e.target.value)} className="h-8 text-xs" placeholder="e.g. 2-space tabs" />
                </div>
              </div>
              <Button onClick={addStyleEntry} disabled={!newStyleKey.trim() || !newStyleVal.trim()} size="sm" variant="outline">+ Add Style Entry</Button>
              {Object.entries(codeStyle).length > 0 && (
                <div className="flex flex-col gap-1.5 mt-1 border border-border rounded-lg p-3 bg-surface max-h-32 overflow-y-auto no-scrollbar">
                  {Object.entries(codeStyle).map(([k, v]) => (
                    <div key={k} className="flex justify-between items-center text-xs">
                      <span><span className="font-mono font-bold text-accent mr-2">{k}</span>{v}</span>
                      <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-error hover:bg-error/5"
                        onClick={() => { const s = { ...codeStyle }; delete s[k]; setCodeStyle(s); }}>✕</Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 7: System Prompt (optional) */}
          {stepLabel === "System Prompt" && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <Label htmlFor="acb-prompt">System Prompt / LLM Instructions</Label>
                <span className="text-[10px] text-text-muted border border-border rounded-full px-2 py-0.5 leading-tight">Optional</span>
              </div>
              <Textarea
                id="acb-prompt"
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

          {/* Step 8: Export Options */}
          {stepLabel === "Export Options" && (
            <div className="flex flex-col gap-4">
              <div className="flex items-start gap-3 p-4 bg-surface2 border border-border rounded-xl">
                <input
                  type="checkbox"
                  id="acb-export-tmpl"
                  checked={isTemplateMode ? true : exportAsTemplate}
                  disabled={isTemplateMode}
                  onChange={(e) => setExportAsTemplate(e.target.checked)}
                  className="mt-0.5 cursor-pointer h-4 w-4 rounded accent-accent disabled:cursor-not-allowed disabled:opacity-70"
                />
                <div className="flex flex-col gap-1">
                  <label htmlFor="acb-export-tmpl" className={`text-sm font-semibold ${isTemplateMode ? "cursor-default" : "cursor-pointer"}`}>
                    Export as Reusable Template
                  </label>
                  <span className="text-xs text-text-muted leading-relaxed">
                    {isTemplateMode
                      ? "Template builders always save as reusable templates, so this option is selected and locked."
                      : "Also saves this config as a local template in the Templates library so it can be imported by other workspaces or team members. Templates are UI-only and never exposed via the MCP tool schema."}
                  </span>
                </div>
              </div>

              {!isTemplateMode && exportAsTemplate && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="acb-tmpl-desc">Template Description</Label>
                  <Textarea
                    id="acb-tmpl-desc"
                    value={templateDescription}
                    onChange={(e) => setTemplateDescription(e.target.value)}
                    placeholder="Describe the purpose and scope of this template for future users…"
                    rows={3}
                  />
                </div>
              )}

              <div className="p-4 border border-accent/20 bg-accent/5 rounded-xl flex flex-col gap-2">
                <span className="text-xs font-bold text-accent uppercase tracking-wider">Summary</span>
                <div className="text-xs text-text space-y-1">
                  <div><span className="text-text-muted">Config Name:</span> {name || "—"}</div>
                  {!isTemplateMode && <div><span className="text-text-muted">Workspace:</span> {projectKey}</div>}
                  <div><span className="text-text-muted">Type:</span> {TEMPLATE_CATEGORY_OPTIONS.find(o => o.value === templateCategory)?.label}</div>
                  <div><span className="text-text-muted">System Prompt:</span> {systemPrompt.trim() ? `${systemPrompt.trim().length.toLocaleString()} chars` : <span className="text-text-muted/60 italic">not set</span>}</div>
                  <div><span className="text-text-muted">Rules:</span> {ruleInclusions.length} inclusions</div>
                  <div><span className="text-text-muted">Tech Stack:</span> {Object.keys(techStack).filter(k => techStack[k]).length} fields</div>
                  <div><span className="text-text-muted">Export as Template:</span> {isTemplateMode || exportAsTemplate ? "Yes" : "No"}</div>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex justify-between items-center sm:justify-between">
          <div>
            {step > 1 && (
              <Button variant="ghost" onClick={() => setStep((s) => s - 1)}>Back</Button>
            )}
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
                  ? "Commit to Vault as Template"
                  : "Commit to Vault as Agent Config"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
