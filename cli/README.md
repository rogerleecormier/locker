# locker-sync

> Sync authoritative stack rules and agent config files from your [Locker](https://locker.rcormier.dev) vault directly to your local workspace.

---

## What it does

`locker-sync` calls the `sync_workspace_agent_configs` tool on your Locker MCP server and writes the compiled rules file to the correct path in your project. No database access, no local server — it authenticates over HTTPS using your Locker API token.

**Supported output formats:**

| Flag value     | File written                           | Target IDE / Agent          |
|----------------|----------------------------------------|-----------------------------|
| `cursor`       | `.cursorrules`                         | Cursor Editor               |
| `claude`       | `CLAUDE.md`                            | Claude Code CLI / Extension |
| `copilot`      | `.github/copilot-instructions.md`      | GitHub Copilot Chat         |
| `gemini`       | `GEMINI.md`                            | Gemini Code Assist          |
| `agents`       | `AGENTS.md`                            | OpenAI Codex / General      |
| `antigravity`  | `.agents/rules/rules.md`               | Google Antigravity          |

---

## Quick Start

```bash
# Sync .cursorrules to your current workspace
npx locker-sync sync

# Sync CLAUDE.md for a specific project scope
npx locker-sync sync --format claude --project my-project-key

# Preview what would be written without touching disk
npx locker-sync sync --format gemini --dry-run
```

---

## Authentication

On first run, the CLI will prompt you for your Locker API token.  
Generate one at: **Settings → API Tokens** in your Locker dashboard.

Token resolution order:

1. `--token` flag
2. `LOCKER_API_TOKEN` environment variable
3. `~/.locker/config.json` (saved on first interactive login)
4. Interactive readline prompt (saves to config file automatically)

### Saving a token manually

```json
// ~/.locker/config.json  (created automatically or manually)
{
  "token": "lkr_your_token_here"
}
```

---

## All Options

```
locker sync [options]

Options:
  --format, -f    Output format (default: cursor)
                  Choices: cursor | claude | copilot | gemini | agents | antigravity

  --project, -p   Project workspace key (default: personal scope)
                  Examples: "locker", "org:my-org-id", "team:my-team-id"

  --host          Locker API base URL
                  Default: https://locker.rcormier.dev

  --token         API token (overrides LOCKER_API_TOKEN and config file)

  --dry-run       Print what would be written without touching disk

  --help, -h      Show this help message
```

---

## Git Pre-Commit Hook

Keep agent config files always in sync before every commit.

**`.git/hooks/pre-commit`** (make executable with `chmod +x .git/hooks/pre-commit`):

```sh
#!/bin/sh
# Sync Locker rules before committing
npx locker-sync sync --format cursor --project "${LOCKER_PROJECT_KEY:-}"
```

Or use it with [husky](https://typicode.github.io/husky/):

```bash
npx husky add .husky/pre-commit "npx locker-sync sync --format cursor"
```

---

## Environment Variables

| Variable              | Description                              |
|-----------------------|------------------------------------------|
| `LOCKER_API_TOKEN`    | Your Locker API token (`lkr_...`)        |
| `LOCKER_HOST`         | Override default host (optional)         |

---

## Pointing at a local dev server

```bash
npx locker-sync sync \
  --host http://localhost:5173 \
  --token lkr_your_local_token \
  --format cursor
```

---

## How it works

Under the hood, `locker-sync` sends a single JSON-RPC 2.0 request to your Locker server's `/api/mcp` endpoint:

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "sync_workspace_agent_configs",
    "arguments": {
      "formatType": "cursor",
      "projectKey": "my-project"
    }
  }
}
```

The server queries your D1 database for all active `stack` category memories (plus any memories tagged `#architecture`, `#baseline`, `#stack`, or `#blueprint`), compiles them into the requested format, and returns the file content and target path. The CLI writes the file to disk relative to your current working directory.

---

## License

ISC
