import type { SectionProps } from "../types";
import {
  SectionTitle,
  Lead,
  SubHeading,
  Card,
  CardTitle,
  CardBody,
  Grid,
  StepList,
  Table,
  InfoBox,
} from "../ui";

const CATEGORIES = [
  ["Language", "TypeScript, Python, Go, Rust, …"],
  ["Frontend Framework", "React, Next.js, SvelteKit, Nuxt, …"],
  ["Backend Framework", "Hono, Express, Fastify, Elysia, …"],
  ["Database", "Cloudflare D1, PostgreSQL, SQLite, …"],
  ["ORM", "Drizzle ORM, Prisma, Kysely, …"],
  ["Auth", "Better Auth, Auth.js, Clerk, Lucia, …"],
  ["Styling", "Tailwind CSS, CSS Modules, UnoCSS, …"],
  ["State / Cache", "Cloudflare KV, Zustand, Jotai, …"],
  ["Storage", "Cloudflare R2, AWS S3, Supabase Storage, …"],
  ["Search", "Fuse.js, Typesense, Meilisearch, …"],
  ["Vector DB", "Cloudflare Vectorize, Pinecone, Weaviate, …"],
  ["Component Library", "shadcn/ui, Radix UI, Mantine, …"],
];

export default function StackCreator(_props: SectionProps) {
  return (
    <div>
      <SectionTitle>Tech Stack Creator</SectionTitle>
      <Lead>
        Define your project's complete technology blueprint across 12 category dimensions. The Stack
        Creator wizard produces a structured configuration that AI clients use to generate
        consistent, opinionated code.
      </Lead>

      <SubHeading>12 Stack Categories</SubHeading>
      <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
        Each category accepts one or more selections from a curated dropdown or a custom free-form
        value. You can also attach per-category constraints — plain-English rules that agents apply
        when generating code in that dimension (e.g., "Drizzle ORM with snake_case schema", "Use
        React Server Components only").
      </p>
      <Table
        headers={["Category", "Example Selections"]}
        rows={CATEGORIES.map(([cat, ex]) => [cat, ex])}
      />

      <SubHeading>How it works</SubHeading>
      <StepList
        items={[
          {
            step: "1",
            title: "Open Stack Creator",
            text: "Go to Memories → Stack Creator (or the dedicated Stack tab in the sidebar).",
          },
          {
            step: "2",
            title: "Select your technologies",
            text: "For each category, pick your technology from the dropdown or type a custom value. Leave a category blank to leave it unconstrained.",
          },
          {
            step: "3",
            title: "Add constraints",
            text: 'Optionally add free-text constraints per category, e.g., "Use React Server Components only" or "Drizzle ORM with snake_case schema".',
          },
          {
            step: "4",
            title: "Save Blueprint",
            text: 'Click "Save Blueprint". Locker automatically creates a structured memory with category stack containing your full configuration.',
          },
        ]}
      />

      <SubHeading>How agents use it</SubHeading>
      <Grid>
        <Card accent="purple">
          <CardTitle>recall_context</CardTitle>
          <CardBody>
            When an agent calls <code>recall_context</code> with a stack-related query (e.g., "what
            database should I use?"), the blueprint is surfaced as a high-priority context block
            ahead of other memories, ensuring agents always code to your spec.
          </CardBody>
        </Card>
        <Card accent="blue">
          <CardTitle>export_rules</CardTitle>
          <CardBody>
            The <code>export_rules</code> MCP tool embeds the full stack config into all exported
            agent instruction files — CLAUDE.md, .cursorrules, copilot-instructions.md, GEMINI.md,
            and AGENTS.md — so every client is aligned from the first prompt.
          </CardBody>
        </Card>
      </Grid>

      <SubHeading>Multiple Blueprints</SubHeading>
      <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
        You can save multiple named blueprints for different project archetypes — for example,
        "Frontend App", "API Service", or "CLI Tool". Tag each blueprint with the relevant project
        name so agents automatically receive whichever blueprint matches their active project tag.
      </p>
      <InfoBox>
        <span style={{ fontSize: 16 }}>💡</span>
        <span>
          To share a blueprint across an entire team, ask an Admin to promote it to a team-level
          stack memory. All members will then inherit it unless overridden by a project-scoped
          blueprint.
        </span>
      </InfoBox>
    </div>
  );
}
