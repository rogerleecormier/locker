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
    icon: "cloudflare",
    description: "Ultra-fast global deployments at the edge with Cloudflare Workers/Pages.",
    badges: ["Edge", "D1 + R2", "KV Cache"],
    themeColor: "#F38020"
  },
  {
    name: "Vercel Modern Stack",
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
    icon: "vercel",
    description: "Industry-standard serverless React application with Supabase integration.",
    badges: ["Serverless", "Next.js", "Supabase"],
    themeColor: "#E2E2E2"
  },
  {
    name: "AWS Serverless Stack",
    language: "TypeScript",
    frontend: "Next.js",
    hosting: "AWS Lambda",
    database: "PostgreSQL",
    orm: "Prisma",
    auth: "Clerk",
    styling: "Tailwind CSS",
    stateCache: "Zustand",
    storage: "AWS S3",
    search: "None",
    vector: "Pinecone",
    componentLibrary: "shadcn/ui",
    icon: "aws",
    description: "Enterprise scale serverless infrastructure built on AWS Lambda & S3.",
    badges: ["Lambda", "PostgreSQL", "S3 Storage"],
    themeColor: "#FF9900"
  },
  {
    name: "Google Cloud Run Stack",
    language: "Python",
    frontend: "FastAPI",
    hosting: "Google Cloud Run",
    database: "Google Cloud SQL",
    orm: "SQLAlchemy",
    auth: "Firebase Auth",
    styling: "Jinja2 + Tailwind",
    stateCache: "Redis Cache",
    storage: "Google Cloud Storage",
    search: "None",
    vector: "Qdrant",
    componentLibrary: "None",
    icon: "gcp",
    description: "Containerized Python API with rapid autoscaling on GCP Cloud Run.",
    badges: ["FastAPI", "Cloud Run", "GCP SQL"],
    themeColor: "#34A853"
  },
  {
    name: "Azure Enterprise Stack",
    language: "C#",
    frontend: "ASP.NET Core",
    hosting: "Azure App Service",
    database: "Azure SQL Database",
    orm: "Entity Framework Core",
    auth: "Microsoft Entra ID",
    styling: "Tailwind CSS",
    stateCache: "Redis Cache",
    storage: "Azure Blob Storage",
    search: "None",
    vector: "None",
    componentLibrary: "MUI (Material UI)",
    icon: "azure",
    description: "Enterprise-grade C# App with EF Core, Azure SQL, and Entra ID.",
    badges: ["ASP.NET", "EF Core", "Azure SQL"],
    themeColor: "#0078D4"
  },
  {
    name: "Netlify Jamstack",
    language: "TypeScript",
    frontend: "Astro",
    hosting: "Netlify",
    database: "Neon (Postgres)",
    orm: "Drizzle ORM",
    auth: "Clerk",
    styling: "Tailwind CSS",
    stateCache: "React Context",
    storage: "Vercel Blob",
    search: "Fuse.js",
    vector: "None",
    componentLibrary: "Radix UI",
    icon: "netlify",
    description: "High-performance static-first website generated with Astro.",
    badges: ["Astro", "Netlify Edge", "Fuse.js"],
    themeColor: "#00AD9F"
  },
  {
    name: "T3 Stack (Vercel)",
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
    icon: "t3",
    description: "Type-safe Next.js setup focusing on fullstack simplicity.",
    badges: ["tRPC-Ready", "Prisma", "Auth.js"],
    themeColor: "#5E1DAD"
  },
  {
    name: "MERN Stack (Legacy)",
    language: "JavaScript",
    frontend: "React / TanStack",
    hosting: "Render",
    database: "MongoDB",
    orm: "Mongoose",
    auth: "Custom",
    styling: "CSS Modules",
    stateCache: "Redux Toolkit",
    storage: "AWS S3",
    search: "None",
    vector: "None",
    componentLibrary: "None",
    icon: "mern",
    description: "Classic Mongo, Express, React, Node fullstack stack.",
    badges: ["MongoDB", "Express", "Redux"],
    themeColor: "#4DB33D"
  }
];

const FIELD_OPTIONS: Record<string, string[]> = {
  language: ["TypeScript", "JavaScript", "Python", "Go", "Rust", "Ruby", "Java", "C#", "C++", "PHP"],
  frontend: ["React / TanStack", "Next.js", "Remix", "Vue / Nuxt", "Svelte / SvelteKit", "Astro", "SolidJS", "Angular", "Node.js / Express", "HTML/JS"],
  hosting: ["Cloudflare Edge", "Vercel", "Netlify", "AWS Lambda", "Google Cloud Run", "Azure App Service", "Fly.io", "Heroku", "Railway", "Render", "Self-Hosted VPS"],
  database: ["Cloudflare D1", "PostgreSQL", "MySQL", "SQLite", "MongoDB", "Redis", "Supabase (Postgres)", "Neon (Postgres)", "PlanetScale", "Prisma Postgres", "Azure SQL Database", "Google Cloud SQL"],
  orm: ["Drizzle ORM", "Prisma", "Mongoose", "TypeORM", "Kysely", "Sequelize", "Entity Framework Core", "SQL (Raw)", "None"],
  auth: ["Better Auth", "Auth.js (NextAuth)", "Clerk", "Supabase Auth", "Firebase Auth", "Microsoft Entra ID", "Kinde", "Lucia", "Custom", "None"],
  styling: ["Vanilla CSS", "Tailwind CSS", "Bootstrap", "Material Design", "CSS Modules", "Styled Components", "Sass/SCSS", "Tailwind + CSS Modules"],
  stateCache: ["TanStack Store", "Cloudflare KV", "Zustand", "Redux Toolkit", "Jotai", "Recoil", "React Context", "Pinia", "Vuex", "Redis Cache", "None"],
  storage: ["Cloudflare R2", "AWS S3", "Supabase Storage", "Vercel Blob", "Firebase Storage", "Azure Blob Storage", "Google Cloud Storage", "Local Filesystem", "None"],
  search: ["Fuse.js", "Algolia", "Meilisearch", "Elasticsearch", "None"],
  vector: ["Cloudflare Vectorize", "Pinecone", "pgvector", "Supabase Vector", "Qdrant", "None"],
  componentLibrary: ["shadcn/ui", "MUI (Material UI)", "Chakra UI", "Radix UI", "DaisyUI", "PrimeReact", "None"],
};

const renderPresetIcon = (icon: string) => {
  switch (icon) {
    case "cloudflare":
      return (
        <svg viewBox="0 0 24 24" width="20" height="20" strokeLinecap="round" strokeLinejoin="round" style={{ fill: "currentColor" }}>
          <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
        </svg>
      );
    case "vercel":
      return (
        <svg viewBox="0 0 24 24" width="20" height="20" style={{ fill: "currentColor" }}>
          <polygon points="12,2 22,22 2,22" />
        </svg>
      );
    case "aws":
      return (
        <svg viewBox="0 0 24 24" width="20" height="20" style={{ fill: "currentColor" }}>
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15.5c0 .83-.67 1.5-1.5 1.5s-1.5-.67-1.5-1.5V13c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5v4.5zm-1.5-7c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z" />
        </svg>
      );
    case "gcp":
      return (
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path d="M12,2 L21,7 L21,17 L12,22 L3,17 L3,7 Z" fill="none" stroke="currentColor" strokeWidth="2.5" />
          <circle cx="12" cy="12" r="4.5" fill="currentColor" />
          <line x1="12" y1="2" x2="12" y2="7.5" stroke="currentColor" strokeWidth="2" />
          <line x1="3" y1="7" x2="8" y2="10" stroke="currentColor" strokeWidth="2" />
          <line x1="21" y1="7" x2="16" y2="10" stroke="currentColor" strokeWidth="2" />
        </svg>
      );
    case "azure":
      return (
        <svg viewBox="0 0 24 24" width="20" height="20" style={{ fill: "currentColor" }}>
          <path d="M5,15 C5,9 9,6 14,8 C17,5 21,8 21,11 C23,11 25,13 25,15 C25,18 22,20 19,20 L5,20 Z" />
          <path d="M2,16 C2,12 5,9 9,11 C12,8 16,10 16,13" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.8" />
        </svg>
      );
    case "netlify":
      return (
        <svg viewBox="0 0 24 24" width="20" height="20" style={{ fill: "currentColor" }}>
          <polygon points="12,2 20,9 12,16 4,9" />
          <polygon points="12,10 17.5,14.5 12,19 6.5,14.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case "t3":
      return (
        <svg viewBox="0 0 24 24" width="20" height="20">
          <ellipse cx="12" cy="12" rx="9" ry="3.5" fill="none" stroke="currentColor" strokeWidth="1.5" transform="rotate(30, 12, 12)" />
          <ellipse cx="12" cy="12" rx="9" ry="3.5" fill="none" stroke="currentColor" strokeWidth="1.5" transform="rotate(90, 12, 12)" />
          <ellipse cx="12" cy="12" rx="9" ry="3.5" fill="none" stroke="currentColor" strokeWidth="1.5" transform="rotate(150, 12, 12)" />
          <circle cx="12" cy="12" r="2.5" fill="currentColor" />
        </svg>
      );
    case "mern":
      return (
        <svg viewBox="0 0 24 24" width="20" height="20" style={{ fill: "currentColor" }}>
          <path d="M12,2 C12,2 5,7 5,13 C5,18 8,21 12,21 C16,21 19,18 19,13 C19,7 12,2 12,2 Z" />
          <path d="M12,2 L12,21" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="2" y="2" width="20" height="8" rx="2" />
          <rect x="2" y="14" width="20" height="8" rx="2" />
          <line x1="6" y1="6" x2="6.01" y2="6" strokeWidth="3" strokeLinecap="round" />
          <line x1="6" y1="18" x2="6.01" y2="18" strokeWidth="3" strokeLinecap="round" />
        </svg>
      );
  }
};

const getDynamicFieldOptions = (field: string, lang: string, framework: string): string[] => {
  const langLower = lang.toLowerCase();
  const frameLower = framework.toLowerCase();
  
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

  if (field === "database") {
    if (langLower === "c#") {
      return ["Azure SQL Database", "PostgreSQL", "MySQL", "SQLite", "None"];
    }
    if (langLower === "python") {
      return ["Google Cloud SQL", "PostgreSQL", "MySQL", "SQLite", "MongoDB", "None"];
    }
    return FIELD_OPTIONS.database || [];
  }

  if (field === "storage") {
    if (langLower === "c#") {
      return ["Azure Blob Storage", "Local Filesystem", "None"];
    }
    if (langLower === "python") {
      return ["Google Cloud Storage", "AWS S3", "Local Filesystem", "None"];
    }
    return FIELD_OPTIONS.storage || [];
  }

  if (field === "orm") {
    if (langLower === "typescript" || langLower === "javascript") {
      if (frameLower.includes("next.js") || frameLower.includes("remix")) {
        return ["Drizzle ORM", "Prisma", "Kysely", "SQL (Raw)", "None"];
      }
      return ["Drizzle ORM", "Prisma", "Mongoose", "TypeORM", "Kysely", "Sequelize", "SQL (Raw)", "None"];
    }
    if (langLower === "python") {
      if (frameLower.includes("django")) {
        return ["Django ORM", "SQLAlchemy", "SQL (Raw)", "None"];
      }
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
      if (frameLower.includes("laravel")) {
        return ["Eloquent", "Doctrine", "None"];
      }
      return ["Eloquent", "Doctrine", "None"];
    }
    return ["Drizzle ORM", "SQLAlchemy", "GORM", "Active Record", "Entity Framework Core", "SQL (Raw)", "None"];
  }

  if (field === "auth") {
    if (langLower === "typescript" || langLower === "javascript") {
      if (frameLower.includes("next.js")) {
        return ["Auth.js (NextAuth)", "Clerk", "Better Auth", "Supabase Auth", "Kinde", "None"];
      }
      if (frameLower.includes("remix")) {
        return ["Better Auth", "Clerk", "Supabase Auth", "Lucia", "None"];
      }
      return ["Better Auth", "Auth.js (NextAuth)", "Clerk", "Supabase Auth", "Firebase Auth", "Kinde", "Lucia", "Custom", "None"];
    }
    if (langLower === "python") {
      if (frameLower.includes("django")) {
        return ["Django Auth", "Clerk", "Supabase Auth", "Custom", "None"];
      }
      if (frameLower.includes("fastapi")) {
        return ["FastAPI Users", "Clerk", "Supabase Auth", "Firebase Auth", "Custom", "None"];
      }
      return ["Clerk", "Supabase Auth", "Firebase Auth", "Auth0", "Custom", "None"];
    }
    if (langLower === "php") {
      if (frameLower.includes("laravel")) {
        return ["Laravel Breeze / Jetstream", "Clerk", "Supabase Auth", "Custom", "None"];
      }
    }
    if (langLower === "c#") {
      return ["Microsoft Entra ID", "Custom", "None"];
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
      return ["Cloudflare Edge", "Vercel", "Netlify", "AWS Lambda", "Fly.io", "Heroku", "Railway", "Render", "Self-Hosted VPS", "None"];
    }
    if (langLower === "c#") {
      return ["Azure App Service", "Self-Hosted VPS", "None"];
    }
    return ["AWS Lambda", "Google Cloud Run", "Azure App Service", "Fly.io", "Cloudflare Edge", "Vercel", "Netlify", "Heroku", "Railway", "Render", "Self-Hosted VPS", "None"];
  }

  if (field === "styling") {
    if (langLower === "typescript" || langLower === "javascript") {
      if (frameLower.includes("angular")) {
        return ["Sass/SCSS", "Tailwind CSS", "Vanilla CSS", "None"];
      }
      return ["Vanilla CSS", "Tailwind CSS", "Bootstrap", "Material Design", "CSS Modules", "Styled Components", "Sass/SCSS", "Tailwind + CSS Modules"];
    }
    if (langLower === "python") {
      if (frameLower.includes("django")) {
        return ["Django Templates + Tailwind", "Django Templates + Bootstrap", "Vanilla CSS", "None"];
      }
      if (frameLower.includes("fastapi") || frameLower.includes("flask") || frameLower.includes("mkdocs")) {
        return ["Jinja2 + Tailwind", "Jinja2 + Bootstrap", "Vanilla CSS", "None"];
      }
      if (frameLower.includes("streamlit")) {
        return ["Streamlit Theme", "None"];
      }
      return ["Jinja2 + Tailwind", "Jinja2 + Bootstrap", "Vanilla CSS", "None"];
    }
    if (langLower === "php") {
      if (frameLower.includes("laravel")) {
        return ["Blade + Tailwind", "Blade + Bootstrap", "Vanilla CSS", "None"];
      }
      return ["Blade + Tailwind", "Twig + Tailwind", "Blade + Bootstrap", "Vanilla CSS", "None"];
    }
    if (langLower === "go") {
      return ["Go HTML Templates + Tailwind", "Templ + Tailwind", "Go HTML Templates + Bootstrap", "Vanilla CSS", "None"];
    }
    if (langLower === "ruby") {
      return ["ERB + Tailwind", "ERB + Bootstrap", "Vanilla CSS", "None"];
    }
    return ["Tailwind CSS", "Bootstrap", "Vanilla CSS", "None"];
  }

  if (field === "componentLibrary") {
    if (langLower === "typescript" || langLower === "javascript") {
      if (frameLower.includes("angular")) {
        return ["Angular Material", "PrimeNG", "NG-ZORRO", "None"];
      }
      if (frameLower.includes("vue / nuxt")) {
        return ["Vuetify", "PrimeVue", "Element Plus", "DaisyUI", "None"];
      }
      if (frameLower.includes("svelte")) {
        return ["Svelte UX", "Flowbite Svelte", "DaisyUI", "None"];
      }
      return ["shadcn/ui", "MUI (Material UI)", "Chakra UI", "Radix UI", "DaisyUI", "PrimeReact", "None"];
    }
    if (langLower === "python") {
      if (frameLower.includes("django")) {
        return ["Django Cotton (Reusable Templates)", "Django Unicorn (Reactive)", "None"];
      }
      if (frameLower.includes("dash")) {
        return ["Dash Mantine Components", "Dash Bootstrap Components", "None"];
      }
      if (frameLower.includes("reflex")) {
        return ["Reflex UI (Radix/Chakra)", "None"];
      }
      if (frameLower.includes("flet")) {
        return ["Flet (Flutter UI)", "None"];
      }
      return ["Django Cotton (Reusable Templates)", "Django Unicorn (Reactive)", "None"];
    }
    if (langLower === "php") {
      if (frameLower.includes("laravel")) {
        return ["Laravel Livewire", "Blade Components", "None"];
      }
      return ["Laravel Livewire", "Blade Components", "Twig Components", "None"];
    }
    if (langLower === "go") {
      return ["Templ Components", "Hugo Components", "None"];
    }
    if (langLower === "rust") {
      return ["Leptos Components", "Yew Components", "None"];
    }
    if (langLower === "ruby") {
      return ["ViewComponent (Rails)", "Phlex", "None"];
    }
    return ["None"];
  }

  return FIELD_OPTIONS[field] || [];
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

function TemplateFormModal({
  editingTemplate,
  onClose,
  onSuccess,
}: {
  editingTemplate: any | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const queryClient = useQueryClient();
  const presetsScrollRef = useRef<HTMLDivElement>(null);

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

  // Initialize form state if editing template
  useEffect(() => {
    if (editingTemplate) {
      setCurrentStep(1);
      setFormName(editingTemplate.name);
      setFormDesc(editingTemplate.description);
      setFormCategory(editingTemplate.category);

      let payload: ParsedPayload = { rules: [] };
      try {
        payload = JSON.parse(editingTemplate.configPayload);
      } catch (e) {}

      setFormRules(payload.rules || [""]);
      setFormVariables(payload.variables || []);

      if (editingTemplate.category === "stack") {
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
    }
  }, [editingTemplate]);

  // Mutations
  const createMut = useMutation({
    mutationFn: (data: any) => createMemoryTemplate({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      onSuccess();
    },
    onError: (err: any) => {
      console.error("[createMut] error:", err);
      alert(`Failed to create template: ${err.message || String(err)}`);
    },
  });

  const updateMut = useMutation({
    mutationFn: (data: any) => updateMemoryTemplate({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      onSuccess();
    },
    onError: (err: any) => {
      console.error("[updateMut] error:", err);
      alert(`Failed to update template: ${err.message || String(err)}`);
    },
  });

  const handleSave = () => {
    console.log("[TemplateFormModal] handleSave called");
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

  const handleLanguageChange = (newLang: string) => {
    setStackLanguage(newLang);
    
    // 1. Reconcile frontend framework first, as other fields depend on it
    let targetFrontend = stackFrontend;
    const validFrontendOptions = getDynamicFieldOptions("frontend", newLang, "");
    const frontendLower = stackFrontend.toLowerCase();
    const isFrontendValid = validFrontendOptions.some(opt => opt.toLowerCase() === frontendLower);
    
    if (!isFrontendValid && validFrontendOptions.length > 0) {
      const noneOption = validFrontendOptions.find(opt => opt.toLowerCase() === "none");
      targetFrontend = noneOption || validFrontendOptions[0];
      setStackFrontend(targetFrontend);
    }

    // 2. Reconcile all other dependent fields based on the new language and the (potentially updated) framework
    const fieldsToVerify = [
      { name: "orm", value: stackOrm, setter: setStackOrm },
      { name: "auth", value: stackAuth, setter: setStackAuth },
      { name: "statecache", value: stackStateCache, setter: setStackStateCache },
      { name: "styling", value: stackStyling, setter: setStackStyling },
      { name: "componentLibrary", value: stackComponentLibrary, setter: setStackComponentLibrary },
      { name: "hosting", value: stackHosting, setter: setStackHosting }
    ];

    fieldsToVerify.forEach(({ name, value, setter }) => {
      const validOptions = getDynamicFieldOptions(name, newLang, targetFrontend);
      const valueLower = value.toLowerCase();
      const isValid = validOptions.some(opt => opt.toLowerCase() === valueLower);
      
      if (!isValid && validOptions.length > 0) {
        const noneOption = validOptions.find(opt => opt.toLowerCase() === "none");
        setter(noneOption || validOptions[0]);
      }
    });
  };

  const handleFrontendChange = (newFrontend: string) => {
    setStackFrontend(newFrontend);
    
    // Check and reset ORM, Auth, Styling, and Component Library based on the new framework
    const fieldsToVerify = [
      { name: "orm", value: stackOrm, setter: setStackOrm },
      { name: "auth", value: stackAuth, setter: setStackAuth },
      { name: "styling", value: stackStyling, setter: setStackStyling },
      { name: "componentLibrary", value: stackComponentLibrary, setter: setStackComponentLibrary }
    ];

    fieldsToVerify.forEach(({ name, value, setter }) => {
      const validOptions = getDynamicFieldOptions(name, stackLanguage, newFrontend);
      const valueLower = value.toLowerCase();
      const isValid = validOptions.some(opt => opt.toLowerCase() === valueLower);
      
      if (!isValid && validOptions.length > 0) {
        const noneOption = validOptions.find(opt => opt.toLowerCase() === "none");
        setter(noneOption || validOptions[0]);
      }
    });
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
    } else if (vectorLower.includes("qdrant")) {
      searchRules.push("Configure Qdrant URL endpoints securely; use authentication headers.");
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

  const addVariableFromPreset = (preset: { key: string; description: string; default: string }) => {
    setFormVariables((prev) => {
      if (prev.some((v) => v.key === preset.key)) {
        return prev;
      }
      return [...prev, { ...preset }];
    });
  };

  const hasVariables = formCategory === "stack" || formCategory === "devops";
  const stepsList = [
    { id: 1, label: "Info" },
    ...(formCategory === "stack" ? [{ id: 2, label: "Stack" }] : []),
    { id: 3, label: "Rules" },
    ...(hasVariables ? [{ id: 4, label: "Variables" }] : [])
  ];

  const isLast = hasVariables ? currentStep === 4 : currentStep === 3;

  const scrollPresets = (direction: "left" | "right") => {
    if (presetsScrollRef.current) {
      const cardWidth = presetsScrollRef.current.firstElementChild?.clientWidth || 250;
      const scrollAmount = (cardWidth + 16) * (direction === "left" ? -1 : 1);
      presetsScrollRef.current.scrollBy({
        left: scrollAmount,
        behavior: "smooth",
      });
    }
  };

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
      backdropFilter: "blur(4px)",
      zIndex: 100,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 20,
      overflowY: "auto",
    }}>
      <div style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        width: "100%",
        maxWidth: currentStep === 1 ? 680 : currentStep === 2 ? 960 : 840,
        display: "flex",
        flexDirection: "column",
        boxShadow: "0 24px 48px rgba(0,0,0,0.5)",
        transition: "max-width 0.2s ease-in-out",
        willChange: "transform",
      }}>
        {/* Modal Header */}
        <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>
            {editingTemplate ? "Edit Template" : "New Memory Template"}
          </span>
          <button onClick={onClose} style={{ background: "none", color: "var(--text-muted)", fontSize: 20 }}>×</button>
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
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
          
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
              <div style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "16px", padding: "20px", position: "relative" }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", display: "block", marginBottom: 14, letterSpacing: "0.05em" }}>Quick Load Stack Presets</span>
                
                <style>{`
                  .presets-scroll-container {
                    display: flex;
                    flex-direction: row;
                    gap: 16px;
                    overflow-x: auto;
                    padding-bottom: 12px;
                    scroll-behavior: smooth;
                    scroll-snap-type: x mandatory;
                    -webkit-overflow-scrolling: touch;
                    will-change: transform;
                    contain: content;
                  }
                  .presets-scroll-container::-webkit-scrollbar {
                    height: 6px;
                  }
                  .presets-scroll-container::-webkit-scrollbar-track {
                    background: rgba(255, 255, 255, 0.02);
                    border-radius: 3px;
                  }
                  .presets-scroll-container::-webkit-scrollbar-thumb {
                    background: rgba(255, 255, 255, 0.12);
                    border-radius: 3px;
                    transition: background 0.15s;
                  }
                  .presets-scroll-container::-webkit-scrollbar-thumb:hover {
                    background: rgba(255, 255, 255, 0.2);
                  }
                `}</style>
                
                <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                  {/* Left Scroll Arrow */}
                  <button
                    type="button"
                    onClick={() => scrollPresets("left")}
                    style={{
                      position: "absolute",
                      left: "-12px",
                      zIndex: 10,
                      width: "32px",
                      height: "32px",
                      borderRadius: "50%",
                      background: "var(--surface2)",
                      border: "1px solid var(--border)",
                      color: "var(--text)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                      transition: "all 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "var(--accent-dim)";
                      e.currentTarget.style.borderColor = "var(--accent)";
                      e.currentTarget.style.color = "var(--accent)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "var(--surface2)";
                      e.currentTarget.style.borderColor = "var(--border)";
                      e.currentTarget.style.color = "var(--text)";
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m15 18-6-6 6-6"/>
                    </svg>
                  </button>

                  {/* Scrollable Presets Grid */}
                  <div ref={presetsScrollRef} className="presets-scroll-container" style={{ width: "100%" }}>
                    {STACK_PRESETS.map((preset) => {
                      const isCurrentlySelected = 
                        stackLanguage === preset.language &&
                        stackFrontend === preset.frontend &&
                        stackHosting === preset.hosting &&
                        stackDatabase === preset.database &&
                        stackOrm === preset.orm &&
                        stackAuth === preset.auth &&
                        stackStyling === preset.styling &&
                        stackStorage === preset.storage &&
                        stackComponentLibrary === preset.componentLibrary;
                        
                      return (
                        <div
                          key={preset.name}
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
                            setStackStateCache(preset.stateCache || "None");
                            setStackComponentLibrary(preset.componentLibrary || "None");
                          }}
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            padding: "16px",
                            background: isCurrentlySelected ? `${preset.themeColor}12` : "var(--surface2)",
                            border: isCurrentlySelected ? `2px solid ${preset.themeColor}` : "1px solid var(--border)",
                            borderRadius: "12px",
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                            position: "relative",
                            flexShrink: 0,
                            width: "calc((100% - 32px) / 3)",
                            minWidth: "250px",
                            scrollSnapAlign: "start"
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.borderColor = preset.themeColor;
                            e.currentTarget.style.background = isCurrentlySelected ? `${preset.themeColor}1c` : "rgba(255,255,255,0.03)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.borderColor = isCurrentlySelected ? preset.themeColor : "var(--border)";
                            e.currentTarget.style.background = isCurrentlySelected ? `${preset.themeColor}12` : "var(--surface2)";
                          }}
                        >
                          {/* Header */}
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                            <div style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              width: "36px",
                              height: "36px",
                              borderRadius: "10px",
                              background: `linear-gradient(135deg, ${preset.themeColor}1a, ${preset.themeColor}33)`,
                              border: `1px solid ${preset.themeColor}4d`,
                              color: preset.themeColor
                            }}>
                              {renderPresetIcon(preset.icon)}
                            </div>
                            <span style={{
                              fontSize: "9px",
                              fontWeight: 700,
                              textTransform: "uppercase",
                              padding: "2px 8px",
                              borderRadius: "10px",
                              background: "rgba(255,255,255,0.06)",
                              color: "var(--text-muted)",
                              border: "1px solid rgba(255,255,255,0.05)"
                            }}>
                              {preset.language}
                            </span>
                          </div>
                          
                          {/* Title & Description */}
                          <div style={{ marginBottom: 12 }}>
                            <div style={{ fontSize: "13px", fontWeight: 650, color: "var(--text)", marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
                              {preset.name}
                              {isCurrentlySelected && (
                                <span style={{
                                  width: "6px",
                                  height: "6px",
                                  borderRadius: "50%",
                                  background: "var(--accent)"
                                }} />
                              )}
                            </div>
                            <div style={{ fontSize: "11px", color: "var(--text-muted)", lineHeight: "1.4" }}>
                              {preset.description}
                            </div>
                          </div>
                          
                          {/* Badges/Highlights */}
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: "auto" }}>
                            {preset.badges.map(b => (
                              <span key={b} style={{
                                fontSize: "9.5px",
                                fontWeight: 500,
                                padding: "2px 6px",
                                borderRadius: "4px",
                                background: "rgba(255,255,255,0.03)",
                                border: "1px solid rgba(255,255,255,0.04)",
                                color: "rgba(255,255,255,0.6)"
                              }}>
                                {b}
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Right Scroll Arrow */}
                  <button
                    type="button"
                    onClick={() => scrollPresets("right")}
                    style={{
                      position: "absolute",
                      right: "-12px",
                      zIndex: 10,
                      width: "32px",
                      height: "32px",
                      borderRadius: "50%",
                      background: "var(--surface2)",
                      border: "1px solid var(--border)",
                      color: "var(--text)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                      transition: "all 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "var(--accent-dim)";
                      e.currentTarget.style.borderColor = "var(--accent)";
                      e.currentTarget.style.color = "var(--accent)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "var(--surface2)";
                      e.currentTarget.style.borderColor = "var(--border)";
                      e.currentTarget.style.color = "var(--text)";
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m9 18 6-6-6-6"/>
                    </svg>
                  </button>
                </div>
              </div>

              {/* Stack Fields */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, paddingBottom: 12 }}>
                {/* Column 1: Frontend & Language */}
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
                    <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text)" }}>Frontend & Language</span>
                  </div>
                  <Combobox label="Language" value={stackLanguage} onChange={handleLanguageChange} options={FIELD_OPTIONS.language} placeholder="e.g. TypeScript" />
                  <Combobox label="Frontend Framework" value={stackFrontend} onChange={handleFrontendChange} options={getDynamicFieldOptions("frontend", stackLanguage, "")} placeholder="e.g. Next.js" />
                  <Combobox label="Styling / Templating" value={stackStyling} onChange={setStackStyling} options={getDynamicFieldOptions("styling", stackLanguage, stackFrontend)} placeholder="e.g. Tailwind CSS" />
                  <Combobox label="Component Library" value={stackComponentLibrary} onChange={setStackComponentLibrary} options={getDynamicFieldOptions("componentLibrary", stackLanguage, stackFrontend)} placeholder="e.g. shadcn/ui" />
                </div>

                {/* Column 2: Services & Security */}
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
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                    <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text)" }}>Services & Security</span>
                  </div>
                  <Combobox label="Auth / Identity" value={stackAuth} onChange={setStackAuth} options={getDynamicFieldOptions("auth", stackLanguage, stackFrontend)} placeholder="e.g. Better Auth" />
                  <Combobox label="Full-Text Search (Lexical)" value={stackSearch} onChange={setStackSearch} options={FIELD_OPTIONS.search} placeholder="e.g. Fuse.js" />
                  <Combobox label="Vector Database (Semantic)" value={stackVector} onChange={setStackVector} options={FIELD_OPTIONS.vector} placeholder="e.g. Cloudflare Vectorize" />
                </div>

                {/* Column 3: Backend & Infrastructure */}
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
                  <Combobox label="Hosting Runtime" value={stackHosting} onChange={setStackHosting} options={getDynamicFieldOptions("hosting", stackLanguage, stackFrontend)} placeholder="e.g. Cloudflare Pages" />
                  <Combobox label="Database" value={stackDatabase} onChange={setStackDatabase} options={FIELD_OPTIONS.database} placeholder="e.g. Cloudflare D1" />
                  <Combobox label="ORM / DB Client" value={stackOrm} onChange={setStackOrm} options={getDynamicFieldOptions("orm", stackLanguage, stackFrontend)} placeholder="e.g. Drizzle ORM" />
                  <Combobox label="Storage (Buckets)" value={stackStorage} onChange={setStackStorage} options={FIELD_OPTIONS.storage} placeholder="e.g. Cloudflare R2" />
                  <Combobox label="State / Client Cache" value={stackStateCache} onChange={setStackStateCache} options={getDynamicFieldOptions("statecache", stackLanguage, stackFrontend)} placeholder="e.g. Cloudflare KV" />
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
              onClick={onClose}
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
}
function TemplatesPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"all" | TemplateCategory>("all");
  const [editingTemplate, setEditingTemplate] = useState<any>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [importingTemplate, setImportingTemplate] = useState<any>(null);
  const [filter, setFilter] = useState("");
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'alphabetical'>('newest');

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

  const handleEdit = (tmpl: any) => {
    setEditingTemplate(tmpl);
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
      {(showCreateModal || editingTemplate) && (
        <TemplateFormModal
          editingTemplate={editingTemplate}
          onClose={() => {
            setShowCreateModal(false);
            setEditingTemplate(null);
          }}
          onSuccess={() => {
            setShowCreateModal(false);
            setEditingTemplate(null);
          }}
        />
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
