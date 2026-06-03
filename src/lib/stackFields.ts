export const FIELD_OPTIONS: Record<string, string[]> = {
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

export interface StackPreferences {
  language: string;
  frontend: string;
  hosting: string;
  database: string;
  orm: string;
  auth: string;
  styling: string;
  stateCache: string;
  storage: string;
  search: string;
  vector: string;
  componentLibrary: string;
  bannedProviders: string[];
}

export const DEFAULT_STACK_PREFERENCES: StackPreferences = {
  language: "TypeScript",
  frontend: "React / TanStack",
  hosting: "Cloudflare Edge",
  database: "Cloudflare D1",
  orm: "Drizzle ORM",
  auth: "Better Auth",
  styling: "Vanilla CSS",
  stateCache: "TanStack Store",
  storage: "Cloudflare R2",
  search: "None",
  vector: "Cloudflare Vectorize",
  componentLibrary: "None",
  bannedProviders: [],
};
