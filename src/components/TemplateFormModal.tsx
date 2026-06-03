import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createMemoryTemplate, updateMemoryTemplate } from "~/server/memoryFunctions";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Label, Input, Textarea, Select } from "./ui/input";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "./ui/dialog";
import { FIELD_OPTIONS, DEFAULT_STACK_PREFERENCES } from "~/lib/stackFields";

interface TemplateFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingTemplate?: any; // If editing
}

const CATEGORY_OPTIONS = [
  { value: "governance", label: "Governance" },
  { value: "stack", label: "Stack Blueprint" },
  { value: "devops", label: "DevOps & CI" },
  { value: "compliance", label: "Compliance & Security" },
  { value: "documentation", label: "Technical Docs" },
];

export function TemplateFormModal({ isOpen, onClose, editingTemplate }: TemplateFormModalProps) {
  const queryClient = useQueryClient();
  const isEdit = !!editingTemplate;

  // Wizard state
  const [currentStep, setCurrentStep] = React.useState<1 | 2 | 3>(1);

  // STEP 1: Metadata
  const [formName, setFormName] = React.useState("");
  const [formDescription, setFormDescription] = React.useState("");
  const [formCategory, setFormCategory] = React.useState("governance");

  // STEP 2 (non-stack): Custom Variables
  const [variables, setVariables] = React.useState<Array<{ key: string; description: string; default: string }>>([]);
  const [newVarKey, setNewVarKey] = React.useState("");
  const [newVarDesc, setNewVarDesc] = React.useState("");
  const [newVarDefault, setNewVarDefault] = React.useState("");

  // STEP 2 (stack): Config Properties
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

  // STEP 3: Guidelines Rules
  const [rules, setRules] = React.useState<string[]>([]);
  const [newRule, setNewRule] = React.useState("");

  React.useEffect(() => {
    if (editingTemplate) {
      setFormName(editingTemplate.name);
      setFormDescription(editingTemplate.description);
      setFormCategory(editingTemplate.category);
      setCurrentStep(1);

      try {
        const payload = JSON.parse(editingTemplate.configPayload);
        setRules(payload.rules || []);
        
        if (editingTemplate.category === "stack") {
          setStackLanguage(payload.language || DEFAULT_STACK_PREFERENCES.language);
          setStackFrontend(payload.frontend || DEFAULT_STACK_PREFERENCES.frontend);
          setStackHosting(payload.hosting || DEFAULT_STACK_PREFERENCES.hosting);
          setStackDatabase(payload.database || DEFAULT_STACK_PREFERENCES.database);
          setStackOrm(payload.orm || DEFAULT_STACK_PREFERENCES.orm);
          setStackAuth(payload.auth || DEFAULT_STACK_PREFERENCES.auth);
          setStackStyling(payload.styling || DEFAULT_STACK_PREFERENCES.styling);
          setStackSearch(payload.search || DEFAULT_STACK_PREFERENCES.search);
          setStackVector(payload.vector || DEFAULT_STACK_PREFERENCES.vector);
          setStackStorage(payload.storage || DEFAULT_STACK_PREFERENCES.storage);
          setStackStateCache(payload.stateCache || DEFAULT_STACK_PREFERENCES.stateCache);
          setStackComponentLibrary(payload.componentLibrary || DEFAULT_STACK_PREFERENCES.componentLibrary);
          setBannedProviders(payload.bannedProviders || DEFAULT_STACK_PREFERENCES.bannedProviders);
        } else {
          setVariables(payload.variables || []);
        }
      } catch (e) {
        console.error(e);
      }
    } else {
      setFormName("");
      setFormDescription("");
      setFormCategory("governance");
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
      setCurrentStep(1);
    }
  }, [editingTemplate, isOpen]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: any = { rules };
      if (formCategory === "stack") {
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
      } else {
        payload.variables = variables;
      }

      const variablesConfigString = JSON.stringify(payload);

      if (isEdit) {
        await updateMemoryTemplate({
          data: {
            id: editingTemplate.id,
            name: formName,
            description: formDescription,
            category: formCategory,
            configPayload: variablesConfigString,
          },
        });
      } else {
        await createMemoryTemplate({
          data: {
            name: formName,
            description: formDescription,
            category: formCategory,
            configPayload: variablesConfigString,
          },
        });
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
    const exists = variables.some((v) => v.key === newVarKey.trim());
    if (exists) {
      alert("Variable key already exists");
      return;
    }
    setVariables([
      ...variables,
      {
        key: newVarKey.trim(),
        description: newVarDesc.trim(),
        default: newVarDefault.trim(),
      },
    ]);
    setNewVarKey("");
    setNewVarDesc("");
    setNewVarDefault("");
  };

  const removeVariable = (key: string) => {
    setVariables(variables.filter((v) => v.key !== key));
  };

  const addRule = () => {
    if (!newRule.trim()) return;
    setRules([...rules, newRule.trim()]);
    setNewRule("");
  };

  const removeRule = (index: number) => {
    setRules(rules.filter((_, i) => i !== index));
  };

  const injectVariable = (varKey: string) => {
    setNewRule((prev) => prev + `{{${varKey}}}`);
  };

  const isMetadataValid = formName.trim() && formDescription.trim();

  const modalWidthClass = React.useMemo(() => {
    if (currentStep === 2 && formCategory === "stack") return "max-w-[940px]";
    return "max-w-[620px]";
  }, [currentStep, formCategory]);

  return (
    <Dialog open={isOpen} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className={modalWidthClass}>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>
              {isEdit ? "Edit Template" : "New Memory Template"}
            </DialogTitle>
            <Badge variant="accent" className="font-bold tracking-normal normal-case">
              Step {currentStep} of 3
            </Badge>
          </div>
          <DialogDescription>
            Configure guideline blueprint configurations and variables for Locker imports.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2 overflow-y-auto max-h-[60vh] pr-1">
          {/* STEP 1: Metadata */}
          {currentStep === 1 && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tmpl-form-name">Name</Label>
                <Input
                  id="tmpl-form-name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Next.js Enterprise Architecture"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tmpl-form-desc">Description</Label>
                <Textarea
                  id="tmpl-form-desc"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Summarize the purpose and rules governed by this template..."
                  rows={3}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tmpl-form-cat">Category Type</Label>
                <Select
                  id="tmpl-form-cat"
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                >
                  {CATEGORY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          )}

          {/* STEP 2: Variables (non-stack) */}
          {currentStep === 2 && formCategory !== "stack" && (
            <div className="flex flex-col gap-4">
              <span className="text-xs font-semibold text-text uppercase tracking-wider block border-b border-border pb-2 mb-1">
                Customize Template Variables
              </span>
              
              {/* Variable Generator */}
              <div className="bg-surface2 border border-border p-4 rounded-xl flex flex-col gap-3">
                <span className="text-[10px] font-bold text-accent uppercase tracking-wider block">
                  Define New Placeholder Variable
                </span>
                <div className="grid grid-cols-3 gap-3">
                  <div className="flex flex-col gap-1">
                    <Label className="text-[9px]">Key (e.g. API_URL)</Label>
                    <Input
                      value={newVarKey}
                      onChange={(e) => setNewVarKey(e.target.value.replace(/[^A-Z0-9_]/gi, "_").toUpperCase())}
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-[9px]">Description</Label>
                    <Input
                      value={newVarDesc}
                      onChange={(e) => setNewVarDesc(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-[9px]">Default Val</Label>
                    <Input
                      value={newVarDefault}
                      onChange={(e) => setNewVarDefault(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                </div>
                <Button onClick={addVariable} disabled={!newVarKey.trim()} size="sm" variant="outline" className="mt-1">
                  + Add Variable
                </Button>
              </div>

              {/* Variables List */}
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
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-error hover:bg-error/5" onClick={() => removeVariable(v.key)}>
                          ✕
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 2: Stack Configurations (stack) */}
          {currentStep === 2 && formCategory === "stack" && (
            <div className="flex flex-col gap-4">
              <span className="text-xs font-semibold text-text uppercase tracking-wider block border-b border-border pb-2 mb-1">
                Configure Stack Tech Specs
              </span>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {Object.keys(FIELD_OPTIONS).map((key) => (
                  <div key={key} className="flex flex-col gap-1.5">
                    <Label className="capitalize">{key}</Label>
                    <Select
                      value={
                        key === "language" ? stackLanguage :
                        key === "frontend" ? stackFrontend :
                        key === "hosting" ? stackHosting :
                        key === "database" ? stackDatabase :
                        key === "orm" ? stackOrm :
                        key === "auth" ? stackAuth :
                        key === "styling" ? stackStyling :
                        key === "search" ? stackSearch :
                        key === "vector" ? stackVector :
                        key === "storage" ? stackStorage :
                        key === "stateCache" ? stackStateCache :
                        stackComponentLibrary
                      }
                      onChange={(e) => {
                        const val = e.target.value;
                        if (key === "language") setStackLanguage(val);
                        else if (key === "frontend") setStackFrontend(val);
                        else if (key === "hosting") setStackHosting(val);
                        else if (key === "database") setStackDatabase(val);
                        else if (key === "orm") setStackOrm(val);
                        else if (key === "auth") setStackAuth(val);
                        else if (key === "styling") setStackStyling(val);
                        else if (key === "search") setStackSearch(val);
                        else if (key === "vector") setStackVector(val);
                        else if (key === "storage") setStackStorage(val);
                        else if (key === "stateCache") setStackStateCache(val);
                        else setStackComponentLibrary(val);
                      }}
                      className="text-xs h-8"
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
            </div>
          )}

          {/* STEP 3: Guidelines Rules */}
          {currentStep === 3 && (
            <div className="flex flex-col gap-4">
              <span className="text-xs font-semibold text-text uppercase tracking-wider block border-b border-border pb-2 mb-1">
                Guidelines Rules Manifesto
              </span>

              {/* Variable tags inserter */}
              {formCategory !== "stack" && variables.length > 0 && (
                <div className="flex flex-col gap-1.5 bg-surface2 border border-border p-3 rounded-lg">
                  <span className="text-[10px] uppercase font-bold text-text-muted">
                    Quick Inject Variables
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {variables.map((v) => (
                      <button
                        key={v.key}
                        type="button"
                        onClick={() => injectVariable(v.key)}
                        className="px-2 py-0.5 border border-tag-border bg-tag-bg rounded-md text-[10px] font-mono text-accent hover:border-accent/40"
                      >
                        {`{{${v.key}}}`}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Rule input */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rule-new">New Rule Directive</Label>
                <div className="flex gap-2">
                  <Input
                    id="rule-new"
                    value={newRule}
                    onChange={(e) => setNewRule(e.target.value)}
                    placeholder="Enter architectural constraint or formatting rule..."
                    className="flex-1 text-xs"
                  />
                  <Button onClick={addRule} disabled={!newRule.trim()} size="sm" variant="outline">
                    Add
                  </Button>
                </div>
              </div>

              {/* Rules List */}
              <div className="flex flex-col gap-2">
                <Label>Manifesto Rules List</Label>
                {rules.length === 0 ? (
                  <p className="text-xs text-text-muted italic py-1">No rules defined. Templates require at least one rule.</p>
                ) : (
                  <div className="flex flex-col gap-2.5 border border-border bg-surface2 p-3 rounded-lg max-h-[300px] overflow-y-auto no-scrollbar">
                    {rules.map((rule, idx) => (
                      <div key={idx} className="flex justify-between items-start text-xs border-b border-border/40 pb-2 last:border-0 last:pb-0 gap-3">
                        <span className="text-text leading-relaxed flex-1 font-medium">{rule}</span>
                        <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-error hover:bg-error/5 flex-shrink-0" onClick={() => removeRule(idx)}>
                          ✕
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <DialogFooter className="flex justify-between items-center sm:justify-between">
          <div>
            {currentStep > 1 && (
              <Button variant="ghost" onClick={() => setCurrentStep((prev) => (prev - 1) as any)}>
                Back
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>

            {currentStep < 3 ? (
              <Button onClick={() => setCurrentStep((prev) => (prev + 1) as any)} disabled={currentStep === 1 && !isMetadataValid}>
                Next
              </Button>
            ) : (
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || rules.length === 0}>
                {saveMutation.isPending ? "Saving..." : isEdit ? "Save Changes" : "Create Blueprint"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
