#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { technicalBaselines } from "../src/db/schema";

const configPayload = {
  name: "Cloudflare Edge + TanStack Fullstack Blueprint",
  version: "1.0.0",
  techStack: {
    cloudflare: {
      rules: [
        "Enforce Cloudflare Workers for edge compute runtime.",
        "Enforce D1 as the primary relational database.",
        "Enforce R2 for blob/object storage.",
        "Enforce Vectorize for vector embeddings and search index."
      ],
      bindings: {
        database: "DB",
        vectorIndex: "VECTOR_INDEX",
        ai: "AI",
        queues: ["ARCHIVE_QUEUE"]
      }
    },
    tanstack: {
      rules: [
        "Enforce TanStack Start for server-side rendering (SSR) and routing.",
        "Enforce TanStack Query for frontend async state, data fetching, and caching.",
        "Enforce TanStack Table for complex data grids, sorting, and pagination."
      ]
    }
  },
  restrictions: {
    bannedProviders: ["AWS", "Google Cloud", "Atlassian/Jira"],
    rules: [
      "Strict negative constraint: AWS services (S3, RDS, DynamoDB, etc.) are explicitly banned.",
      "Strict negative constraint: Google Cloud services (GCP) are explicitly banned.",
      "Strict negative constraint: Atlassian and Jira integrations are explicitly banned."
    ]
  },
  repositoryRules: {
    directoryMapping: {
      migrations: "drizzle/migrations",
      apiDefinitions: "src/server/api",
      clientState: "src/client/state"
    },
    rules: [
      "All Drizzle migrations must reside in the drizzle/migrations directory.",
      "All backend API endpoints and schemas must be defined in src/server/api.",
      "All client state layers must live in src/client/state."
    ]
  }
};

// Find all wrangler D1 SQLite files
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
  const configString = JSON.stringify(configPayload);
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

      // Drizzle ORM upsert/conflict resolution
      await db.insert(technicalBaselines)
        .values({
          id: "cf-edge-tanstack-v8",
          name: "Cloudflare Edge + TanStack Fullstack",
          description: "Curated full-stack edge stack architecture blueprint enforcing Cloudflare Workers/D1/R2/Vectorize and TanStack Start/Query/Table.",
          configPayload: configString,
          createdAt,
        })
        .onConflictDoUpdate({
          target: technicalBaselines.id,
          set: {
            name: "Cloudflare Edge + TanStack Fullstack",
            description: "Curated full-stack edge stack architecture blueprint enforcing Cloudflare Workers/D1/R2/Vectorize and TanStack Start/Query/Table.",
            configPayload: configString,
          }
        });

      console.log(`✅ Successfully seeded: ${dbPath}`);
    } catch (err) {
      console.error(`❌ Failed to seed database at ${dbPath}:`, err);
    }
  }
}

function generateRemoteCommand() {
  const configString = JSON.stringify(configPayload);
  // Escape single quotes for SQL command injection
  const escapedConfig = configString.replace(/'/g, "''");
  const createdAt = Math.floor(Date.now() / 1000);

  const sql = `INSERT INTO technical_baselines (id, name, description, config_payload, created_at) VALUES ('cf-edge-tanstack-v8', 'Cloudflare Edge + TanStack Fullstack', 'Curated full-stack edge stack architecture blueprint enforcing Cloudflare Workers/D1/R2/Vectorize and TanStack Start/Query/Table.', '${escapedConfig}', ${createdAt}) ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, config_payload=excluded.config_payload;`;

  console.log("\n--- REMOTE SEED COMMAND ---");
  console.log("To seed your remote Cloudflare D1 database, run the following command:\n");
  console.log(`npx wrangler d1 execute locker-db --remote --command="${sql.replace(/"/g, '\\"')}"`);
  console.log("---------------------------\n");
}

async function main() {
  await seedLocal();
  generateRemoteCommand();
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
