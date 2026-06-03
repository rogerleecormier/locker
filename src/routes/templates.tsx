import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo, useEffect, useRef } from "react";
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
  search?: string; // Governs Lexical Search
  vector?: string; // Governs Semantic Search (Vector DB)
  orm?: string;
  auth?: string;
  styling?: string;
  stateCache?: string;
  componentLibrary?: string;
  bannedProviders?: string[];
};

const CATEGORY_COLORS: Record<string, string> = {
  stack: "#a855f7",
  governance: "#22c55e",
  devops: "#3b82f6",
  compliance: "#ef4444",
  documentation: "#f97316",
};

const CATEGORY_LABELS: Record<string, string> = {
  stack: "Stack",
  governance: "Governance",
  devops: "DevOps",
  compliance: "Compliance",
  documentation: "Docs",
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

function VariableChip({ name, desc }: { name: string; desc: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 6px",
        borderRadius: 4,
        fontSize: 10.5,
        background: "var(--tag-bg)",
        border: "1px solid var(--tag-border)",
        color: "var(--text-muted)",
        marginRight: 4,
        marginBottom: 2,
        fontFamily: "monospace",
      }}
      title={desc}
    >
      {name}
    </span>
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

function TemplateRow({
  template,
  selected,
  onToggleSelect,
  onImport,
  onEdit,
  onDelete,
}: {
  template: any;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onImport: (tmpl: any) => void;
  onEdit: (tmpl: any) => void;
  onDelete: (tmpl: any) => void;
}) {
  let payload: ParsedPayload = { rules: [] };
  try {
    payload = JSON.parse(template.configPayload);
  } catch (e) {}

  const rules = payload.rules || [];
  const variables = payload.variables || [];

  return (
    <div
      style={{
        padding: "14px 18px",
        borderBottom: "1px solid var(--border)",
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        gap: "8px 16px",
        alignItems: "start",
        background: selected ? "rgba(168,85,247,0.05)" : undefined,
      }}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggleSelect(template.id)}
        style={{ marginTop: 3, cursor: "pointer", accentColor: "var(--accent)" }}
      />
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
          <span
            onClick={() => onEdit(template)}
            style={{ fontWeight: 700, fontSize: 15, color: "var(--text)", cursor: "pointer", transition: "color 0.15s" }}
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLSpanElement;
              el.style.color = "var(--accent)";
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLSpanElement;
              el.style.color = "var(--text)";
            }}
          >
            {template.name}
          </span>
          {rules.length > 0 && (
            <span style={{
              fontSize: 10,
              fontWeight: 600,
              padding: "1px 6px",
              background: "rgba(59,130,246,0.1)",
              color: "#3b82f6",
              borderRadius: 4,
            }}>
              {rules.length} Rule{rules.length !== 1 ? "s" : ""}
            </span>
          )}
          {variables.length > 0 && (
            <span style={{
              fontSize: 10,
              fontWeight: 600,
              padding: "1px 6px",
              background: "rgba(168,85,247,0.1)",
              color: "var(--accent)",
              borderRadius: 4,
            }}>
              {variables.length} Var{variables.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.5, wordBreak: "break-word" }}>
          {template.description}
        </p>
        {variables.length > 0 && (
          <div style={{ display: "flex", gap: 2, flexWrap: "wrap", marginTop: 8 }}>
            {variables.map((v) => (
              <VariableChip key={v.key} name={v.key} desc={v.description} />
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, minWidth: 110 }}>
        <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <CategoryBadge category={template.category} />
        </div>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {new Date(template.createdAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            onClick={() => onImport(template)}
            style={{
              padding: "3px 8px",
              background: "transparent",
              border: "1px solid transparent",
              color: "var(--text-muted)",
              fontSize: 11,
              borderRadius: "var(--radius)",
              opacity: 0.5,
              transition: "opacity 0.15s, border-color 0.15s, color 0.15s",
            }}
            onMouseEnter={(e) => {
              const b = e.currentTarget as HTMLButtonElement;
              b.style.opacity = "1";
              b.style.borderColor = "rgba(168,85,247,0.4)";
              b.style.color = "var(--accent)";
            }}
            onMouseLeave={(e) => {
              const b = e.currentTarget as HTMLButtonElement;
              b.style.opacity = "0.5";
              b.style.borderColor = "transparent";
              b.style.color = "var(--text-muted)";
            }}
          >
            Import
          </button>
          <button
            onClick={() => onEdit(template)}
            style={{
              padding: "3px 8px",
              background: "transparent",
              border: "1px solid transparent",
              color: "var(--text-muted)",
              fontSize: 11,
              borderRadius: "var(--radius)",
              opacity: 0.5,
              transition: "opacity 0.15s, border-color 0.15s, color 0.15s",
            }}
            onMouseEnter={(e) => {
              const b = e.currentTarget as HTMLButtonElement;
              b.style.opacity = "1";
              b.style.borderColor = "rgba(168,85,247,0.4)";
              b.style.color = "var(--accent)";
            }}
            onMouseLeave={(e) => {
              const b = e.currentTarget as HTMLButtonElement;
              b.style.opacity = "0.5";
              b.style.borderColor = "transparent";
              b.style.color = "var(--text-muted)";
            }}
          >
            Edit
          </button>
          <button
            onClick={() => onDelete(template)}
            style={{
              padding: "3px 8px",
              background: "transparent",
              border: "1px solid transparent",
              color: "var(--text-muted)",
              fontSize: 11,
              borderRadius: "var(--radius)",
              opacity: 0.5,
              transition: "opacity 0.15s, border-color 0.15s, color 0.15s",
            }}
            onMouseEnter={(e) => {
              const b = e.currentTarget as HTMLButtonElement;
              b.style.opacity = "1";
              b.style.borderColor = "rgba(239,68,68,0.4)";
              b.style.color = "var(--error)";
            }}
            onMouseLeave={(e) => {
              const b = e.currentTarget as HTMLButtonElement;
              b.style.opacity = "0.5";
              b.style.borderColor = "transparent";
              b.style.color = "var(--text-muted)";
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function TemplateTable({
  templates,
  activeTab,
  filter,
  sortBy,
  onImport,
  onEdit,
  onDelete,
}: {
  templates: any[];
  activeTab: string;
  filter: string;
  sortBy: 'newest' | 'oldest' | 'alphabetical';
  onImport: (tmpl: any) => void;
  onEdit: (tmpl: any) => void;
  onDelete: (tmpl: any) => void;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkConfirming, setBulkConfirming] = useState(false);

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map(id => deleteMemoryTemplate({ data: { id } })));
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
    let results = templates.filter((t) => {
      const matchesTab = activeTab === "all" || t.category === activeTab;
      const matchesSearch =
        !q ||
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q);
      return matchesTab && matchesSearch;
    });

    if (sortBy === 'newest') {
      results.sort((a, b) => b.createdAt - a.createdAt);
    } else if (sortBy === 'oldest') {
      results.sort((a, b) => a.createdAt - b.createdAt);
    } else if (sortBy === 'alphabetical') {
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
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function handleExport(itemsToExport: any[]) {
    const jsonContent = exportTemplatesToJson(itemsToExport);
    downloadFile(jsonContent, `locker_templates_${new Date().toISOString().split("T")[0]}.json`, "application/json");
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
        {templates.length === 0 ? "No templates stored yet." : "No templates match your filters."}
      </div>
    );
  }

  return (
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
                  Delete {selectedInView.length} template{selectedInView.length !== 1 ? "s" : ""}?
                </span>
                <button
                  onClick={() => bulkDeleteMutation.mutate(selectedInView.map((t) => t.id))}
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
            ) : (
              <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
                <button
                  onClick={() => handleExport(selectedInView)}
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
              {filtered.length} template{filtered.length !== 1 ? "s" : ""}
            </span>
            {filtered.length > 0 && (
              <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
                <button
                  onClick={() => handleExport(filtered)}
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
                  Export All (JSON)
                </button>
              </div>
            )}
          </>
        )}
      </div>

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
  );
}

const STACK_PRESETS = [
  {
    name: "Cloudflare Edge (Best Practice)",
    language: "TypeScript",
    frontend: "React / TanStack",
    hosting: "Cloudflare Edge",
    database: "Cloudflare D1",
    orm: "Drizzle ORM",
    auth: "Better Auth",
    styling: "Tailwind CSS",
    stateCache: "Cloudflare KV",
    storage: "Cloudflare R2",
    search: "None",
    vector: "Cloudflare Vectorize",
    componentLibrary: "shadcn/ui",
  },
  {
    name: "Next.js + Supabase",
    language: "TypeScript",
    frontend: "Next.js",
    hosting: "Vercel",
    database: "Supabase (Postgres)",
    orm: "Drizzle ORM",
    auth: "Supabase Auth",
    styling: "Tailwind CSS",
    stateCache: "Zustand",
    storage: "Supabase Storage",
    search: "None",
    vector: "Supabase Vector",
    componentLibrary: "shadcn/ui",
  },
  {
    name: "T3 Stack",
    language: "TypeScript",
    frontend: "Next.js",
    hosting: "Vercel",
    database: "PostgreSQL",
    orm: "Prisma",
    auth: "Auth.js (NextAuth)",
    styling: "Tailwind CSS",
    stateCache: "Zustand",
    storage: "AWS S3",
    search: "None",
    vector: "Pinecone",
    componentLibrary: "shadcn/ui",
  },
  {
    name: "MERN Stack",
    language: "JavaScript",
    frontend: "React / TanStack",
    hosting: "Render",
    database: "MongoDB",
    orm: "Mongoose",
    auth: "Custom",
    styling: "CSS Modules",
    stateCache: "Redux Toolkit",
    storage: "AWS S3",
    search: "MongoDB Atlas Search",
    vector: "None",
    componentLibrary: "None",
  },
  {
    name: "FastAPI + React",
    language: "Python",
    frontend: "React / TanStack",
    hosting: "Fly.io",
    database: "PostgreSQL",
    orm: "SQLAlchemy",
    auth: "Custom",
    styling: "Tailwind CSS",
    stateCache: "Zustand",
    storage: "AWS S3",
    search: "None",
    vector: "Qdrant",
    componentLibrary: "None",
  }
];

const FIELD_OPTIONS: Record<string, string[]> = {
  language: ["TypeScript", "JavaScript", "Python", "Go", "Rust", "Ruby", "Java", "C#", "C++", "PHP"],
  frontend: ["React / TanStack", "Next.js", "Remix", "Vue / Nuxt", "Svelte / SvelteKit", "Astro", "SolidJS", "Angular", "Node.js / Express", "HTML/JS"],
  hosting: ["Cloudflare Edge", "Vercel", "Netlify", "AWS Lambda", "Fly.io", "Heroku", "Railway", "Render", "Self-Hosted VPS"],
  database: ["Cloudflare D1", "PostgreSQL", "MySQL", "SQLite", "MongoDB", "Redis", "Supabase (Postgres)", "Neon (Postgres)", "PlanetScale", "Prisma Postgres"],
  orm: ["Drizzle ORM", "Prisma", "Mongoose", "TypeORM", "Kysely", "Sequelize", "SQL (Raw)", "None"],
  auth: ["Better Auth", "Auth.js (NextAuth)", "Clerk", "Supabase Auth", "Firebase Auth", "Kinde", "Lucia", "Custom", "None"],
  styling: ["Vanilla CSS", "Tailwind CSS", "Bootstrap", "Material Design", "CSS Modules", "Styled Components", "Sass/SCSS", "Tailwind + CSS Modules"],
  stateCache: ["TanStack Store", "Cloudflare KV", "Zustand", "Redux Toolkit", "Jotai", "Recoil", "React Context", "Pinia", "Vuex", "None"],
  storage: ["Cloudflare R2", "AWS S3", "Supabase Storage", "Vercel Blob", "Firebase Storage", "Local Filesystem", "None"],
  search: ["Fuse.js", "Algolia", "Meilisearch", "Elasticsearch", "None"],
  vector: ["Cloudflare Vectorize", "Pinecone", "pgvector", "Supabase Vector", "Qdrant", "None"],
  componentLibrary: ["shadcn/ui", "MUI (Material UI)", "Chakra UI", "Radix UI", "DaisyUI", "PrimeReact", "None"],
};





function Combobox({
  value,
  onChange,
  options,
  placeholder,
  label,
}: {
  value: string;
  onChange: (val: string) => void;
  options: string[];
  placeholder?: string;
  label?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState(value);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSearch(value);
  }, [value]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        onChange(search);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [search, onChange]);

  const filteredOptions = useMemo(() => {
    const q = search.toLowerCase();
    const isExactMatch = options.some((o) => o.toLowerCase() === q);
    if (!search || isExactMatch) {
      return options;
    }
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [search, options]);

  return (
    <div ref={containerRef} style={{ position: "relative", display: "flex", flexDirection: "column", width: "100%" }}>
      {label && (
        <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", marginBottom: 6, fontWeight: 600 }}>
          {label}
        </label>
      )}
      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            onChange(e.target.value);
            setIsOpen(true);
          }}
          onFocus={(e) => {
            setIsOpen(true);
            e.currentTarget.select();
          }}
          placeholder={placeholder}
          style={{ width: "100%", padding: "8px 12px", paddingRight: "30px" }}
        />
        <button
          type="button"
          onClick={() => {
            setIsOpen(!isOpen);
            if (!isOpen && inputRef.current) {
              inputRef.current.focus();
              inputRef.current.select();
            }
          }}
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            bottom: 0,
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            padding: "0 10px",
            display: "flex",
            alignItems: "center",
            cursor: "pointer",
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>
            <path d="m6 9 6 6 6-6"/>
          </svg>
        </button>
      </div>

      {isOpen && (
        <div style={{
          position: "absolute",
          top: "100%",
          left: 0,
          right: 0,
          marginTop: 4,
          background: "var(--surface2)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          maxHeight: 180,
          overflowY: "auto",
          zIndex: 1000,
          boxShadow: "0 10px 20px rgba(0,0,0,0.4)",
        }}>
          {filteredOptions.length > 0 ? (
            filteredOptions.map((opt) => (
              <div
                key={opt}
                onClick={() => {
                  onChange(opt);
                  setSearch(opt);
                  setIsOpen(false);
                }}
                style={{
                  padding: "8px 12px",
                  cursor: "pointer",
                  fontSize: 12.5,
                  color: value === opt ? "var(--accent)" : "var(--text)",
                  background: value === opt ? "rgba(168,85,247,0.08)" : "transparent",
                  textAlign: "left",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--accent-dim)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = value === opt ? "rgba(168,85,247,0.08)" : "transparent";
                }}
              >
                {opt}
              </div>
            ))
          ) : (
            <div style={{ padding: "8px 12px", fontSize: 12.5, color: "var(--text-muted)", fontStyle: "italic", textAlign: "left" }}>
              Custom value
            </div>
          )}
        </div>
      )}
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
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'alphabetical'>('newest');

  // Form State
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(1);
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
  const [stackSearch, setStackSearch] = useState("None");
  const [stackVector, setStackVector] = useState("Cloudflare Vectorize");
  const [stackOrm, setStackOrm] = useState("Drizzle ORM");
  const [stackAuth, setStackAuth] = useState("Better Auth");
  const [stackStyling, setStackStyling] = useState("Tailwind CSS");
  const [stackStateCache, setStackStateCache] = useState("TanStack Store");
  const [stackComponentLibrary, setStackComponentLibrary] = useState("None");
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
    setCurrentStep(1);
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
    setStackSearch("None");
    setStackVector("Cloudflare Vectorize");
    setStackOrm("Drizzle ORM");
    setStackAuth("Better Auth");
    setStackStyling("Tailwind CSS");
    setStackStateCache("TanStack Store");
    setStackComponentLibrary("None");
    setStackBanned([]);
  };

  const handleEdit = (tmpl: any) => {
    setEditingTemplate(tmpl);
    setCurrentStep(1);
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
      setStackSearch(payload.search || "None");
      setStackVector(payload.vector || "None");
      setStackOrm(payload.orm || "Drizzle ORM");
      setStackAuth(payload.auth || "Better Auth");
      setStackStyling(payload.styling || "Tailwind CSS");
      setStackStateCache(payload.stateCache || "TanStack Store");
      setStackComponentLibrary(payload.componentLibrary || "None");
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
      payload.vector = stackVector;
      payload.orm = stackOrm;
      payload.auth = stackAuth;
      payload.styling = stackStyling;
      payload.stateCache = stackStateCache;
      payload.componentLibrary = stackComponentLibrary;
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

  const getDynamicFieldOptions = (field: string, lang: string): string[] => {
    const langLower = lang.toLowerCase();
    
    if (field === "frontend") {
      if (langLower === "typescript" || langLower === "javascript") {
        return ["React / TanStack", "Next.js", "Remix", "Vue / Nuxt", "Svelte / SvelteKit", "Astro", "SolidJS", "Angular", "Node.js / Express", "HTML/JS", "None"];
      }
      if (langLower === "python") {
        return ["Django", "FastAPI", "Flask", "MkDocs", "Streamlit", "None"];
      }
      if (langLower === "go") {
        return ["Gin", "Echo", "Fiber", "Hugo", "Go Standard HTTP", "None"];
      }
      if (langLower === "rust") {
        return ["Actix-web", "Axum", "Rocket", "None"];
      }
      if (langLower === "ruby") {
        return ["Ruby on Rails", "Sinatra", "Jekyll", "None"];
      }
      if (langLower === "java") {
        return ["Spring Boot", "Quarkus", "None"];
      }
      if (langLower === "c#") {
        return ["ASP.NET Core", "None"];
      }
      if (langLower === "php") {
        return ["Laravel", "Symfony", "WordPress", "None"];
      }
      return ["React / TanStack", "Next.js", "Django", "FastAPI", "Gin", "Laravel", "Ruby on Rails", "Spring Boot", "ASP.NET Core", "Actix-web", "None"];
    }

    if (field === "orm") {
      if (langLower === "typescript" || langLower === "javascript") {
        return ["Drizzle ORM", "Prisma", "Mongoose", "TypeORM", "Kysely", "Sequelize", "SQL (Raw)", "None"];
      }
      if (langLower === "python") {
        return ["SQLAlchemy", "SQLModel", "Django ORM", "Tortoise ORM", "PyMongo", "SQL (Raw)", "None"];
      }
      if (langLower === "go") {
        return ["GORM", "Ent", "SQLX", "SQL (Raw)", "None"];
      }
      if (langLower === "rust") {
        return ["Diesel", "SQLx", "None"];
      }
      if (langLower === "ruby") {
        return ["Active Record", "Sequel", "None"];
      }
      if (langLower === "java") {
        return ["Hibernate (JPA)", "None"];
      }
      if (langLower === "c#") {
        return ["Entity Framework Core", "None"];
      }
      if (langLower === "php") {
        return ["Eloquent", "Doctrine", "None"];
      }
      return ["Drizzle ORM", "SQLAlchemy", "GORM", "Active Record", "Entity Framework Core", "SQL (Raw)", "None"];
    }

    if (field === "auth") {
      if (langLower === "typescript" || langLower === "javascript") {
        return ["Better Auth", "Auth.js (NextAuth)", "Clerk", "Supabase Auth", "Firebase Auth", "Kinde", "Lucia", "Custom", "None"];
      }
      if (langLower === "python") {
        return ["FastAPI Users", "Django Auth", "Clerk", "Supabase Auth", "Firebase Auth", "Auth0", "Custom", "None"];
      }
      if (langLower === "go" || langLower === "rust") {
        return ["Clerk", "Auth0", "Supabase Auth", "Firebase Auth", "Custom", "None"];
      }
      return ["Better Auth", "Auth.js (NextAuth)", "Clerk", "Supabase Auth", "Firebase Auth", "Custom", "None"];
    }

    if (field === "statecache") {
      if (langLower === "typescript" || langLower === "javascript") {
        return ["TanStack Store", "Cloudflare KV", "Zustand", "Redux Toolkit", "Jotai", "Recoil", "React Context", "Pinia", "Vuex", "None"];
      }
      return ["Cloudflare KV", "Redis Cache", "Memcached", "None"];
    }

    if (field === "hosting") {
      if (langLower === "typescript" || langLower === "javascript") {
        return ["Cloudflare Edge", "Vercel", "Netlify", "AWS Lambda", "Fly.io", "Heroku", "Railway", "Render", "Self-Hosted VPS"];
      }
      return ["AWS Lambda", "Google Cloud Run", "Fly.io", "Cloudflare Edge", "Vercel", "Heroku", "Railway", "Render", "Self-Hosted VPS"];
    }

    return FIELD_OPTIONS[field] || [];
  };

  const addRuleFromPreset = (presetText: string) => {
    setFormRules((prev) => {
      const filtered = prev.filter((r) => r.trim() !== "");
      return [...filtered, presetText];
    });
  };

  const getDynamicRulePresets = () => {
    if (formCategory === "devops") {
      return [
        {
          category: "CI/CD & Runners",
          rules: [
            "Ensure all CI tests, typechecks, and linters pass before code is merged.",
            "Use GitHub Actions runner caching for npm/yarn package managers to speed up builds.",
            "Configure Docker runner caching to reuse intermediate layer caches.",
            "Verify build artifacts (e.g. static HTML, production bundle) on runner machines before deployment."
          ]
        },
        {
          category: "Testing & Validation",
          rules: [
            "Run unit tests on every pull request push.",
            "Enforce 100% build verification in testing runners.",
            "Include E2E integration test runs (e.g. Playwright) for staging environment workflows.",
            "Enforce code coverage thresholds (e.g., minimum 80% coverage) on new pull requests."
          ]
        },
        {
          category: "Build & Code Quality",
          rules: [
            "Enforce code formatting verification in runners (e.g. prettier --check).",
            "Run static analysis tools (e.g. ESLint, SonarQube) in testing pipelines.",
            "Use Husky or pre-commit hooks to run linters and tests locally before push."
          ]
        },
        {
          category: "Environments & Secrets",
          rules: [
            "Never commit secrets or keys to git; inject them as runner secrets.",
            "Use infrastructure-as-code linting (e.g. terraform fmt) on runner workflows."
          ]
        }
      ];
    }

    if (formCategory === "governance") {
      return [
        {
          category: "Branching & Git",
          rules: [
            "Follow branching naming conventions: feature/, bugfix/, hotfix/, or docs/ prefix.",
            "Always require squash-merge for pull requests to maintain a linear commit history.",
            "Enforce Conventional Commits styling (e.g., feat:, fix:, chore:, docs:)."
          ]
        },
        {
          category: "Code Review & PRs",
          rules: [
            "Require at least one peer approval before merging pull requests.",
            "Verify that PR descriptions link to the relevant issue or ticket.",
            "Ensure no debug logs (console.log, debugger) are left in production-bound files."
          ]
        }
      ];
    }

    if (formCategory === "compliance") {
      return [
        {
          category: "Data Privacy & GDPR",
          rules: [
            "Mask or sanitize PII (Personally Identifiable Information) in application logs.",
            "Implement right-to-be-forgotten deletion cascades for user profiles.",
            "Store passwords only as salted hashes using secure algorithms (Argon2id or bcrypt)."
          ]
        },
        {
          category: "Security Checks",
          rules: [
            "Enforce HTTPS/TLS 1.3 for all client communication.",
            "Scan dependencies regularly for vulnerabilities using npm audit or Snyk."
          ]
        }
      ];
    }

    if (formCategory === "documentation") {
      return [
        {
          category: "Standards",
          rules: [
            "Document all public functions, modules, and API routes with JSDoc comments.",
            "Maintain an up-to-date README.md with clear installation and configuration guidelines.",
            "Keep documentation of all system architecture choices and ADRs in a /docs folder."
          ]
        },
        {
          category: "APIs & Errors",
          rules: [
            "Verify that API changes update the corresponding OpenAPI / Swagger schema.",
            "Document all custom error codes, their causes, and suggested user recovery paths."
          ]
        }
      ];
    }

    if (formCategory !== "stack") {
      return [];
    }

    const sections: Array<{ category: string; rules: string[] }> = [];

    // Language & Coding Standards
    const standards = [
      "Prefer const over let, and never use var.",
      "Use async/await instead of .then() chains for promise handling."
    ];
    const langLower = stackLanguage.toLowerCase();
    if (langLower === "typescript") {
      standards.unshift("Always use TypeScript strict mode with strictNullChecks enabled.");
      standards.push("Enforce strict compilation checks using tsc --noEmit in CI pipelines.");
      standards.push("Avoid using 'any' types; define explicit interfaces or use 'unknown'.");
    } else if (langLower === "python") {
      standards.unshift("Enforce Python PEP 8 style guide compliance.");
      standards.push("Use static type checker (e.g., mypy --strict) on CI runners.");
      standards.push("Use ruff for linting and code formatting in development workflows.");
    } else if (langLower === "go") {
      standards.unshift("Verify code formatting with go fmt / goimports before commits.");
      standards.push("Run golangci-lint in CI pipeline to detect issues.");
      standards.push("Ensure goroutines handle panics and defer resource cleanup properly.");
    } else if (langLower === "rust") {
      standards.unshift("Enforce clippy checks (cargo clippy) and rustfmt formatting in CI.");
      standards.push("Minimize usage of unsafe blocks; thoroughly document any unsafe code.");
    }
    sections.push({ category: "Language & Coding Standards", rules: standards });

    // Database & ORM
    const dbRules: string[] = [];
    const dbLower = stackDatabase.toLowerCase();
    const ormLower = stackOrm.toLowerCase();

    if (dbLower.includes("d1")) {
      dbRules.push("Use wrangler migrations to update D1 schema; do not modify D1 schema directly.");
    } else if (dbLower.includes("postgres") || dbLower.includes("supabase") || dbLower.includes("neon")) {
      dbRules.push("Enforce database connection pooling (e.g. Supabase Connection Pooler) for serverless routines.");
    }

    if (ormLower.includes("drizzle")) {
      dbRules.push("Run drizzle-kit generate to output migration SQL files and commit them to git.");
      if (dbLower.includes("d1")) {
        dbRules.push("Verify database changes on a local dev D1 sqlite binding before applying migrations.");
      } else {
        dbRules.push("Run drizzle-kit migrate in the CI pipeline to run migrations on deployment.");
      }
    } else if (ormLower.includes("prisma")) {
      dbRules.push("Run prisma format on save and verify prisma schema in CI pipelines.");
      dbRules.push("Enforce prisma schema verification using prisma db pull/push safety checks.");
    }
    if (dbRules.length > 0) {
      sections.push({ category: "Database & ORM Guidelines", rules: dbRules });
    }

    // Hosting
    const hostingRules: string[] = [];
    const hostLower = stackHosting.toLowerCase();
    if (hostLower.includes("edge") || hostLower.includes("cloudflare")) {
      hostingRules.push("Ensure code complies with V8 Worker isolate constraints (e.g. no Node.js fs module in Edge runtime).");
      hostingRules.push("Keep worker bundle size under Cloudflare's platform limits (1MB for free, 10MB for paid).");
    } else if (hostLower.includes("vercel")) {
      hostingRules.push("Configure Vercel functions execution limits and maxDuration configurations appropriately.");
    }
    if (hostingRules.length > 0) {
      sections.push({ category: "Runtime & Deployment Constraints", rules: hostingRules });
    }

    // Auth
    const authRules: string[] = [];
    const authLower = stackAuth.toLowerCase();
    if (authLower.includes("better")) {
      authRules.push("Configure CORS and trusted origins strictly for Better Auth client endpoints.");
      authRules.push("Implement secure session cookie options (HttpOnly, Secure, SameSite=Lax).");
    } else if (authLower.includes("clerk")) {
      authRules.push("Verify Clerk webhooks signature strictly using svix verification helper.");
    } else if (authLower.includes("supabase")) {
      authRules.push("Enforce Row Level Security (RLS) policies on all tables in Supabase Postgres.");
    }
    if (authRules.length > 0) {
      sections.push({ category: "Authentication Standards", rules: authRules });
    }

    // Styling & UI
    const uiRules: string[] = [];
    const stylingLower = stackStyling.toLowerCase();
    const frontLower = stackFrontend.toLowerCase();
    if (stylingLower.includes("tailwind")) {
      uiRules.push("Use utility classes for layout and structure; keep custom CSS classes to a minimum.");
    }
    if (frontLower.includes("react")) {
      uiRules.push("Optimize rendering performance; minimize re-renders and use memoization where appropriate.");
      uiRules.push("Use key prop properly on collections; avoid using index as key.");
    }
    if (uiRules.length > 0) {
      sections.push({ category: "UI & Frontend Guidelines", rules: uiRules });
    }

    // Storage
    const storageRules: string[] = [];
    const storageLower = stackStorage.toLowerCase();
    if (storageLower.includes("r2") || storageLower.includes("s3")) {
      storageRules.push("Enforce private access on buckets; only expose media through signed URLs or proxy workers.");
      storageRules.push("Implement multipart uploads for objects larger than 100MB to ensure transfer stability.");
    }
    if (storageRules.length > 0) {
      sections.push({ category: "Cloud Storage Policies", rules: storageRules });
    }

    // State, Cache & Search / Vector Databases
    const searchRules: string[] = [];
    const searchLower = stackSearch.toLowerCase();
    const vectorLower = stackVector.toLowerCase();
    const cacheLower = stackStateCache.toLowerCase();
    
    if (searchLower.includes("algolia")) {
      searchRules.push("Validate Algolia search index configuration and optimize searchableAttributes.");
    } else if (searchLower.includes("meilisearch")) {
      searchRules.push("Secure Meilisearch instance with restricted read-only query keys for client routes.");
    } else if (searchLower.includes("fuse.js")) {
      searchRules.push("Initialize Fuse.js index on static client collections; restrict key search bounds.");
    }
    
    if (vectorLower.includes("vectorize")) {
      searchRules.push("Limit embeddings dimensions to match Vectorize configuration (e.g. 1536 for openai-text-embedding-3).");
    } else if (vectorLower.includes("pinecone")) {
      searchRules.push("Configure Pinecone namespace separation for multi-tenant data storage partitions.");
    }
    
    if (cacheLower.includes("kv")) {
      searchRules.push("Cache assets with strict TTL; enforce key namespace isolation (e.g. namespace:userid:key).");
      searchRules.push("Be mindful of KV eventual consistency; do not write/read synchronously expecting instant updates.");
    }
    
    if (searchRules.length > 0) {
      searchRules.push("Enable hybrid search algorithms (lexical keyword ranking + dense vector cosine similarity) where appropriate.");
      sections.push({ category: "Search & Cache Systems", rules: searchRules });
    }

    return sections;
  };

  const addVariableFromPreset = (preset: { key: string; description: string; default: string }) => {
    setFormVariables((prev) => {
      if (prev.some((v) => v.key === preset.key)) {
        return prev;
      }
      return [...prev, { ...preset }];
    });
  };

  const getDynamicVariablePresets = () => {
    if (formCategory === "devops") {
      return [
        { key: "DEPLOY_ENVIRONMENT", description: "Target deployment environment.", default: "production" },
        { key: "CI_REGISTRY", description: "Docker/container registry URL.", default: "ghcr.io" },
        { key: "AWS_REGION", description: "Target AWS region for infrastructure.", default: "us-east-1" },
        { key: "KUBE_NAMESPACE", description: "Target Kubernetes namespace.", default: "production" },
        { key: "SLACK_WEBHOOK_URL", description: "Slack webhook URL for deployment alerts.", default: "" }
      ];
    }
    
    if (formCategory !== "stack") {
      return [];
    }

    const list = [
      { key: "PROJECT_NAME", description: "Base name of the repository/project.", default: "my-app" }
    ];

    if (stackDatabase.toLowerCase().includes("d1")) {
      list.push({ key: "D1_DATABASE_BINDING", description: "Cloudflare D1 Database binding name.", default: "DB" });
    } else if (stackDatabase.toLowerCase().includes("postgres") || stackDatabase.toLowerCase().includes("mysql") || stackDatabase.toLowerCase().includes("supabase") || stackDatabase.toLowerCase().includes("neon")) {
      list.push({ key: "DATABASE_URL", description: "Database connection string URL.", default: "postgresql://localhost:5432/db" });
    } else if (stackDatabase.toLowerCase().includes("sqlite")) {
      list.push({ key: "SQLITE_DB_PATH", description: "Local SQLite database file path.", default: "./local.db" });
    } else if (stackDatabase.toLowerCase().includes("mongodb")) {
      list.push({ key: "MONGODB_URI", description: "MongoDB Connection URI.", default: "mongodb://localhost:27017/app" });
    }

    if (stackStorage.toLowerCase().includes("r2")) {
      list.push({ key: "R2_BUCKET_BINDING", description: "Cloudflare R2 Bucket binding name.", default: "BUCKET" });
    } else if (stackStorage.toLowerCase().includes("s3")) {
      list.push({ key: "AWS_S3_BUCKET", description: "Amazon S3 Bucket name.", default: "my-production-bucket" });
      list.push({ key: "AWS_REGION", description: "AWS Region for S3 Bucket.", default: "us-east-1" });
    } else if (stackStorage.toLowerCase().includes("blob")) {
      list.push({ key: "BLOB_READ_WRITE_TOKEN", description: "Vercel Blob read/write access token.", default: "" });
    }

    if (stackAuth.toLowerCase().includes("better")) {
      list.push({ key: "BETTER_AUTH_SECRET", description: "Secret token for Better Auth signing.", default: "" });
      list.push({ key: "BETTER_AUTH_URL", description: "Base URL of the authentication server.", default: "http://localhost:3000" });
    } else if (stackAuth.toLowerCase().includes("clerk")) {
      list.push({ key: "CLERK_PUBLISHABLE_KEY", description: "Clerk publishable API key.", default: "" });
      list.push({ key: "CLERK_SECRET_KEY", description: "Clerk secret API key.", default: "" });
    } else if (stackAuth.toLowerCase().includes("nextauth") || stackAuth.toLowerCase().includes("auth.js")) {
      list.push({ key: "NEXTAUTH_SECRET", description: "Auth.js (NextAuth) JWT encryption secret.", default: "" });
    }

    if (stackVector.toLowerCase().includes("vectorize")) {
      list.push({ key: "VECTORIZE_INDEX_BINDING", description: "Cloudflare Vectorize index binding name.", default: "VECTOR_INDEX" });
    } else if (stackVector.toLowerCase().includes("pinecone")) {
      list.push({ key: "PINECONE_API_KEY", description: "Pinecone Vector database API key.", default: "" });
      list.push({ key: "PINECONE_ENVIRONMENT", description: "Pinecone index environment.", default: "us-east-1" });
    } else if (stackVector.toLowerCase().includes("qdrant")) {
      list.push({ key: "QDRANT_URL", description: "Qdrant vector search server URL.", default: "http://localhost:6333" });
    }

    if (stackSearch.toLowerCase().includes("algolia")) {
      list.push({ key: "ALGOLIA_APP_ID", description: "Algolia application ID key.", default: "" });
      list.push({ key: "ALGOLIA_API_KEY", description: "Algolia admin/write API key.", default: "" });
    }

    if (stackStateCache.toLowerCase().includes("kv")) {
      list.push({ key: "KV_NAMESPACE_BINDING", description: "Cloudflare KV namespace binding name.", default: "KV" });
    }

    if (list.length === 1) {
      list.push({ key: "API_URL", description: "API Backend Server URL endpoint.", default: "http://localhost:3000/api" });
    }

    return list;
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
  };

  const totalByCategory = useMemo(() => {
    const counts: Record<string, number> = { stack: 0, governance: 0, devops: 0, compliance: 0, documentation: 0 };
    for (const t of templates) {
      if (counts[t.category] !== undefined) {
        counts[t.category]++;
      }
    }
    return counts;
  }, [templates]);

  return (
    <div>
      {/* Page header bar */}
      <div style={{ background: "var(--surface2)", borderBottom: "1px solid var(--border)", padding: "20px 24px" }}>
        <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              </svg>
              <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>Memory Templates</h1>
              <span style={{ fontSize: 11, background: "var(--accent-dim)", color: "var(--accent)", border: "1px solid rgba(168,85,247,0.3)", borderRadius: 20, padding: "2px 8px", fontWeight: 600 }}>
                {templates.length} templates
              </span>
            </div>
            <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0 }}>
              Create, customize, and instantiate guideline blueprints into your locker vaults.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
            <button
              onClick={() => {
                resetForm();
                setShowCreateModal(true);
              }}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 16px", background: "var(--accent)", color: "#fff", fontWeight: 600, fontSize: 13, borderRadius: "var(--radius)" }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              New Template
            </button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "28px 24px" }}>
        
        {/* Stats grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12, marginBottom: 28 }}>
          {[
            { label: "Total", value: templates.length, color: "var(--text)" },
            { label: "Stacks", value: totalByCategory.stack, color: CATEGORY_COLORS.stack },
            { label: "Governance", value: totalByCategory.governance, color: CATEGORY_COLORS.governance },
            { label: "DevOps", value: totalByCategory.devops, color: CATEGORY_COLORS.devops },
            { label: "Compliance", value: totalByCategory.compliance, color: CATEGORY_COLORS.compliance },
            { label: "Docs", value: totalByCategory.documentation, color: CATEGORY_COLORS.documentation },
          ].map(({ label, value, color }) => (
            <div
              key={label}
              style={{
                background: "linear-gradient(135deg, rgba(168,85,247,0.03) 0%, rgba(139,92,246,0.01) 100%)",
                border: "1px solid rgba(168,85,247,0.12)",
                borderRadius: 12,
                padding: "16px 18px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, fontWeight: 600 }}>
                {label}
              </div>
              <div style={{ fontSize: 32, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Tabs switcher */}
        <div className="no-scrollbar" style={{ marginBottom: 20, display: "flex", gap: 2, borderBottom: "1px solid var(--border)", alignItems: "flex-end", overflowX: "auto" }}>
          {(["all", "stack", "governance", "devops", "compliance", "documentation"] as const).map((tab) => {
            const isActive = activeTab === tab;
            const count = tab === "all" ? templates.length : templates.filter((t) => t.category === tab).length;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: "8px 16px",
                  background: isActive ? "var(--surface)" : "transparent",
                  border: "none",
                  borderTop: isActive ? "3px solid var(--accent)" : "3px solid transparent",
                  borderLeft: isActive ? "1px solid var(--border)" : "1px solid transparent",
                  borderRight: isActive ? "1px solid var(--border)" : "1px solid transparent",
                  borderBottom: isActive ? "1px solid var(--surface)" : "none",
                  color: isActive ? "var(--text)" : "var(--text-muted)",
                  fontSize: 13,
                  fontWeight: isActive ? 600 : 400,
                  cursor: "pointer",
                  marginBottom: -1,
                  borderRadius: "4px 4px 0 0",
                  textTransform: "capitalize",
                  whiteSpace: "nowrap",
                }}
              >
                {tab === "all" ? "All Templates" : tab} {count > 0 && <span style={{ marginLeft: 4, fontSize: 11, opacity: 0.7 }}>({count})</span>}
              </button>
            );
          })}
        </div>

        {/* Filter / Search Bar */}
        <div style={{ marginBottom: 14, display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ position: "relative", flex: 1 }}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--text-muted)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search templates by name, description, or keyword…"
              style={{ width: "100%", padding: "8px 12px 8px 32px" }}
            />
          </div>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'newest' | 'oldest' | 'alphabetical')}
            style={{ padding: "8px 12px", minWidth: 140 }}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="alphabetical">Alphabetical</option>
          </select>

          {(filter || sortBy !== 'newest') && (
            <button
              onClick={() => { setFilter(""); setSortBy('newest'); }}
              style={{
                padding: "8px 12px",
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                color: "var(--text-muted)",
                fontSize: 12,
              }}
            >
              Clear all
            </button>
          )}
        </div>

        {isLoading ? (
          <div style={{ padding: "40px 0", textAlign: "center", color: "var(--text-muted)" }}>Loading templates...</div>
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

      </div>

      {/* CREATE/EDIT MODAL */}
      {(showCreateModal || editingTemplate) && (() => {
        const hasVariables = formCategory === "stack" || formCategory === "devops";
        const stepsList = [
          { id: 1, label: "Info" },
          ...(formCategory === "stack" ? [{ id: 2, label: "Stack" }] : []),
          { id: 3, label: "Rules" },
          ...(hasVariables ? [{ id: 4, label: "Variables" }] : [])
        ];

        const isLast = hasVariables ? currentStep === 4 : currentStep === 3;

        const handleNext = () => {
          if (currentStep === 1) {
            setCurrentStep(formCategory === "stack" ? 2 : 3);
          } else if (currentStep === 2) {
            setCurrentStep(3);
          } else if (currentStep === 3) {
            if (hasVariables) {
              setCurrentStep(4);
            }
          }
        };

        const handleBack = () => {
          if (currentStep === 4) {
            setCurrentStep(3);
          } else if (currentStep === 3) {
            setCurrentStep(formCategory === "stack" ? 2 : 1);
          } else if (currentStep === 2) {
            setCurrentStep(1);
          }
        };

        return (
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
              maxWidth: currentStep >= 3 ? 840 : 680,
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 24px 48px rgba(0,0,0,0.5)",
              transition: "max-width 0.2s ease-in-out",
            }}>
              {/* Modal Header */}
              <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 700, fontSize: 16 }}>
                  {editingTemplate ? "Edit Template" : "New Memory Template"}
                </span>
                <button onClick={() => {
                  setShowCreateModal(false);
                  setEditingTemplate(null);
                  resetForm();
                }} style={{ background: "none", color: "var(--text-muted)", fontSize: 20 }}>×</button>
              </div>

              {/* Progress Indicator */}
              <div style={{ padding: "20px 24px 0 24px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 10px" }}>
                  {stepsList.map((s, index) => {
                    const isCompleted = currentStep > s.id;
                    const isActive = currentStep === s.id;
                    return (
                      <div key={s.id} style={{ display: "flex", alignItems: "center", flex: index < stepsList.length - 1 ? 1 : "initial" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <button
                            type="button"
                            disabled={!formName.trim() && s.id !== 1}
                            onClick={() => {
                              if (formName.trim()) {
                                setCurrentStep(s.id as 1 | 2 | 3 | 4);
                              }
                            }}
                            style={{
                              width: 24,
                              height: 24,
                              borderRadius: "50%",
                              background: isActive ? "var(--accent)" : isCompleted ? "var(--success)" : "var(--surface2)",
                              border: `1px solid ${isActive ? "var(--accent)" : isCompleted ? "var(--success)" : "var(--border)"}`,
                              color: isActive || isCompleted ? "#fff" : "var(--text-muted)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 11,
                              fontWeight: 600,
                              cursor: "pointer",
                              padding: 0,
                            }}
                          >
                            {isCompleted ? "✓" : index + 1}
                          </button>
                          <span style={{ fontSize: 12, fontWeight: isActive ? 600 : 400, color: isActive ? "var(--text)" : "var(--text-muted)" }}>
                            {s.label}
                          </span>
                        </div>
                        {index < stepsList.length - 1 && (
                          <div style={{
                            flex: 1,
                            height: 2,
                            background: isCompleted ? "var(--success)" : "var(--border)",
                            margin: "0 16px",
                            minWidth: 20,
                          }} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Modal Body */}
              <div style={{ padding: 24, overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
                
                {/* STEP 1: General Info */}
                {currentStep === 1 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
                          onChange={(e) => {
                            setFormCategory(e.target.value as TemplateCategory);
                          }}
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
                        style={{ width: "100%", padding: "8px 12px", minHeight: 80, resize: "vertical" }}
                      />
                    </div>
                  </div>
                )}

                {/* STEP 2: Stack Settings */}
                {currentStep === 2 && formCategory === "stack" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    {/* Stack Quick Load Presets */}
                    <div style={{ background: "rgba(168,85,247,0.03)", border: "1px solid rgba(168,85,247,0.12)", borderRadius: "var(--radius)", padding: 14 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", display: "block", marginBottom: 8 }}>Quick Load Stack Presets</span>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {STACK_PRESETS.map((preset) => (
                          <button
                            key={preset.name}
                            type="button"
                            onClick={() => {
                              setStackLanguage(preset.language);
                              setStackFrontend(preset.frontend);
                              setStackHosting(preset.hosting);
                              setStackDatabase(preset.database);
                              setStackOrm(preset.orm);
                              setStackAuth(preset.auth);
                              setStackStyling(preset.styling);
                              setStackSearch(preset.search);
                              setStackVector(preset.vector || "None");
                              setStackStorage(preset.storage);
                              setStackSearch(preset.search);
                              setStackComponentLibrary(preset.componentLibrary || "None");
                            }}
                            style={{
                              padding: "6px 12px",
                              background: "var(--tag-bg)",
                              border: "1px solid var(--tag-border)",
                              color: "var(--text)",
                              fontSize: 11.5,
                              fontWeight: 600,
                              borderRadius: 6,
                              cursor: "pointer",
                              transition: "all 0.15s",
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.borderColor = "var(--accent)";
                              e.currentTarget.style.background = "var(--accent-dim)";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.borderColor = "var(--tag-border)";
                              e.currentTarget.style.background = "var(--tag-bg)";
                            }}
                          >
                            {preset.name}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Stack Fields */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, paddingBottom: 140 }}>
                      {/* Column 1: Frontend & Client Stack */}
                      <div style={{
                        background: "var(--surface2)",
                        border: "1px solid var(--border)",
                        borderRadius: "12px",
                        padding: 16,
                        display: "flex",
                        flexDirection: "column",
                        gap: 12
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid var(--border)", paddingBottom: 8, marginBottom: 4 }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect width="18" height="18" x="3" y="3" rx="2" />
                            <path d="M7 8h10M7 12h10M7 16h6" />
                          </svg>
                          <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text)" }}>Frontend & Client Stack</span>
                        </div>
                        <Combobox label="Language" value={stackLanguage} onChange={setStackLanguage} options={FIELD_OPTIONS.language} placeholder="e.g. TypeScript" />
                        <Combobox label="Frontend Framework" value={stackFrontend} onChange={setStackFrontend} options={getDynamicFieldOptions("frontend", stackLanguage)} placeholder="e.g. Next.js" />
                        <Combobox label="Styling" value={stackStyling} onChange={setStackStyling} options={FIELD_OPTIONS.styling} placeholder="e.g. Vanilla CSS" />
                        <Combobox label="Component Library" value={stackComponentLibrary} onChange={setStackComponentLibrary} options={FIELD_OPTIONS.componentLibrary} placeholder="e.g. shadcn/ui" />
                        <Combobox label="Auth" value={stackAuth} onChange={setStackAuth} options={getDynamicFieldOptions("auth", stackLanguage)} placeholder="e.g. Better Auth" />
                        <Combobox label="State / Client Cache" value={stackStateCache} onChange={setStackStateCache} options={getDynamicFieldOptions("statecache", stackLanguage)} placeholder="e.g. Zustand" />
                        <Combobox label="Full-Text Search (Lexical)" value={stackSearch} onChange={setStackSearch} options={FIELD_OPTIONS.search} placeholder="e.g. Fuse.js" />
                      </div>

                      {/* Column 2: Backend & Infrastructure */}
                      <div style={{
                        background: "var(--surface2)",
                        border: "1px solid var(--border)",
                        borderRadius: "12px",
                        padding: 16,
                        display: "flex",
                        flexDirection: "column",
                        gap: 12
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid var(--border)", paddingBottom: 8, marginBottom: 4 }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <ellipse cx="12" cy="5" rx="9" ry="3" />
                            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                            <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" />
                          </svg>
                          <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text)" }}>Backend & Infrastructure</span>
                        </div>
                        <Combobox label="Hosting Runtime" value={stackHosting} onChange={setStackHosting} options={getDynamicFieldOptions("hosting", stackLanguage)} placeholder="e.g. Cloudflare Pages" />
                        <Combobox label="Database" value={stackDatabase} onChange={setStackDatabase} options={FIELD_OPTIONS.database} placeholder="e.g. Cloudflare D1" />
                        <Combobox label="ORM / DB Client" value={stackOrm} onChange={setStackOrm} options={getDynamicFieldOptions("orm", stackLanguage)} placeholder="e.g. Drizzle ORM" />
                        <Combobox label="Storage (Buckets)" value={stackStorage} onChange={setStackStorage} options={FIELD_OPTIONS.storage} placeholder="e.g. Cloudflare R2" />
                        <Combobox label="Vector Database (Semantic)" value={stackVector} onChange={setStackVector} options={FIELD_OPTIONS.vector} placeholder="e.g. Cloudflare Vectorize" />
                      </div>
                    </div>
                  </div>
                )}

                {/* STEP 3: Guidelines & Rules */}
                {currentStep === 3 && (
                  <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 20 }}>
                    {/* Left Column: Rules Builder */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <label style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>Guidelines / Rules</label>
                        <button onClick={() => setFormRules([...formRules, ""])} style={{ padding: "4px 10px", background: "var(--border)", color: "var(--text)", fontSize: 11.5, display: "flex", alignItems: "center", gap: 4 }}>
                          <span>＋</span> Add Rule
                        </button>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: "40vh", overflowY: "auto", paddingRight: 4 }}>
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
                              placeholder="Define a constraint rule (you can inject variables like {{MY_VAR}})..."
                              style={{ flex: 1, padding: "6px 10px" }}
                            />
                            {formRules.length > 1 && (
                              <button
                                onClick={() => setFormRules(formRules.filter((_, i) => i !== idx))}
                                style={{ padding: "0 10px", background: "rgba(239,68,68,0.1)", color: "var(--error)", border: "1px solid rgba(239,68,68,0.2)" }}
                              >
                                ×
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Right Column: Key Rule Presets */}
                    <div style={{ borderLeft: "1px solid var(--border)", paddingLeft: 20, display: "flex", flexDirection: "column", gap: 12 }}>
                      <label style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>Rule Presets</label>
                      <div style={{ maxHeight: "40vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, paddingRight: 4 }}>
                        {getDynamicRulePresets().map((group) => (
                          <div key={group.category}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", display: "block", marginBottom: 6 }}>{group.category}</span>
                            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                              {group.rules.map((ruleText) => {
                                const isAdded = formRules.includes(ruleText);
                                return (
                                  <div
                                    key={ruleText}
                                    onClick={() => !isAdded && addRuleFromPreset(ruleText)}
                                    style={{
                                      padding: "6px 10px",
                                      background: isAdded ? "rgba(34,197,94,0.06)" : "var(--surface2)",
                                      border: `1px solid ${isAdded ? "rgba(34,197,94,0.2)" : "var(--border)"}`,
                                      borderRadius: 6,
                                      fontSize: 11,
                                      color: isAdded ? "var(--success)" : "var(--text)",
                                      cursor: isAdded ? "default" : "pointer",
                                      transition: "all 0.15s",
                                      textAlign: "left",
                                    }}
                                    onMouseEnter={(e) => {
                                      if (!isAdded) {
                                        e.currentTarget.style.borderColor = "var(--accent)";
                                        e.currentTarget.style.background = "var(--accent-dim)";
                                      }
                                    }}
                                    onMouseLeave={(e) => {
                                      if (!isAdded) {
                                        e.currentTarget.style.borderColor = "var(--border)";
                                        e.currentTarget.style.background = "var(--surface2)";
                                      }
                                    }}
                                  >
                                    {ruleText} {isAdded && <span style={{ marginLeft: 4 }}>✓</span>}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* STEP 4: Variables Mapping */}
                {currentStep === 4 && (
                  <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 20 }}>
                    {/* Left Column: Variables Mapping Builder */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <label style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>Variables Mapping</label>
                        <button onClick={() => setFormVariables([...formVariables, { key: "", description: "", default: "" }])} style={{ padding: "4px 10px", background: "var(--border)", color: "var(--text)", fontSize: 11.5, display: "flex", alignItems: "center", gap: 4 }}>
                          <span>＋</span> Add Variable
                        </button>
                      </div>
                      
                      {formVariables.length === 0 ? (
                        <div style={{ padding: "30px 10px", textAlign: "center", color: "var(--text-muted)", fontSize: 12, border: "1px dashed var(--border)", borderRadius: "var(--radius)" }}>
                          No variables defined. Click presets on the right or Add Variable above to define custom parameters.
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: "40vh", overflowY: "auto", paddingRight: 4 }}>
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
                                placeholder="KEY (e.g. DB)"
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
                                style={{ padding: "0 10px", background: "rgba(239,68,68,0.1)", color: "var(--error)", border: "1px solid rgba(239,68,68,0.2)", height: 28 }}
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Right Column: Variable Presets */}
                    <div style={{ borderLeft: "1px solid var(--border)", paddingLeft: 20, display: "flex", flexDirection: "column", gap: 12 }}>
                      <label style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>Variable Presets</label>
                      <div style={{ maxHeight: "40vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 6, paddingRight: 4 }}>
                        {getDynamicVariablePresets().map((v) => {
                          const isAdded = formVariables.some((existing) => existing.key === v.key);
                          return (
                            <div
                              key={v.key}
                              onClick={() => !isAdded && addVariableFromPreset(v)}
                              style={{
                                padding: "8px 12px",
                                background: isAdded ? "rgba(34,197,94,0.06)" : "var(--surface2)",
                                border: `1px solid ${isAdded ? "rgba(34,197,94,0.2)" : "var(--border)"}`,
                                borderRadius: 6,
                                cursor: isAdded ? "default" : "pointer",
                                fontSize: 11,
                                color: isAdded ? "var(--success)" : "var(--text)",
                                transition: "all 0.15s",
                                textAlign: "left",
                              }}
                              onMouseEnter={(e) => {
                                if (!isAdded) {
                                  e.currentTarget.style.borderColor = "var(--accent)";
                                  e.currentTarget.style.background = "var(--accent-dim)";
                                }
                              }}
                              onMouseLeave={(e) => {
                                if (!isAdded) {
                                  e.currentTarget.style.borderColor = "var(--border)";
                                  e.currentTarget.style.background = "var(--surface2)";
                                }
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span style={{ fontWeight: 700, fontFamily: "monospace" }}>{v.key}</span>
                                {isAdded ? (
                                  <span>✓</span>
                                ) : (
                                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>Default: {v.default}</span>
                                )}
                              </div>
                              <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 2 }}>{v.description}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

              </div>

              {/* Modal Footer */}
              <div style={{ padding: "16px 24px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <button
                    onClick={() => {
                      setShowCreateModal(false);
                      setEditingTemplate(null);
                      resetForm();
                    }}
                    style={{ padding: "10px 18px", background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 13, borderRadius: "var(--radius)", cursor: "pointer" }}
                  >
                    Cancel
                  </button>
                </div>
                
                <div style={{ display: "flex", gap: 10 }}>
                  {currentStep > 1 && (
                    <button
                      onClick={handleBack}
                      style={{ padding: "10px 18px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 13, borderRadius: "var(--radius)", cursor: "pointer" }}
                    >
                      Back
                    </button>
                  )}
                  
                  {!isLast ? (
                    <button
                      onClick={handleNext}
                      disabled={!formName.trim()}
                      style={{ padding: "10px 22px", background: "var(--accent)", color: "#fff", fontWeight: 600, fontSize: 13, border: "none", borderRadius: "var(--radius)", cursor: !formName.trim() ? "default" : "pointer" }}
                    >
                      Next
                    </button>
                  ) : (
                    <button
                      onClick={handleSave}
                      disabled={!formName.trim() || createMut.isPending || updateMut.isPending}
                      style={{ padding: "10px 22px", background: "var(--accent)", color: "#fff", fontWeight: 600, fontSize: 13, border: "none", borderRadius: "var(--radius)", cursor: (!formName.trim() || createMut.isPending || updateMut.isPending) ? "default" : "pointer" }}
                    >
                      {createMut.isPending || updateMut.isPending ? "Saving..." : "Save Template"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

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
                  style={{ width: "100%", padding: "10px 12px", fontSize: 13, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: "var(--text)", outline: "none" }}
                >
                  {workspaces.map((w: any) => (
                    <option key={w.key} value={w.key}>
                      {w.label}
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
                style={{ padding: "10px 18px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 13, borderRadius: "var(--radius)", cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                onClick={handleImportSubmit}
                disabled={importMut.isPending}
                style={{ padding: "10px 22px", background: "var(--accent)", color: "#fff", fontWeight: 600, fontSize: 13, border: "none", borderRadius: "var(--radius)", cursor: importMut.isPending ? "default" : "pointer" }}
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
