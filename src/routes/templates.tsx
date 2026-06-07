import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listMemoryTemplates,
  deleteMemoryTemplate,
  addMemory,
  getUserWorkspaces,
} from "~/server/memoryFunctions";
import { PageContainer } from "~/components/PageContainer";
import { PageHeader } from "~/components/PageHeader";
import { TemplateRow } from "~/components/TemplateRow";
import { TemplateFormModal } from "~/components/TemplateFormModal";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Label, Input, Select } from "~/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "~/components/ui/dialog";

export const Route = createFileRoute("/templates")({
  component: TemplatesPage,
});

type TemplateCategory = "stack" | "governance" | "devops" | "compliance" | "documentation";

type VariableConfig = {
  key: string;
  description: string;
  default: string;
};

type ParsedPayload = {
  rules: string[];
  variables?: VariableConfig[];
  language?: string;
  frontend?: string;
  hosting?: string;
  database?: string;
  storage?: string;
  search?: string;
  vector?: string;
  orm?: string;
  auth?: string;
  styling?: string;
  stateCache?: string;
  componentLibrary?: string;
  bannedProviders?: string[];
};

function downloadFile(content: string, filename: string, contentType: string) {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportTemplatesToJson(templatesToExport: any[]) {
  const data = templatesToExport.map(({ id, name, description, category, configPayload, createdAt }) => ({
    id,
    name,
    description,
    category,
    configPayload,
    createdAt,
  }));
  return JSON.stringify(data, null, 2);
}

interface TemplateTableProps {
  templates: any[];
  activeTab: string;
  filter: string;
  sortBy: "newest" | "oldest" | "alphabetical";
  onImport: (tmpl: any) => void;
  onEdit: (tmpl: any) => void;
  onDelete: (tmpl: any) => void;
}

function TemplateTable({
  templates,
  activeTab,
  filter,
  sortBy,
  onImport,
  onEdit,
  onDelete,
}: TemplateTableProps) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkConfirming, setBulkConfirming] = useState(false);

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => deleteMemoryTemplate({ data: { id } })));
    },
    onMutate: () => {
      setSelected(new Set());
      setBulkConfirming(false);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates"] });
    },
  });

  const filtered = useMemo(() => {
    const q = filter.toLowerCase();
    const results = templates.filter((t) => {
      const matchesTab = activeTab === "all" || t.category === activeTab;
      const matchesSearch =
        !q ||
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q);
      return matchesTab && matchesSearch;
    });

    if (sortBy === "newest") {
      results.sort((a, b) => b.createdAt - a.createdAt);
    } else if (sortBy === "oldest") {
      results.sort((a, b) => a.createdAt - b.createdAt);
    } else if (sortBy === "alphabetical") {
      results.sort((a, b) => a.name.localeCompare(b.name));
    }

    return results;
  }, [templates, activeTab, filter, sortBy]);

  const filteredIds = useMemo(() => new Set(filtered.map((t) => t.id)), [filtered]);
  const allSelected = filtered.length > 0 && filtered.every((t) => selected.has(t.id));
  const someSelected = filtered.some((t) => selected.has(t.id));
  const selectedInView = filtered.filter((t) => selected.has(t.id));

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
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleExport(itemsToExport: any[]) {
    const jsonContent = exportTemplatesToJson(itemsToExport);
    downloadFile(
      jsonContent,
      `locker_templates_${new Date().toISOString().split("T")[0]}.json`,
      "application/json"
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="text-center py-12 px-6 text-text-muted bg-surface border border-border rounded-xl">
        {templates.length === 0 ? "No templates stored yet." : "No templates match your filters."}
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden shadow-xs">
      <div className="px-4 py-3 border-b border-border flex items-center gap-3 bg-surface2 select-none">
        <input
          type="checkbox"
          checked={allSelected}
          ref={(el) => {
            if (el) el.indeterminate = someSelected && !allSelected;
          }}
          onChange={toggleSelectAll}
          className="cursor-pointer h-4 w-4 rounded-sm border-border text-accent focus:ring-accent accent-accent"
        />
        {someSelected ? (
          <>
            <span className="text-xs text-text-muted font-medium">
              {selectedInView.length} selected
            </span>
            {bulkConfirming ? (
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-xs text-error font-medium">
                  Delete {selectedInView.length} template{selectedInView.length !== 1 ? "s" : ""}?
                </span>
                <Button
                  onClick={() => bulkDeleteMutation.mutate(selectedInView.map((t) => t.id))}
                  disabled={bulkDeleteMutation.isPending}
                  size="sm"
                  className="h-7 text-xs bg-error/15 border-error/40 text-error hover:bg-error/25 hover:border-error/60"
                  variant="outline"
                >
                  {bulkDeleteMutation.isPending ? "Deleting…" : "Yes, delete"}
                </Button>
                <Button
                  onClick={() => setBulkConfirming(false)}
                  disabled={bulkDeleteMutation.isPending}
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="ml-auto flex gap-2 items-center">
                <Button
                  onClick={() => handleExport(selectedInView)}
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs font-semibold hover:border-accent/40 hover:text-accent"
                >
                  Export JSON
                </Button>
                <Button
                  onClick={() => setBulkConfirming(true)}
                  size="sm"
                  className="h-7 text-xs font-semibold bg-error/10 border-error/20 text-error hover:bg-error/20 hover:border-error/40"
                  variant="outline"
                >
                  Delete selected
                </Button>
              </div>
            )}
          </>
        ) : (
          <>
            <span className="text-xs text-text-muted font-medium">
              {filtered.length} template{filtered.length !== 1 ? "s" : ""}
            </span>
            {filtered.length > 0 && (
              <div className="ml-auto flex gap-2 items-center">
                <Button
                  onClick={() => handleExport(filtered)}
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs font-semibold hover:border-accent/40 hover:text-accent"
                >
                  Export All (JSON)
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="divide-y divide-border">
        {filtered.map((tmpl) => (
          <TemplateRow
            key={tmpl.id}
            template={tmpl}
            selected={selected.has(tmpl.id)}
            onToggleSelect={toggleOne}
            onImport={onImport}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
      </div>
    </div>
  );
}

function TemplatesPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"all" | TemplateCategory>("all");
  const [editingTemplate, setEditingTemplate] = useState<any>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [importingTemplate, setImportingTemplate] = useState<any>(null);
  const [filter, setFilter] = useState("");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "alphabetical">("newest");

  // Import State
  const [importWorkspace, setImportWorkspace] = useState("personal");
  const [importVariables, setImportVariables] = useState<Record<string, string>>({});
  const [importError, setImportError] = useState<string | null>(null);

  // Queries
  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["templates"],
    queryFn: () => listMemoryTemplates(),
  });

  const { data: workspacesList = [] } = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => getUserWorkspaces(),
  });
  const workspaces = Array.isArray(workspacesList) ? workspacesList : [];

  // Mutations
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteMemoryTemplate({ data: { id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates"] });
    },
  });

  const importMut = useMutation({
    mutationFn: async (data: any) => {
      try {
        console.log("[importMut] Starting import...");
        const result = await addMemory({ data });
        console.log("[importMut] Import completed");
        return result;
      } catch (err) {
        console.error("[importMut] Error:", err);
        throw err;
      }
    },
    onSuccess: (result) => {
      console.log("[importMut] Success:", result);
      queryClient.invalidateQueries({ queryKey: ["memories"] });
      setImportingTemplate(null);
      setImportVariables({});
      setImportError(null);
      alert("Successfully imported template rules into your Memories!");
    },
    onError: (error) => {
      console.error("[importMut] Error callback:", error);
      setImportError((error as Error).message || "Failed to import template");
    },
  });

  const handleEdit = (tmpl: any) => {
    setEditingTemplate(tmpl);
  };

  const startImport = (tmpl: any) => {
    console.log("[startImport] Opening import modal for:", tmpl.name);
    setImportingTemplate(tmpl);
    setImportError(null);
    let payload: ParsedPayload = { rules: [] };
    try {
      payload = JSON.parse(tmpl.configPayload);
    } catch (e) {}

    const defaultVars: Record<string, string> = {};
    (payload.variables || []).forEach((v) => {
      defaultVars[v.key] = v.default;
    });
    setImportVariables(defaultVars);
    setImportWorkspace("personal");
  };

  const handleImportSubmit = async () => {
    if (!importingTemplate) return;

    try {
      setImportError(null);

      let payload: ParsedPayload = { rules: [] };
      try {
        payload = JSON.parse(importingTemplate.configPayload);
      } catch (e) {}

      const instantiatedRules = (payload.rules || []).map((rule) => {
        let finalRule = rule;
        Object.entries(importVariables).forEach(([k, v]) => {
          finalRule = finalRule.replaceAll(`{{${k}}}`, v);
        });
        return finalRule;
      });

      let factText = `# ${importingTemplate.name}\n${importingTemplate.description}\n\n`;
      if (importingTemplate.category === "stack") {
        factText += `## Stack Preferences:\n`;
        factText += `- Language: ${payload.language}\n`;
        factText += `- Frontend: ${payload.frontend}\n`;
        factText += `- Hosting: ${payload.hosting}\n`;
        factText += `- Database: ${payload.database}\n`;
        factText += `- ORM/DB Access: ${payload.orm}\n`;
        factText += `- Authentication: ${payload.auth}\n`;
        factText += `- Styling: ${payload.styling}\n`;
        factText += `- State/Cache: ${payload.stateCache}\n`;
        if (payload.componentLibrary) {
          factText += `- Component Library: ${payload.componentLibrary}\n`;
        }
        if (payload.search && payload.search !== "None") {
          factText += `- Full-Text Search: ${payload.search}\n`;
        }
        if (payload.vector && payload.vector !== "None") {
          factText += `- Vector Database: ${payload.vector}\n`;
        }
        factText += `- Storage: ${payload.storage}\n`;
        if (payload.bannedProviders && payload.bannedProviders.length > 0) {
          factText += `- Banned Providers: ${payload.bannedProviders.join(", ")}\n`;
        }
        factText += `\n`;
      }

      factText += `## Guidelines & Constraints:\n`;
      factText += instantiatedRules.map((r) => `- ${r}`).join("\n");

      const categoryForMemory = importingTemplate.category === "stack" ? "stack" : "rules";

      importMut.mutate({
        fact: factText,
        category: categoryForMemory,
        tags: `imported, template, ${importingTemplate.category}`,
        projectKey: importWorkspace === "personal" ? undefined : importWorkspace,
      });
    } catch (err) {
      setImportError((err as Error).message || "Failed to prepare import");
    }
  };

  const totalByCategory = useMemo(() => {
    const counts: Record<string, number> = {
      stack: 0,
      governance: 0,
      devops: 0,
      compliance: 0,
      documentation: 0,
    };
    for (const t of templates) {
      if (counts[t.category] !== undefined) {
        counts[t.category]++;
      }
    }
    return counts;
  }, [templates]);

  return (
    <div className="flex-1 min-h-screen bg-background">
      <PageHeader
        title="Memory Templates"
        icon={
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          </svg>
        }
        description="Create, customize, and instantiate guideline blueprints into your locker vaults."
        count={templates.length}
        countLabel="templates"
        actions={
          <Button
            onClick={() => setShowCreateModal(true)}
            variant="default"
            className="h-9 px-4 font-bold text-xs select-none gap-1.5"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5"
                x2="12"
                y2="19"
              />
              <line x1="5" y1="12"
                x2="19"
                y2="12"
              />
            </svg>
            New Template
          </Button>
        }
      />

      <PageContainer>
        {/* Stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 select-none">
          {[
            { label: "Total", value: templates.length, variant: "secondary" as const },
            { label: "Stacks", value: totalByCategory.stack, variant: "stack" as const },
            { label: "Governance", value: totalByCategory.governance, variant: "governance" as const },
            { label: "DevOps", value: totalByCategory.devops, variant: "devops" as const },
            { label: "Compliance", value: totalByCategory.compliance, variant: "compliance" as const },
            { label: "Docs", value: totalByCategory.documentation, variant: "documentation" as const },
          ].map(({ label, value, variant }) => (
            <div
              key={label}
              className="bg-surface2/30 border border-border/80 rounded-2xl p-4 flex flex-col items-center justify-center text-center shadow-xs"
            >
              <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-2">
                {label}
              </div>
              <Badge variant={variant} className="text-sm px-3.5 py-1 font-bold">
                {value}
              </Badge>
            </div>
          ))}
        </div>

        {/* Tabs switcher */}
        <div className="flex gap-1 border-b border-border overflow-x-auto no-scrollbar select-none">
          {(["all", "stack", "governance", "devops", "compliance", "documentation"] as const).map((tab) => {
            const isActive = activeTab === tab;
            const count = tab === "all" ? templates.length : templates.filter((t) => t.category === tab).length;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2.5 text-xs md:text-sm font-semibold border-b-2 whitespace-nowrap transition-colors -mb-[1px] rounded-t-md hover:bg-surface2/40 uppercase tracking-wider text-[11px] ${
                  isActive
                    ? "border-accent text-accent bg-surface"
                    : "border-transparent text-text-muted hover:text-text"
                }`}
              >
                {tab === "all" ? "All Templates" : tab}
                {count > 0 && <span className="ml-1.5 opacity-70">({count})</span>}
              </button>
            );
          })}
        </div>

        {/* Filter & Search Bar */}
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center select-none">
          <div className="relative flex-1">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <Input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search templates by name, description, or keyword…"
              className="pl-9 h-10 w-full"
            />
          </div>

          <Select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as "newest" | "oldest" | "alphabetical")}
            className="h-10 min-w-[150px] cursor-pointer"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="alphabetical">Alphabetical</option>
          </Select>

          {(filter || sortBy !== "newest") && (
            <Button
              onClick={() => {
                setFilter("");
                setSortBy("newest");
              }}
              variant="outline"
              className="h-10 px-4 font-semibold text-xs border border-border"
            >
              Clear all
            </Button>
          )}
        </div>

        {/* Templates list area */}
        {isLoading ? (
          <div className="py-20 text-center text-text-muted font-medium animate-pulse">
            Loading templates...
          </div>
        ) : (
          <TemplateTable
            templates={templates}
            activeTab={activeTab}
            filter={filter}
            sortBy={sortBy}
            onImport={startImport}
            onEdit={handleEdit}
            onDelete={(t) => {
              if (confirm(`Are you sure you want to delete "${t.name}"?`)) {
                deleteMut.mutate(t.id);
              }
            }}
          />
        )}
      </PageContainer>

      {/* CREATE/EDIT MODAL */}
      {(showCreateModal || editingTemplate) && (
        <TemplateFormModal
          editingTemplate={editingTemplate}
          isOpen={showCreateModal || !!editingTemplate}
          onClose={() => {
            setShowCreateModal(false);
            setEditingTemplate(null);
          }}
        />
      )}

      {/* IMPORT MODAL */}
      {importingTemplate && (
        <Dialog
          open={!!importingTemplate}
          onOpenChange={(o) => {
            if (!o) {
              setImportingTemplate(null);
              setImportVariables({});
            }
          }}
        >
          <DialogContent className="max-w-[520px]">
            <DialogHeader>
              <DialogTitle>Import Template: {importingTemplate.name}</DialogTitle>
              <DialogDescription>
                Configure guidelines and template variables to import into your Memories workspace.
              </DialogDescription>
            </DialogHeader>

            <div className="py-4 flex flex-col gap-5 overflow-y-auto max-h-[60vh] pr-1 select-none">
              {/* Error Display */}
              {importError && (
                <div className="p-3 bg-error/10 border border-error/20 rounded-lg text-error text-xs font-medium flex items-start justify-between gap-2 group">
                  <p className="select-text flex-1">{importError}</p>
                  <button
                    onClick={() => navigator.clipboard.writeText(importError)}
                    className="shrink-0 px-2 py-1 rounded text-[10px] font-bold opacity-0 group-hover:opacity-100 bg-error/20 hover:bg-error/30 transition-all"
                    title="Copy error"
                  >
                    Copy
                  </button>
                </div>
              )}

              {/* Locker Workspace Destination */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="import-workspace">Destination Workspace</Label>
                <Select
                  id="import-workspace"
                  value={importWorkspace}
                  onChange={(e) => setImportWorkspace(e.target.value)}
                >
                  {workspaces.map((w: any) => (
                    <option key={w.key} value={w.key}>
                      {w.label}
                    </option>
                  ))}
                </Select>
              </div>

              {/* Dynamic Variables Form */}
              {Object.keys(importVariables).length > 0 && (
                <div className="border border-border rounded-xl p-4 bg-surface2 flex flex-col gap-4">
                  <span className="text-[10px] font-bold text-accent uppercase tracking-wider block">
                    Template Variables
                  </span>
                  <div className="flex flex-col gap-3">
                    {(() => {
                      let payload: ParsedPayload = { rules: [] };
                      try {
                        payload = JSON.parse(importingTemplate.configPayload);
                      } catch (e) {}
                      return (payload.variables || []).map((v) => (
                        <div key={v.key} className="flex flex-col gap-1">
                          <Label htmlFor={`var-${v.key}`} className="text-xs">
                            {v.key}
                          </Label>
                          <Input
                            id={`var-${v.key}`}
                            type="text"
                            value={importVariables[v.key]}
                            onChange={(e) =>
                              setImportVariables({ ...importVariables, [v.key]: e.target.value })
                            }
                            placeholder={v.default}
                            className="h-8 text-xs font-mono"
                          />
                          {v.description && (
                            <span className="text-[10px] text-text-muted mt-0.5 leading-relaxed">
                              {v.description}
                            </span>
                          )}
                        </div>
                      ));
                    })()}
                  </div>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setImportingTemplate(null);
                  setImportVariables({});
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  console.log("[Button] Confirm Import clicked");
                  handleImportSubmit();
                }}
                disabled={importMut.isPending}
              >
                {importMut.isPending ? "Importing..." : "Confirm Import"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
