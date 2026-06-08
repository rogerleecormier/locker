# Locker

**AI-powered long-term memory vault and MCP server — running entirely on your own Cloudflare account.**

Locker gives your AI assistants persistent, searchable memory. Connect Claude, ChatGPT, Gemini, Perplexity, or Grok to a shared vault of personal context, developer guidelines, project state, and background references — all stored in infrastructure you own.

---

## Features

- **MCP Server** — Exposes `recall_context`, `commit_memory`, `update_memory`, `delete_memory`, and `sync_workspace_agent_configs` tools over JSON-RPC 2.0
- **AI Bulk Ingest** — Paste raw conversation exports; Llama 3.3 70B extracts discrete facts and categorizes them automatically
- **Semantic Search** — Cosine similarity ranking via Cloudflare Vectorize with deduplication across both ingest batches and existing vault entries
- **Memory Lifecycle** — Versioning, staleness tracking, archival, soft/hard delete, and quarantine for suspicious entries
- **Envelope Encryption** — Sensitive memories encrypted at rest with AES-256
- **DLP Scanning** — Data loss prevention for secrets and PII
- **Graph RAG** — Automatic knowledge graph extraction (nodes + edges) during memory ingest
- **Multi-tenant Orgs** — Role-based access, JIT elevated access with approval queue, full audit logging
- **2FA** — TOTP with backup codes
- **API Token Scoping** — Per-tool permissions via bitmask
- **Billing** — Stripe-backed plans with usage metering and feature gating
- **CLI Tool** — `locker-sync` syncs agent config files (CLAUDE.md, .cursorrules, copilot-instructions.md, etc.) from vault to workspace
- **Admin Panel** — DB vs vector count stats, orphan detection, and maintenance operations
- **Self-hosted** — All data stays on your Cloudflare account; no third-party APIs for embeddings or inference

---

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript 6 |
| Framework | React 19 + TanStack Start (SSR) |
| Routing | TanStack Router (file-based) |
| Styling | Tailwind CSS 4 + shadcn/ui |
| Database | Cloudflare D1 (SQLite) |
| ORM | Drizzle ORM |
| Vector DB | Cloudflare Vectorize |
| AI | Cloudflare Workers AI (`bge-m3` embeddings, Llama 3.3 70B inference) |
| Auth | Better Auth |
| Hosting | Cloudflare Pages + Workers |
| Payments | Stripe |
| Async | Cloudflare Queues |
| Build | Vite |
| Testing | Vitest + Testing Library |

---

## Project Structure

```
locker/
├── app/                    # Main web app + MCP server
│   ├── src/
│   │   ├── db/             # Drizzle schema
│   │   ├── server/         # Auth, billing, crypto, memory CRUD, DLP, Graph RAG
│   │   ├── routes/         # TanStack Router pages + API routes
│   │   ├── components/     # React components (shadcn/ui)
│   │   ├── lib/            # Shared utilities
│   │   └── scheduled/      # Cron job handlers
│   ├── drizzle/
│   │   └── migrations/     # 35+ SQL migrations
│   ├── wrangler.json       # Cloudflare Workers config
│   └── vite.config.ts
├── cli/                    # locker-sync CLI tool
│   ├── bin/locker.mjs
│   └── lib/
└── package.json            # Monorepo workspace root
```

---

## Prerequisites

- [Node.js](https://nodejs.org) 20+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm install -g wrangler`)
- A Cloudflare account with:
  - D1 database created
  - Vectorize index created
  - Workers AI enabled
- A Stripe account (required only if billing is enabled)

---

## Getting Started

### 1. Clone and install

```bash
git clone https://github.com/rogerleecormier/locker.git
cd locker
npm install
```

### 2. Create Cloudflare resources

```bash
# Create D1 database
npm run cf:d1:create

# Create Vectorize index
npm run cf:vectorize:create
```

Update `app/wrangler.json` with the IDs returned by these commands.

### 3. Configure environment

Copy the example files and fill in your values:

```bash
cp .env.example .env
```

**`.env`** (Cloudflare credentials for migrations):
```
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_DATABASE_ID=
CLOUDFLARE_D1_TOKEN=
```

**`app/.dev.vars`** (local dev secrets):
```
ENCRYPTION_KEY=          # 32-byte hex string for AES-256
BETTER_AUTH_SECRET=      # Base64 secret for JWT signing
BETTER_AUTH_URL=http://localhost:5173
ADMIN_USER_ID=           # Your user ID after first sign-in
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

### 4. Apply database migrations

```bash
npm run db:migrate:local
```

### 5. Run locally

```bash
# Vite dev server — fast HMR, recommended for UI development
npm run dev
# → http://localhost:5173

# Wrangler dev — full Cloudflare emulation (D1, Vectorize, KV, Queues)
npm run start
```

---

## MCP Server Setup

The MCP endpoint is available at `/api/mcp`. To connect an AI client:

1. Sign in to Locker and generate an API token under **Settings → API Tokens**
2. Add the endpoint to your AI client's MCP configuration:

```json
{
  "mcpServers": {
    "locker": {
      "url": "https://your-deployment.pages.dev/api/mcp",
      "headers": {
        "Authorization": "Bearer <your-api-token>"
      }
    }
  }
}
```

**Available tools:**

| Tool | Description |
|---|---|
| `recall_context` | Semantic search ranked by cosine similarity |
| `commit_memory` | Persist a new fact to D1 and Vectorize |
| `update_memory` | Modify an existing memory |
| `delete_memory` | Soft or hard delete |
| `sync_workspace_agent_configs` | Compile and push agent config files to a workspace |

**Tested clients:** Claude (Web, Extension, CLI), ChatGPT, Antigravity 2.0

---

## CLI Tool

`locker-sync` syncs agent config files from your vault to any workspace.

### Install

```bash
npm install -D locker-sync
```

### Usage

```bash
npx locker-sync sync                            # → .cursorrules (default)
npx locker-sync sync --format claude            # → CLAUDE.md
npx locker-sync sync --format copilot           # → .github/copilot-instructions.md
npx locker-sync sync --format gemini            # → GEMINI.md
npx locker-sync sync --format agents            # → AGENTS.md
npx locker-sync sync --format antigravity       # → .agents/rules/rules.md
npx locker-sync sync --format claude --dry-run  # Preview without writing
```

On first run, you'll be prompted for your Locker API token, which is saved to `~/.locker/config.json`.

---

## Available Scripts

```bash
# Development
npm run dev                  # Vite dev server
npm run start                # Wrangler dev (full CF emulation)

# Build & Deploy
npm run build                # Production build
npm run deploy               # Build + deploy to Cloudflare Pages

# Database
npm run db:generate          # Generate Drizzle migration files
npm run db:migrate:local     # Apply migrations to local D1
npm run db:migrate:remote    # Apply migrations to production D1
npm run db:studio            # Open Drizzle Studio (visual DB browser)

# Cloudflare Resources
npm run cf:d1:create         # Create D1 database
npm run cf:vectorize:create  # Create Vectorize index

# Code Quality
npm run typecheck            # TypeScript validation
npm run test                 # Run all tests
npm run lint                 # ESLint check
npm run format               # Prettier format
npm run format:check         # Check formatting without writing

# CLI
npm run cli                  # Run locker-sync CLI
```

---

## Database Migrations

Schema changes follow this workflow:

```bash
# 1. Edit app/src/db/schema.ts
# 2. Generate a new migration
npm run db:generate

# 3. Apply and test locally
npm run db:migrate:local
npm run test

# 4. Apply to production
npm run db:migrate:remote
```

---

## Testing

```bash
npm run test          # Run all tests
npm run test:watch    # Watch mode
```

Test coverage includes: MCP operations, billing/Stripe, encryption, DLP, enterprise/audit features, Graph RAG, plan gating, input sanitization, text chunking, TOTP, and webhooks.

---

## Deployment

```bash
npm run deploy
```

This builds the TanStack Start app with Vite and deploys to Cloudflare Pages via Wrangler. A daily cron trigger runs at 02:00 UTC for cleanup and archival tasks.

Make sure production secrets are set in your Cloudflare dashboard under **Workers & Pages → Settings → Environment Variables** before deploying.

---

## Security

- All data lives on your own Cloudflare account
- Sensitive memories use envelope encryption (AES-256)
- Embeddings and LLM inference run on Cloudflare Workers AI — no external API calls
- DLP scanning flags secrets and PII before storage
- API tokens support per-tool permission scoping via bitmask
- Full audit log of all operations stored in D1
- TOTP 2FA with backup codes
- JIT access with admin approval queue for elevated operations

---

## License

Locker is licensed under the **Functional Source License 1.1 (FSL-1.1)**. 

- **For Developers:** You are free to view, fork, audit, and self-host Locker for personal or internal development use.
- **For Businesses:** You cannot use this code to host a competing commercial context-locking or AI memory service. 
- **Future Open Source:** This version automatically becomes fully open-source (Apache 2.0) on June 8, 2028.
