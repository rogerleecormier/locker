import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listMemoryTemplates,
  createMemoryTemplate,
  updateMemoryTemplate,
  deleteMemoryTemplate,
  addMemory,
  getUserWorkspaces,
} from "~/server/memoryFunctions";

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
  // If stack category:
  language?: string;
  frontend?: string;
  hosting?: string;
  database?: string;
  storage?: string;
  search?: string;
  orm?: string;
  auth?: string;
  styling?: string;
  stateCache?: string;
  bannedProviders?: string[];
};

function TemplatesPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"all" | TemplateCategory>("all");
  const [editingTemplate, setEditingTemplate] = useState<any>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [importingTemplate, setImportingTemplate] = useState<any>(null);

  // Form State
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formCategory, setFormCategory] = useState<TemplateCategory>("stack");
  const [formRules, setFormRules] = useState<string[]>([""]);
  const [formVariables, setFormVariables] = useState<VariableConfig[]>([]);

  // Stack Fields
  const [stackLanguage, setStackLanguage] = useState("TypeScript");
  const [stackFrontend, setStackFrontend] = useState("React / TanStack");
  const [stackHosting, setStackHosting] = useState("Cloudflare Edge");
  const [stackDatabase, setStackDatabase] = useState("Cloudflare D1");
  const [stackStorage, setStackStorage] = useState("Cloudflare R2");
  const [stackSearch, setStackSearch] = useState("Cloudflare Vectorize");
  const [stackOrm, setStackOrm] = useState("Drizzle ORM");
  const [stackAuth, setStackAuth] = useState("Better Auth");
  const [stackStyling, setStackStyling] = useState("Vanilla CSS");
  const [stackStateCache, setStackStateCache] = useState("TanStack Store");
  const [stackBanned, setStackBanned] = useState<string[]>([]);

  // Import State
  const [importWorkspace, setImportWorkspace] = useState("personal");
  const [importVariables, setImportVariables] = useState<Record<string, string>>({});

  // Queries
  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["templates"],
    queryFn: () => listMemoryTemplates(),
  });

  const { data: workspaces = [] } = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => getUserWorkspaces(),
  });

  // Mutations
  const createMut = useMutation({
    mutationFn: (data: any) => createMemoryTemplate({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      setShowCreateModal(false);
      resetForm();
    },
  });

  const updateMut = useMutation({
    mutationFn: (data: any) => updateMemoryTemplate({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      setEditingTemplate(null);
      resetForm();
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteMemoryTemplate({ data: { id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates"] });
    },
  });

  const importMut = useMutation({
    mutationFn: (data: any) => addMemory({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memories"] });
      setImportingTemplate(null);
      setImportVariables({});
      alert("Successfully imported template rules into your memory locker!");
    },
  });

  const resetForm = () => {
    setFormName("");
    setFormDesc("");
    setFormCategory("stack");
    setFormRules([""]);
    setFormVariables([]);
    setStackLanguage("TypeScript");
    setStackFrontend("React / TanStack");
    setStackHosting("Cloudflare Edge");
    setStackDatabase("Cloudflare D1");
    setStackStorage("Cloudflare R2");
    setStackSearch("Cloudflare Vectorize");
    setStackOrm("Drizzle ORM");
    setStackAuth("Better Auth");
    setStackStyling("Vanilla CSS");
    setStackStateCache("TanStack Store");
    setStackBanned([]);
  };

  const handleEdit = (tmpl: any) => {
    setEditingTemplate(tmpl);
    setFormName(tmpl.name);
    setFormDesc(tmpl.description);
    setFormCategory(tmpl.category);
    
    let payload: ParsedPayload = { rules: [] };
    try {
      payload = JSON.parse(tmpl.configPayload);
    } catch (e) {}

    setFormRules(payload.rules || [""]);
    setFormVariables(payload.variables || []);

    if (tmpl.category === "stack") {
      setStackLanguage(payload.language || "TypeScript");
      setStackFrontend(payload.frontend || "React / TanStack");
      setStackHosting(payload.hosting || "Cloudflare Edge");
      setStackDatabase(payload.database || "Cloudflare D1");
      setStackStorage(payload.storage || "Cloudflare R2");
      setStackSearch(payload.search || "Cloudflare Vectorize");
      setStackOrm(payload.orm || "Drizzle ORM");
      setStackAuth(payload.auth || "Better Auth");
      setStackStyling(payload.styling || "Vanilla CSS");
      setStackStateCache(payload.stateCache || "TanStack Store");
      setStackBanned(payload.bannedProviders || []);
    }
  };

  const handleSave = () => {
    const payload: ParsedPayload = {
      rules: formRules.filter((r) => r.trim() !== ""),
      variables: formVariables.filter((v) => v.key.trim() !== ""),
    };

    if (formCategory === "stack") {
      payload.language = stackLanguage;
      payload.frontend = stackFrontend;
      payload.hosting = stackHosting;
      payload.database = stackDatabase;
      payload.storage = stackStorage;
      payload.search = stackSearch;
      payload.orm = stackOrm;
      payload.auth = stackAuth;
      payload.styling = stackStyling;
      payload.stateCache = stackStateCache;
      payload.bannedProviders = stackBanned;
    }

    const templateData = {
      name: formName,
      description: formDesc,
      category: formCategory,
      configPayload: JSON.stringify(payload),
    };

    if (editingTemplate) {
      updateMut.mutate({ id: editingTemplate.id, ...templateData });
    } else {
      createMut.mutate(templateData);
    }
  };

  const startImport = (tmpl: any) => {
    setImportingTemplate(tmpl);
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

  const handleImportSubmit = () => {
    if (!importingTemplate) return;
    let payload: ParsedPayload = { rules: [] };
    try {
      payload = JSON.parse(importingTemplate.configPayload);
    } catch (e) {}

    // Replace variables in rules
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
      factText += `- Storage: ${payload.storage}\n`;
      factText += `- Search/Vector: ${payload.search}\n`;
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
  };

  const getCategoryTheme = (cat: TemplateCategory) => {
    switch (cat) {
      case "stack":
        return { color: "#a855f7", bg: "rgba(168,85,247,0.12)", border: "rgba(168,85,247,0.3)" };
      case "governance":
        return { color: "#22c55e", bg: "rgba(34,197,94,0.12)", border: "rgba(34,197,94,0.3)" };
      case "devops":
        return { color: "#3b82f6", bg: "rgba(59,130,246,0.12)", border: "rgba(59,130,246,0.3)" };
      case "compliance":
        return { color: "#ef4444", bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.3)" };
      case "documentation":
        return { color: "#f97316", bg: "rgba(249,115,22,0.12)", border: "rgba(249,115,22,0.3)" };
    }
  };

  const filteredTemplates = templates.filter(
    (t) => activeTab === "all" || t.category === activeTab
  );

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", padding: "40px 24px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em", color: "var(--text)" }}>Memory Templates</h1>
          <p style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 4 }}>
            Create and manage guidelines templates that you can import into your workspaces or use as stack presets.
          </p>
        </div>
        <button
          onClick={() => {
            resetForm();
            setShowCreateModal(true);
          }}
          style={{
            padding: "10px 18px",
            background: "var(--accent)",
            color: "white",
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span>＋</span> New Template
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, borderBottom: "1px solid var(--border)", paddingBottom: 12, marginBottom: 28, overflowX: "auto" }}>
        {(["all", "stack", "governance", "devops", "compliance", "documentation"] as const).map((tab) => {
          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: "6px 14px",
                background: isActive ? "var(--surface2)" : "transparent",
                color: isActive ? "var(--text)" : "var(--text-muted)",
                border: "1px solid " + (isActive ? "var(--border)" : "transparent"),
                borderRadius: "var(--radius)",
                textTransform: "capitalize",
                fontWeight: isActive ? 600 : 500,
              }}
            >
              {tab === "all" ? "All Templates" : tab}
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <div style={{ padding: "40px 0", textAlign: "center", color: "var(--text-muted)" }}>Loading templates...</div>
      ) : filteredTemplates.length === 0 ? (
        <div style={{
          padding: "80px 20px",
          textAlign: "center",
          border: "2px dashed var(--border)",
          borderRadius: 12,
          background: "var(--surface)",
        }}>
          <span style={{ fontSize: 32 }}>📁</span>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginTop: 12, marginBottom: 4 }}>No templates found</h3>
          <p style={{ color: "var(--text-muted)", fontSize: 13, maxWidth: 300, margin: "0 auto 16px" }}>
            Create a custom preset template for devops, documentation, stack baselines, or compliance policies.
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 20 }}>
          {filteredTemplates.map((tmpl) => {
            const theme = getCategoryTheme(tmpl.category as TemplateCategory);
            let payload: ParsedPayload = { rules: [] };
            try {
              payload = JSON.parse(tmpl.configPayload);
            } catch (e) {}

            return (
              <div
                key={tmpl.id}
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  padding: 20,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  transition: "border-color 0.2s",
                }}
              >
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                    <span style={{
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      color: theme?.color,
                      background: theme?.bg,
                      border: "1px solid " + theme?.border,
                      padding: "2px 8px",
                      borderRadius: 20,
                      letterSpacing: "0.04em",
                    }}>
                      {tmpl.category}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {new Date(tmpl.createdAt * 1000).toLocaleDateString()}
                    </span>
                  </div>

                  <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>{tmpl.name}</h3>
                  <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5, marginBottom: 16 }}>{tmpl.description}</p>

                  {payload.variables && payload.variables.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", display: "block", marginBottom: 6 }}>Variables:</span>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {payload.variables.map((v) => (
                          <span key={v.key} style={{ fontSize: 11, color: "var(--text)", background: "var(--surface2)", padding: "2px 6px", borderRadius: 4, fontFamily: "monospace" }}>
                            {v.key}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", gap: 8, marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
                  <button
                    onClick={() => startImport(tmpl)}
                    style={{
                      flex: 1,
                      padding: "6px 12px",
                      background: "var(--accent-dim)",
                      color: "var(--accent)",
                      border: "1px solid rgba(168,85,247,0.3)",
                      fontWeight: 600,
                    }}
                  >
                    Import to Locker
                  </button>
                  <button
                    onClick={() => handleEdit(tmpl)}
                    style={{
                      padding: "6px 10px",
                      background: "var(--surface2)",
                      border: "1px solid var(--border)",
                      color: "var(--text-muted)",
                    }}
                    title="Edit Template"
                  >
                    ✏️
                  </button>
                  <button
                    onClick={() => {
                      if (confirm("Are you sure you want to delete this template?")) {
                        deleteMut.mutate(tmpl.id);
                      }
                    }}
                    style={{
                      padding: "6px 10px",
                      background: "rgba(239,68,68,0.08)",
                      border: "1px solid rgba(239,68,68,0.2)",
                      color: "var(--error)",
                    }}
                    title="Delete Template"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* CREATE/EDIT MODAL */}
      {(showCreateModal || editingTemplate) && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(8px)",
          zIndex: 100,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
        }}>
          <div style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            width: "100%",
            maxWidth: 680,
            maxHeight: "90vh",
            display: "flex",
            flexDirection: "column",
            boxShadow: "0 24px 48px rgba(0,0,0,0.5)",
          }}>
            <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 700, fontSize: 16 }}>{editingTemplate ? "Edit Template" : "New Memory Template"}</span>
              <button onClick={() => {
                setShowCreateModal(false);
                setEditingTemplate(null);
                resetForm();
              }} style={{ background: "none", color: "var(--text-muted)", fontSize: 20 }}>×</button>
            </div>

            <div style={{ padding: 24, overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div>
                  <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6, fontWeight: 600 }}>Template Name</label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. Next.js Stack Preset"
                    style={{ width: "100%", padding: "8px 12px" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6, fontWeight: 600 }}>Category</label>
                  <select
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value as TemplateCategory)}
                    style={{ width: "100%", padding: "8px 12px", background: "var(--surface2)" }}
                    disabled={!!editingTemplate}
                  >
                    <option value="stack">Stack (Tech Stack Blueprint)</option>
                    <option value="governance">Governance (Git, Branching, PRs)</option>
                    <option value="devops">DevOps (CI/CD Pipeline)</option>
                    <option value="compliance">Compliance (GDPR, Privacy)</option>
                    <option value="documentation">Documentation (API, Style)</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6, fontWeight: 600 }}>Description</label>
                <textarea
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder="Summarize what guidelines this template governs..."
                  style={{ width: "100%", padding: "8px 12px", minHeight: 60, resize: "vertical" }}
                />
              </div>

              {formCategory === "stack" && (
                <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 16, background: "var(--surface2)" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", display: "block", marginBottom: 12 }}>Stack Dropdown Configuration</span>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <label style={{ display: "block", fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>Language</label>
                      <input type="text" value={stackLanguage} onChange={(e) => setStackLanguage(e.target.value)} style={{ width: "100%", padding: 6, fontSize: 12 }} />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>Frontend Framework</label>
                      <input type="text" value={stackFrontend} onChange={(e) => setStackFrontend(e.target.value)} style={{ width: "100%", padding: 6, fontSize: 12 }} />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>Hosting Runtime</label>
                      <input type="text" value={stackHosting} onChange={(e) => setStackHosting(e.target.value)} style={{ width: "100%", padding: 6, fontSize: 12 }} />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>Database</label>
                      <input type="text" value={stackDatabase} onChange={(e) => setStackDatabase(e.target.value)} style={{ width: "100%", padding: 6, fontSize: 12 }} />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>ORM</label>
                      <input type="text" value={stackOrm} onChange={(e) => setStackOrm(e.target.value)} style={{ width: "100%", padding: 6, fontSize: 12 }} />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>Auth</label>
                      <input type="text" value={stackAuth} onChange={(e) => setStackAuth(e.target.value)} style={{ width: "100%", padding: 6, fontSize: 12 }} />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>Styling</label>
                      <input type="text" value={stackStyling} onChange={(e) => setStackStyling(e.target.value)} style={{ width: "100%", padding: 6, fontSize: 12 }} />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>State / Cache</label>
                      <input type="text" value={stackStateCache} onChange={(e) => setStackStateCache(e.target.value)} style={{ width: "100%", padding: 6, fontSize: 12 }} />
                    </div>
                  </div>
                </div>
              )}

              {/* Template Rules List */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <label style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>Guidelines / Rules</label>
                  <button onClick={() => setFormRules([...formRules, ""])} style={{ padding: "2px 8px", background: "var(--border)", fontSize: 11 }}>＋ Add Rule</button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {formRules.map((rule, idx) => (
                    <div key={idx} style={{ display: "flex", gap: 8 }}>
                      <input
                        type="text"
                        value={rule}
                        onChange={(e) => {
                          const list = [...formRules];
                          list[idx] = e.target.value;
                          setFormRules(list);
                        }}
                        placeholder="Define a constraint rule (you can inject variables using {{MY_VAR}})..."
                        style={{ flex: 1, padding: "6px 10px" }}
                      />
                      {formRules.length > 1 && (
                        <button
                          onClick={() => setFormRules(formRules.filter((_, i) => i !== idx))}
                          style={{ padding: "0 10px", background: "rgba(239,68,68,0.1)", color: "var(--error)" }}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Variables builder */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <label style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>Variables Mapping</label>
                  <button onClick={() => setFormVariables([...formVariables, { key: "", description: "", default: "" }])} style={{ padding: "2px 8px", background: "var(--border)", fontSize: 11 }}>＋ Add Variable</button>
                </div>
                {formVariables.length === 0 ? (
                  <span style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>No variables defined. Use variables to allow parameters interpolation during import.</span>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {formVariables.map((v, idx) => (
                      <div key={idx} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <input
                          type="text"
                          value={v.key}
                          onChange={(e) => {
                            const list = [...formVariables];
                            list[idx].key = e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "");
                            setFormVariables(list);
                          }}
                          placeholder="KEY (e.g. DB_BINDING)"
                          style={{ width: "30%", padding: 6 }}
                        />
                        <input
                          type="text"
                          value={v.description}
                          onChange={(e) => {
                            const list = [...formVariables];
                            list[idx].description = e.target.value;
                            setFormVariables(list);
                          }}
                          placeholder="Description"
                          style={{ flex: 1, padding: 6 }}
                        />
                        <input
                          type="text"
                          value={v.default}
                          onChange={(e) => {
                            const list = [...formVariables];
                            list[idx].default = e.target.value;
                            setFormVariables(list);
                          }}
                          placeholder="Default"
                          style={{ width: "20%", padding: 6 }}
                        />
                        <button
                          onClick={() => setFormVariables(formVariables.filter((_, i) => i !== idx))}
                          style={{ padding: "0 10px", background: "rgba(239,68,68,0.1)", color: "var(--error)", height: 28 }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div style={{ padding: "16px 24px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setEditingTemplate(null);
                  resetForm();
                }}
                style={{ padding: "8px 16px", background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)" }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!formName.trim() || createMut.isPending || updateMut.isPending}
                style={{ padding: "8px 20px", background: "var(--accent)", color: "white", fontWeight: 600 }}
              >
                {createMut.isPending || updateMut.isPending ? "Saving..." : "Save Template"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* IMPORT MODAL */}
      {importingTemplate && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(8px)",
          zIndex: 110,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
        }}>
          <div style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            width: "100%",
            maxWidth: 520,
            boxShadow: "0 24px 48px rgba(0,0,0,0.5)",
          }}>
            <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 700, fontSize: 16 }}>Import Template: {importingTemplate.name}</span>
              <button onClick={() => {
                setImportingTemplate(null);
                setImportVariables({});
              }} style={{ background: "none", color: "var(--text-muted)", fontSize: 20 }}>×</button>
            </div>

            <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Locker Workspace Destination */}
              <div>
                <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6, fontWeight: 600 }}>Destination Locker Workspace</label>
                <select
                  value={importWorkspace}
                  onChange={(e) => setImportWorkspace(e.target.value)}
                  style={{ width: "100%", padding: "8px 12px", background: "var(--surface2)" }}
                >
                  <option value="personal">Personal Vault</option>
                  {workspaces.map((w: any) => (
                    <option key={w.key} value={w.key}>
                      {w.name} ({w.type === "org" ? "Org Locker" : "Team Locker"})
                    </option>
                  ))}
                </select>
              </div>

              {/* Dynamic Variables Form */}
              {Object.keys(importVariables).length > 0 && (
                <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 16, background: "var(--surface2)" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", display: "block", marginBottom: 12 }}>Template Variables</span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {(() => {
                      let payload: ParsedPayload = { rules: [] };
                      try {
                        payload = JSON.parse(importingTemplate.configPayload);
                      } catch (e) {}
                      return (payload.variables || []).map((v) => (
                        <div key={v.key}>
                          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>
                            {v.key}
                          </label>
                          <input
                            type="text"
                            value={importVariables[v.key]}
                            onChange={(e) => setImportVariables({ ...importVariables, [v.key]: e.target.value })}
                            placeholder={v.default}
                            style={{ width: "100%", padding: "6px 10px", fontSize: 12.5 }}
                          />
                          <span style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginTop: 2 }}>{v.description}</span>
                        </div>
                      ));
                    })()}
                  </div>
                </div>
              )}
            </div>

            <div style={{ padding: "16px 24px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                onClick={() => {
                  setImportingTemplate(null);
                  setImportVariables({});
                }}
                style={{ padding: "8px 16px", background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)" }}
              >
                Cancel
              </button>
              <button
                onClick={handleImportSubmit}
                disabled={importMut.isPending}
                style={{ padding: "8px 20px", background: "var(--accent)", color: "white", fontWeight: 600 }}
              >
                {importMut.isPending ? "Importing..." : "Confirm Import"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
