#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { memoryTemplates } from "../src/db/schema";

const templates = [
  {
    id: "cf-edge-tanstack-v8",
    name: "Cloudflare Edge + TanStack",
    description: "Cloudflare Workers, D1, R2, Vectorize with TanStack Start, Query, and Table.",
    category: "stack" as const,
    configPayload: JSON.stringify({
      language: "TypeScript",
      frontend: "React / TanStack",
      hosting: "Cloudflare Edge",
      database: "Cloudflare D1",
      storage: "Cloudflare R2",
      search: "Cloudflare Vectorize",
      orm: "Drizzle ORM",
      auth: "Better Auth",
      styling: "Vanilla CSS",
      stateCache: "TanStack Store",
      bannedProviders: ["AWS", "Google Cloud"],
      rules: [
        "Enforce Cloudflare Workers for edge runtime compute.",
        "Enforce D1 as the primary relational database with Drizzle ORM.",
        "Enforce R2 for blob/object storage.",
        "Enforce Vectorize for vector search indexing.",
        "Enforce TanStack Start for routing, SSR, and build-time configuration."
      ],
      variables: [
        { key: "DB_BINDING", description: "Wrangler D1 database binding name", default: "DB" },
        { key: "R2_BUCKET", description: "Wrangler R2 bucket binding name", default: "BUCKET" }
      ]
    })
  },
  {
    id: "aws-serverless-standard",
    name: "AWS Serverless Standard",
    description: "Standard TypeScript + React Lambda serverless stack with Aurora PG, S3, and Pinecone.",
    category: "stack" as const,
    configPayload: JSON.stringify({
      language: "TypeScript",
      frontend: "React / TanStack",
      hosting: "AWS Lambda",
      database: "Aurora PostgreSQL",
      storage: "AWS S3",
      search: "Pinecone",
      orm: "Prisma",
      auth: "Clerk",
      styling: "Tailwind CSS",
      stateCache: "Zustand",
      bannedProviders: ["Google Cloud", "Azure"],
      rules: [
        "Enforce AWS Lambda for serverless function handlers.",
        "Use Aurora PostgreSQL Serverless v2 for relational database requirements.",
        "Use Prisma ORM for schema building and query execution.",
        "Enforce AWS S3 for secure blob storage."
      ],
      variables: [
        { key: "AWS_REGION", description: "Target deployment AWS region", default: "us-east-1" }
      ]
    })
  },
  {
    id: "git-governance-standards",
    name: "Git & Code Governance",
    description: "Best-practice rules for git workflows, PR titles, and branch naming conventions.",
    category: "governance" as const,
    configPayload: JSON.stringify({
      rules: [
        "Branches must follow naming: feat/*, fix/*, chore/*, refactor/*, hotfix/*.",
        "Pull requests must require at least 1 peer approval before merging.",
        "Commit messages must follow conventional commits specification (e.g. 'feat: add templates page').",
        "Keep branch lifespans short; delete remote branches immediately after squash merging."
      ],
      variables: [
        { key: "DEFAULT_BRANCH", description: "Name of the main branch", default: "main" }
      ]
    })
  },
  {
    id: "github-actions-devops",
    name: "DevOps & CI/CD Guidelines",
    description: "Rules guiding automated testing, building, and security linting in CI pipelines.",
    category: "devops" as const,
    configPayload: JSON.stringify({
      rules: [
        "Every PR branch must trigger a CI test suite runner.",
        "Build, typecheck, and lint tasks must block merge on failure.",
        "Never commit plaintext secrets to the repository; fetch from Github Secrets environment.",
        "Cache node_modules dependencies in Github Actions steps to accelerate pipeline execution."
      ],
      variables: [
        { key: "NODE_VERSION", description: "Target Node.js version for CI", default: "20.x" }
      ]
    })
  },
  {
    id: "gdpr-compliance-rules",
    name: "GDPR & Data Compliance",
    description: "Core privacy rules governing user personal data collection, encryption, and export.",
    category: "compliance" as const,
    configPayload: JSON.stringify({
      rules: [
        "Do not log or store plain-text personally identifiable info (PII) like emails or phone numbers without encryption.",
        "Enforce a one-click 'Delete My Data' endpoint deleting all associated relational records.",
        "Encapsulate user data exports in a standardized JSON format.",
        "Store data in region-locked databases matching user jurisdictional laws where applicable."
      ],
      variables: [
        { key: "PII_ENCRYPTION_ALGO", description: "PII encryption algorithm", default: "AES-256-GCM" }
      ]
    })
  },
  {
    id: "documentation-standards",
    name: "Documentation & Code Style",
    description: "Guidelines governing code comments, docstring standards, API docs, and markdown formatting.",
    category: "documentation" as const,
    configPayload: JSON.stringify({
      rules: [
        "Write full JSDoc blocks for all exported server actions and API controllers.",
        "Maintain a comprehensive README.md detailing local setup, scripts, and environment variables.",
        "Document code blocks containing non-obvious optimizations or custom algorithms with inline comments.",
        "API endpoints must be documented using OpenAPI schemas."
      ],
      variables: []
    })
  }
];

function findD1SqlitePaths() {
  const paths = [];
  const searchDirs = [
    "./.wrangler/state/v3/d1/miniflare-D1DatabaseObject",
    "./dist/server/.wrangler/state/v3/d1/miniflare-D1DatabaseObject"
  ];

  for (const dir of searchDirs) {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (file.endsWith(".sqlite") && file !== "metadata.sqlite") {
          paths.push(path.join(dir, file));
        }
      }
    }
  }

  return paths;
}

async function seedLocal() {
  const dbPaths = findD1SqlitePaths();
  if (dbPaths.length === 0) {
    console.warn("⚠️ No wrangler D1 SQLite databases found. Please make sure wrangler dev or local migrations have run.");
    return;
  }

  console.log(`Found ${dbPaths.length} local database(s) to seed.`);
  const createdAt = Math.floor(Date.now() / 1000);

  for (const dbPath of dbPaths) {
    console.log(`Seeding database: ${dbPath}`);
    try {
      const sqlite = new DatabaseSync(dbPath);
      const db = drizzle(async (sql, params, method) => {
        const stmt = sqlite.prepare(sql);
        if (method === "run") {
          stmt.run(...params);
          return { rows: [] };
        }
        if (method === "get") {
          const row = stmt.get(...params);
          return { rows: row ? Object.values(row) : [] };
        }
        const res = stmt.all(...params);
        return { rows: res.map((r) => Object.values(r)) };
      });

      for (const template of templates) {
        await db.insert(memoryTemplates)
          .values({
            id: template.id,
            name: template.name,
            description: template.description,
            category: template.category,
            configPayload: template.configPayload,
            createdAt,
          })
          .onConflictDoUpdate({
            target: memoryTemplates.id,
            set: {
              name: template.name,
              description: template.description,
              category: template.category,
              configPayload: template.configPayload,
            }
          });
      }

      console.log(`✅ Successfully seeded: ${dbPath}`);
    } catch (err) {
      console.error(`❌ Failed to seed database at ${dbPath}:`, err);
    }
  }
}

function generateRemoteCommand() {
  console.log("\n--- REMOTE SEED COMMANDS ---");
  const createdAt = Math.floor(Date.now() / 1000);

  for (const template of templates) {
    const escapedConfig = template.configPayload.replace(/'/g, "''");
    const sql = `INSERT INTO memory_templates (id, name, description, category, config_payload, created_at) VALUES ('${template.id}', '${template.name}', '${template.description}', '${template.category}', '${escapedConfig}', ${createdAt}) ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, category=excluded.category, config_payload=excluded.config_payload;`;
    console.log(`npx wrangler d1 execute locker-db --remote --command="${sql.replace(/"/g, '\\"')}"`);
  }
  console.log("----------------------------\n");
}

async function main() {
  await seedLocal();
  generateRemoteCommand();
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
