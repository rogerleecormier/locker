import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createMemoryTemplate, updateMemoryTemplate } from "~/server/memoryFunctions";
import { Button } from "./ui/button";
import { Label, Input, Textarea, Select } from "./ui/input";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "./ui/dialog";
import { FIELD_OPTIONS, DEFAULT_STACK_PREFERENCES } from "~/lib/stackFields";

interface TemplateFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingTemplate?: any;
}

const CATEGORY_OPTIONS = [
  { value: "configs", label: "Agent Config" },
  { value: "compliance", label: "Compliance & Security" },
  { value: "project_management", label: "Project Management" },
  { value: "product_management", label: "Product Management" },
  { value: "devops", label: "DevOps & CI" },
  { value: "devsecops", label: "DevSecOps" },
  { value: "cicd", label: "CI/CD Pipeline" },
];

// Step definitions per category type
const CONFIGS_STEPS = ["Metadata", "Core Tech", "Infrastructure", "Additional Specs", "Rules", "Code Style", "System Prompt", "Export Options"];
const OTHER_STEPS = ["Metadata", "Variables", "Rules"];

function StackPillField({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (v: string) => void }) {
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

export function TemplateFormModal({ isOpen, onClose, editingTemplate }: TemplateFormModalProps) {
  const queryClient = useQueryClient();
  const isEdit = !!editingTemplate;

  const [currentStep, setCurrentStep] = React.useState(1);

  // Step 1: Metadata
  const [formName, setFormName] = React.useState("");
  const [formDescription, setFormDescription] = React.useState("");
  const [formCategory, setFormCategory] = React.useState("configs");

  // Non-stack: Variables
  const [variables, setVariables] = React.useState<Array<{ key: string; description: string; default: string }>>([]);
  const [newVarKey, setNewVarKey] = React.useState("");
  const [newVarDesc, setNewVarDesc] = React.useState("");
  const [newVarDefault, setNewVarDefault] = React.useState("");

  // Stack: Tech fields
  const [stackLanguage, setStackLanguage] = React.useState(DEFAULT_STACK_PREFERENCES.language);
  const [stackFrontend, setStackFrontend] = React.useState(DEFAULT_STACK_PREFERENCES.frontend);
  const [stackHosting, setStackHosting] = React.useState(DEFAULT_STACK_PREFERENCES.hosting);
  const [stackDatabase, setStackDatabase] = React.useState(DEFAULT_STACK_PREFERENCES.database);
  const [stackOrm, setStackOrm] = React.useState(DEFAULT_STACK_PREFERENCES.orm);
  const [stackAuth, setStackAuth] = React.useState(DEFAULT_STACK_PREFERENCES.auth);
  const [stackStyling, setStackStyling] = React.useState(DEFAULT_STACK_PREFERENCES.styling);
  const [stackSearch, setStackSearch] = React.useState(DEFAULT_STACK_PREFERENCES.search);
  const [stackVector, setStackVector] = React.useState(DEFAULT_STACK_PREFERENCES.vector);
  const [stackStorage, setStackStorage] = React.useState(DEFAULT_STACK_PREFERENCES.storage);
  const [stackStateCache, setStackStateCache] = React.useState(DEFAULT_STACK_PREFERENCES.stateCache);
  const [stackComponentLibrary, setStackComponentLibrary] = React.useState(DEFAULT_STACK_PREFERENCES.componentLibrary);
  const [bannedProviders, setBannedProviders] = React.useState<string[]>(DEFAULT_STACK_PREFERENCES.bannedProviders);

  // Last step: Rules
  const [rules, setRules] = React.useState<string[]>([]);
  const [newRule, setNewRule] = React.useState("");
  const [codeStyle, setCodeStyle] = React.useState<Record<string, string>>({});
  const [newStyleKey, setNewStyleKey] = React.useState("");
  const [newStyleVal, setNewStyleVal] = React.useState("");
  const [systemPrompt, setSystemPrompt] = React.useState("");

  const isStack = formCategory === "configs";
  const steps = isStack ? CONFIGS_STEPS : OTHER_STEPS;
  const totalSteps = steps.length;

  React.useEffect(() => {
    if (editingTemplate) {
      setFormName(editingTemplate.name);
      setFormDescription(editingTemplate.description);
      setFormCategory(editingTemplate.category);
      setCurrentStep(1);
      try {
        const payload = JSON.parse(editingTemplate.configPayload);
        setRules(payload.rules || []);
        if (editingTemplate.category === "configs") {
          const techStack = payload.techStack || {};
          setRules(payload.ruleInclusions || payload.rules || []);
          setStackLanguage(techStack.language || payload.language || DEFAULT_STACK_PREFERENCES.language);
          setStackFrontend(techStack.frontend || payload.frontend || DEFAULT_STACK_PREFERENCES.frontend);
          setStackHosting(techStack.hosting || payload.hosting || DEFAULT_STACK_PREFERENCES.hosting);
          setStackDatabase(techStack.database || payload.database || DEFAULT_STACK_PREFERENCES.database);
          setStackOrm(techStack.orm || payload.orm || DEFAULT_STACK_PREFERENCES.orm);
          setStackAuth(techStack.auth || payload.auth || DEFAULT_STACK_PREFERENCES.auth);
          setStackStyling(techStack.styling || payload.styling || DEFAULT_STACK_PREFERENCES.styling);
          setStackSearch(techStack.search || payload.search || DEFAULT_STACK_PREFERENCES.search);
          setStackVector(techStack.vector || payload.vector || DEFAULT_STACK_PREFERENCES.vector);
          setStackStorage(techStack.storage || payload.storage || DEFAULT_STACK_PREFERENCES.storage);
          setStackStateCache(techStack.stateCache || payload.stateCache || DEFAULT_STACK_PREFERENCES.stateCache);
          setStackComponentLibrary(techStack.componentLibrary || payload.componentLibrary || DEFAULT_STACK_PREFERENCES.componentLibrary);
          setBannedProviders(payload.bannedProviders || DEFAULT_STACK_PREFERENCES.bannedProviders);
          setCodeStyle(payload.codeStyle || {});
          setSystemPrompt(payload.systemPrompt || "");
        } else {
          setVariables(payload.variables || []);
          setCodeStyle({});
          setSystemPrompt("");
        }
      } catch (e) {
        console.error(e);
      }
    } else {
      setFormName("");
      setFormDescription("");
      setFormCategory("configs");
      setRules([]);
      setVariables([]);
      setBannedProviders(DEFAULT_STACK_PREFERENCES.bannedProviders);
      setStackLanguage(DEFAULT_STACK_PREFERENCES.language);
      setStackFrontend(DEFAULT_STACK_PREFERENCES.frontend);
      setStackHosting(DEFAULT_STACK_PREFERENCES.hosting);
      setStackDatabase(DEFAULT_STACK_PREFERENCES.database);
      setStackOrm(DEFAULT_STACK_PREFERENCES.orm);
      setStackAuth(DEFAULT_STACK_PREFERENCES.auth);
      setStackStyling(DEFAULT_STACK_PREFERENCES.styling);
      setStackSearch(DEFAULT_STACK_PREFERENCES.search);
      setStackVector(DEFAULT_STACK_PREFERENCES.vector);
      setStackStorage(DEFAULT_STACK_PREFERENCES.storage);
      setStackStateCache(DEFAULT_STACK_PREFERENCES.stateCache);
      setStackComponentLibrary(DEFAULT_STACK_PREFERENCES.componentLibrary);
      setCodeStyle({});
      setSystemPrompt("");
      setCurrentStep(1);
    }
  }, [editingTemplate, isOpen]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: any = { rules };
      if (isStack) {
        payload.language = stackLanguage;
        payload.frontend = stackFrontend;
        payload.hosting = stackHosting;
        payload.database = stackDatabase;
        payload.orm = stackOrm;
        payload.auth = stackAuth;
        payload.styling = stackStyling;
        payload.search = stackSearch;
        payload.vector = stackVector;
        payload.storage = stackStorage;
        payload.stateCache = stackStateCache;
        payload.componentLibrary = stackComponentLibrary;
        payload.bannedProviders = bannedProviders;
        payload.codeStyle = codeStyle;
        payload.systemPrompt = systemPrompt.trim();
      } else {
        payload.variables = variables;
      }
      const configString = JSON.stringify(payload);
      if (isEdit) {
        await updateMemoryTemplate({ data: { id: editingTemplate.id, name: formName, description: formDescription, category: formCategory, configPayload: configString } });
      } else {
        await createMemoryTemplate({ data: { name: formName, description: formDescription, category: formCategory, configPayload: configString } });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      onClose();
    },
    onError: (err: any) => {
      alert("Save failed: " + String(err.message || err));
    },
  });

  const addVariable = () => {
    if (!newVarKey.trim()) return;
    if (variables.some((v) => v.key === newVarKey.trim())) { alert("Variable key already exists"); return; }
    setVariables([...variables, { key: newVarKey.trim(), description: newVarDesc.trim(), default: newVarDefault.trim() }]);
    setNewVarKey(""); setNewVarDesc(""); setNewVarDefault("");
  };

  const addRule = () => {
    if (!newRule.trim()) return;
    setRules([...rules, newRule.trim()]);
    setNewRule("");
  };

  const addStyleEntry = () => {
    if (!newStyleKey.trim() || !newStyleVal.trim()) return;
    setCodeStyle({ ...codeStyle, [newStyleKey.trim()]: newStyleVal.trim() });
    setNewStyleKey("");
    setNewStyleVal("");
  };

  const isMetadataValid = formName.trim() && formDescription.trim();
  const isLastStep = currentStep === totalSteps;

  const stepLabel = steps[currentStep - 1];

  return (
    <Dialog open={isOpen} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-[1120px] min-w-0 overflow-hidden">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Template" : "New Memory Template"}</DialogTitle>
          <DialogDescription>
            Configure guideline blueprint configurations and variables for Locker imports.
          </DialogDescription>

          {/* Step tab bar */}
          <div className="flex max-w-full min-w-0 border-b border-border mt-3 -mb-2 overflow-x-auto no-scrollbar">
            {steps.map((label, i) => {
              const s = i + 1;
              const active = currentStep === s;
              const done = currentStep > s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => done && setCurrentStep(s)}
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

        <div className="py-2 overflow-y-auto overflow-x-hidden max-h-[60vh] pr-1 min-w-0">

          {/* Step 1: Metadata */}
          {stepLabel === "Metadata" && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tmpl-form-name">Name</Label>
                <Input id="tmpl-form-name" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. Next.js Enterprise Architecture" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tmpl-form-desc">Description</Label>
                <Textarea id="tmpl-form-desc" value={formDescription} onChange={(e) => setFormDescription(e.target.value)} placeholder="Summarize the purpose and rules governed by this template..." rows={3} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tmpl-form-cat">Category Type</Label>
                <Select id="tmpl-form-cat" value={formCategory} onChange={(e) => { setFormCategory(e.target.value); setCurrentStep(1); }}>
                  {CATEGORY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </Select>
              </div>
            </div>
          )}

          {/* Stack: Core Tech */}
          {stepLabel === "Core Tech" && (
            <div className="flex flex-col gap-3">
              <StackPillField label="Language" options={FIELD_OPTIONS.language} value={stackLanguage} onChange={setStackLanguage} />
              <StackPillField label="Frontend" options={FIELD_OPTIONS.frontend} value={stackFrontend} onChange={setStackFrontend} />
              <StackPillField label="Styling" options={FIELD_OPTIONS.styling} value={stackStyling} onChange={setStackStyling} />
              <StackPillField label="Component Library" options={FIELD_OPTIONS.componentLibrary} value={stackComponentLibrary} onChange={setStackComponentLibrary} />
            </div>
          )}

          {/* Stack: Infrastructure */}
          {stepLabel === "Infrastructure" && (
            <div className="flex flex-col gap-3">
              <StackPillField label="Hosting" options={FIELD_OPTIONS.hosting} value={stackHosting} onChange={setStackHosting} />
              <StackPillField label="Database" options={FIELD_OPTIONS.database} value={stackDatabase} onChange={setStackDatabase} />
              <StackPillField label="ORM / Data Access" options={FIELD_OPTIONS.orm} value={stackOrm} onChange={setStackOrm} />
              <StackPillField label="State & Cache" options={FIELD_OPTIONS.stateCache} value={stackStateCache} onChange={setStackStateCache} />
              <StackPillField label="File Storage" options={FIELD_OPTIONS.storage} value={stackStorage} onChange={setStackStorage} />
            </div>
          )}

          {/* Stack: Additional Specs */}
          {stepLabel === "Additional Specs" && (
            <div className="flex flex-col gap-3">
              <StackPillField label="Auth" options={FIELD_OPTIONS.auth} value={stackAuth} onChange={setStackAuth} />
              <StackPillField label="Search" options={FIELD_OPTIONS.search} value={stackSearch} onChange={setStackSearch} />
              <StackPillField label="Vector / AI Storage" options={FIELD_OPTIONS.vector} value={stackVector} onChange={setStackVector} />
            </div>
          )}

          {/* Non-stack: Variables */}
          {stepLabel === "Variables" && (
            <div className="flex flex-col gap-4">
              <div className="bg-surface2 border border-border p-4 rounded-xl flex flex-col gap-3">
                <span className="text-[10px] font-bold text-accent uppercase tracking-wider block">Define New Placeholder Variable</span>
                <div className="grid grid-cols-3 gap-3">
                  <div className="flex flex-col gap-1">
                    <Label className="text-[9px]">Key (e.g. API_URL)</Label>
                    <Input value={newVarKey} onChange={(e) => setNewVarKey(e.target.value.replace(/[^A-Z0-9_]/gi, "_").toUpperCase())} className="h-8 text-xs font-mono" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-[9px]">Description</Label>
                    <Input value={newVarDesc} onChange={(e) => setNewVarDesc(e.target.value)} className="h-8 text-xs" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-[9px]">Default Val</Label>
                    <Input value={newVarDefault} onChange={(e) => setNewVarDefault(e.target.value)} className="h-8 text-xs" />
                  </div>
                </div>
                <Button onClick={addVariable} disabled={!newVarKey.trim()} size="sm" variant="outline" className="mt-1">+ Add Variable</Button>
              </div>
              <div className="flex flex-col gap-2">
                <Label>Registered Variables</Label>
                {variables.length === 0 ? (
                  <p className="text-xs text-text-muted italic py-1">No custom variables registered yet.</p>
                ) : (
                  <div className="flex flex-col gap-2 border border-border bg-surface2 p-3 rounded-lg max-h-[220px] overflow-y-auto no-scrollbar">
                    {variables.map((v) => (
                      <div key={v.key} className="flex justify-between items-center text-xs border-b border-border/40 pb-2 last:border-0 last:pb-0">
                        <div>
                          <span className="font-mono font-bold text-accent mr-2">{`{{${v.key}}}`}</span>
                          <span className="text-text-muted">({v.description || "no description"})</span>
                        </div>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-error hover:bg-error/5" onClick={() => setVariables(variables.filter((x) => x.key !== v.key))}>✕</Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Last step: Rules */}
          {stepLabel === "Rules" && (
            <div className="flex flex-col gap-4">
              <span className="text-xs font-semibold text-text uppercase tracking-wider block border-b border-border pb-2 mb-1">
                Guidelines Rules Manifesto
              </span>
              {!isStack && variables.length > 0 && (
                <div className="flex flex-col gap-1.5 bg-surface2 border border-border p-3 rounded-lg">
                  <span className="text-[10px] uppercase font-bold text-text-muted">Quick Inject Variables</span>
                  <div className="flex flex-wrap gap-1">
                    {variables.map((v) => (
                      <button key={v.key} type="button" onClick={() => setNewRule((prev) => prev + `{{${v.key}}}`)} className="px-2 py-0.5 border border-tag-border bg-tag-bg rounded-md text-[10px] font-mono text-accent hover:border-accent/40">
                        {`{{${v.key}}}`}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rule-new">New Rule Directive</Label>
                <div className="flex gap-2">
                  <Input id="rule-new" value={newRule} onChange={(e) => setNewRule(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addRule()} placeholder="Enter architectural constraint or formatting rule..." className="flex-1 text-xs" />
                  <Button onClick={addRule} disabled={!newRule.trim()} size="sm" variant="outline">Add</Button>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label>Manifesto Rules List</Label>
                {rules.length === 0 ? (
                  <p className="text-xs text-text-muted italic py-1">No rules defined. Templates require at least one rule.</p>
                ) : (
                  <div className="flex flex-col gap-2.5 border border-border bg-surface2 p-3 rounded-lg max-h-[300px] overflow-y-auto no-scrollbar">
                    {rules.map((rule, idx) => (
                      <div key={idx} className="flex justify-between items-start text-xs border-b border-border/40 pb-2 last:border-0 last:pb-0 gap-3">
                        <span className="text-text leading-relaxed flex-1 font-medium">{rule}</span>
                        <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-error hover:bg-error/5 flex-shrink-0" onClick={() => setRules(rules.filter((_, i) => i !== idx))}>✕</Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Stack: Code Style */}
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
                      <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-error hover:bg-error/5" onClick={() => { const s = { ...codeStyle }; delete s[k]; setCodeStyle(s); }}>✕</Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Stack: System Prompt */}
          {stepLabel === "System Prompt" && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <Label htmlFor="tmpl-system-prompt">System Prompt / LLM Instructions</Label>
                <span className="text-[10px] text-text-muted border border-border rounded-full px-2 py-0.5 leading-tight">Optional</span>
              </div>
              <Textarea
                id="tmpl-system-prompt"
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

          {/* Stack: Export Options */}
          {stepLabel === "Export Options" && (
            <div className="flex flex-col gap-4">
              <div className="flex items-start gap-3 p-4 bg-surface2 border border-border rounded-xl">
                <input
                  type="checkbox"
                  id="tmpl-export-reusable"
                  checked
                  disabled
                  readOnly
                  className="mt-0.5 h-4 w-4 rounded accent-accent disabled:cursor-not-allowed disabled:opacity-70"
                />
                <div className="flex flex-col gap-1">
                  <label htmlFor="tmpl-export-reusable" className="text-sm font-semibold cursor-default">
                    Export as Reusable Template
                  </label>
                  <span className="text-xs text-text-muted leading-relaxed">
                    Template builders always save as reusable templates, so this option is selected and locked.
                  </span>
                </div>
              </div>

              <div className="p-4 border border-accent/20 bg-accent/5 rounded-xl flex flex-col gap-2">
                <span className="text-xs font-bold text-accent uppercase tracking-wider">Summary</span>
                <div className="text-xs text-text space-y-1">
                  <div><span className="text-text-muted">Template Name:</span> {formName || "—"}</div>
                  <div><span className="text-text-muted">Type:</span> Agent Config</div>
                  <div><span className="text-text-muted">System Prompt:</span> {systemPrompt.trim() ? `${systemPrompt.trim().length.toLocaleString()} chars` : <span className="text-text-muted/60 italic">not set</span>}</div>
                  <div><span className="text-text-muted">Rules:</span> {rules.length} inclusions</div>
                  <div><span className="text-text-muted">Code Style:</span> {Object.keys(codeStyle).length} preferences</div>
                  <div><span className="text-text-muted">Export as Template:</span> Yes</div>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex justify-between items-center sm:justify-between">
          <div>
            {currentStep > 1 && (
              <Button variant="ghost" onClick={() => setCurrentStep((s) => s - 1)}>Back</Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            {!isLastStep ? (
              <Button onClick={() => setCurrentStep((s) => s + 1)} disabled={stepLabel === "Metadata" && !isMetadataValid}>
                Next
              </Button>
            ) : (
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || rules.length === 0}>
                {saveMutation.isPending ? "Saving..." : isStack ? "Commit to Vault as Template" : isEdit ? "Save Changes" : "Create Blueprint"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
