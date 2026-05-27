# Locker 🔒

**Locker** is a modern, premium long-term memory vault and Model Context Protocol (MCP) server. It acts as a centralized repository for personal context, developer guidelines, project states, and background references, designed to bridge the gap between different AI assistants (such as Claude, ChatGPT, Gemini, Perplexity, and Grok).

With Locker, you can import, manage, search, and delete personal memories via a beautiful, responsive web interface, and seamlessly expose those memories to your AI agents via an integrated MCP server endpoint.

---

## 🚀 Tech Stack

Locker is built using a modern, high-performance Cloudflare-native stack:

*   **Framework**: [TanStack Start](https://tanstack.com/router/latest/docs/start/overview) (utilizing Vite and SSR on Cloudflare Pages)
*   **Routing & State**: [TanStack Router](https://tanstack.com/router) & [TanStack Query (React Query)](https://tanstack.com/query)
*   **Frontend**: React 19 with Vanilla CSS for customized, premium styling
*   **Database**: Cloudflare D1 (Serverless SQLite Database)
*   **ORM**: [Drizzle ORM](https://orm.drizzle.team/)
*   **Vector Database**: Cloudflare Vectorize (for high-speed semantic search)
*   **AI Integration**: Cloudflare Workers AI
    *   `@cf/baai/bge-m3` — Text embedding generation
    *   `@cf/meta/llama-3.3-70b-instruct-fp8-fast` — Memory extraction & categorization
*   **Protocol Integration**: Model Context Protocol (MCP) server endpoints

---

## ✨ Key Features

1.  **AI-Powered Bulk Ingest**:
    *   Paste raw conversation exports or unstructured logs from ChatGPT, Claude, Gemini, Perplexity, Grok, etc.
    *   Locker parses, cleans, and extracts discrete factual statements and classifies them into structured categories (`rules`, `projects`, `references`) using Llama 3.3.
2.  **Advanced Deduplication Engine**:
    *   **Intra-batch Deduplication**: Compares embeddings of incoming memories using high-performance cosine similarity math to filter out duplicates in a single ingest batch.
    *   **Cross-Reference Deduplication**: Queries Cloudflare Vectorize to find existing similar memories.
    *   **Orphan Prevention**: Cross-references Vectorize matches against the SQLite D1 database. If a vector exists in Vectorize but the corresponding D1 record is missing (e.g., after database clears), it is treated as an orphan rather than a duplicate, preventing false-positive skips during import.
3.  **Model Context Protocol (MCP) Server**:
    *   Exposes a native JSON-RPC MCP endpoint at `/api/mcp` for agent integration.
    *   Supported tools:
        *   `recall_context`: Semantic search over stored long-term memory ranking facts by cosine similarity.
        *   `commit_memory`: Persists a new fact into D1 and Vectorize in real-time.
4.  **Admin Operations Panel**:
    *   Real-time database vs vector count statistics.
    *   Automatic orphaned record detection (D1 records missing vector index counterparts).
    *   Destructive maintenance operations: Clear Vectorize only, Clear DB only, or full system nuke.

---

## 🛠️ Getting Started

### Prerequisites

*   Node.js (v18+)
*   npm or pnpm
*   Cloudflare Wrangler CLI (installed automatically as dev dependency)

### Installation

1.  Clone the repository and navigate to the project folder:
    ```bash
    git clone https://github.com/rogerleecormier/locker.git
    cd locker/locker
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```

### Local Development

1.  Initialize the local D1 SQLite database and apply migrations:
    ```bash
    npm run db:migrate:local
    ```
2.  Start the local dev server:
    ```bash
    npm run dev
    ```
    This launches the local Vite dev server. Open the displayed local address (typically `http://localhost:3000`) in your browser.

3.  Alternatively, run the app using wrangler dev:
    ```bash
    npm run start
    ```

---

## 📜 Available Scripts

Below is a reference of the npm scripts defined in `package.json`:

*   `npm run dev` — Start the Vite dev server for local UI development.
*   `npm run build` — Build the application for production.
*   `npm run start` — Run a local worker environment using Wrangler.
*   `npm run deploy` — Build the application and deploy it live to Cloudflare Pages.
*   `npm run db:generate` — Generate Drizzle migrations after schema changes.
*   `npm run db:migrate:local` — Apply migrations to your local D1 database.
*   `npm run db:migrate:remote` — Apply migrations to your production Cloudflare D1 database.
*   `npm run db:studio` — Open Drizzle Studio to inspect and edit your local database.
*   `npm run typecheck` — Perform typescript compilation checks across all files.

---

## 🔒 Security & Privacy

Since Locker runs entirely on your own Cloudflare account (using your own D1 instance, Vectorize index, and Workers AI models), your personal memories and preferences remain strictly private to you. No third-party APIs or external vector databases are used.
