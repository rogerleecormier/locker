import { createFileRoute } from "@tanstack/react-router";
import { useState, useCallback, useMemo } from "react";
import { ALL_TOOLS } from "./-_api.mcp";
import { useSession } from "~/lib/authClient";
import { PLATFORM_GROUPS, PLATFORMS } from "../lib/platforms";

export const Route = createFileRoute("/docs")({
  component: DocsPage,
});

function CopyIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

type SetupService = {
  id: string;
  label: string;
  color: string;
  group: "Anthropic" | "OpenAI" | "Google" | "VS Code" | "Editors" | "Other";
  description: string;
  instructions: React.ReactNode;
  copyText?: string;
  tested?: boolean;
};

function DocsPage() {
  const [activeSection, setActiveSection] = useState<string>("overview");
  const [searchQuery, setSearchQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<{status: 'success' | 'error'; message: string} | null>(null);
  const { data: session } = useSession();

  const origin = typeof window === "undefined" ? "https://locker.rcormier.dev" : window.location.origin;

  const SERVICES: SetupService[] = useMemo(() => [
    {
      id: "claudedesktop",
      label: "Claude Desktop",
      color: "#d4956a",
      group: "Anthropic",
      description: "Connect the Claude Desktop app to Locker via its own MCP config file. Claude Desktop has a separate config from Claude Code CLI and Claude (Web) — it must be configured independently.",
      copyText: `{
  "mcpServers": {
    "locker": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "${origin}/api/mcp",
        "--header",
        "Authorization: Bearer \${LOCKER_TOKEN}"
      ],
      "env": {
        "LOCKER_TOKEN": "lkr_your_token_here"
      }
    }
  }
}`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ background: "rgba(212,149,106,0.08)", border: "1px solid rgba(212,149,106,0.25)", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#d4956a" }}>
            <strong>Independent config:</strong> Claude Desktop uses its own <code>claude_desktop_config.json</code> file and does not share MCP configuration with Claude Code CLI or Claude (Web). If you also use Claude Code, you must add Locker there separately.
          </div>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Admin → API Tokens</strong> and generate a new token. Copy it — it's shown only once.</li>
            <li>Open <code>claude_desktop_config.json</code>:
              <ul style={{ paddingLeft: 20, marginTop: 4, marginBottom: 4 }}>
                <li>Linux / macOS: <code>~/.config/Claude/claude_desktop_config.json</code></li>
                <li>Windows: <code>%APPDATA%\Claude\claude_desktop_config.json</code></li>
              </ul>
            </li>
            <li>Add the <code>locker</code> block (copy snippet below) into <code>mcpServers</code>, replacing <code>lkr_your_token_here</code> with your token.</li>
            <li>Fully restart Claude Desktop. The Locker tools will appear in your chats.</li>
          </ol>
        </div>
      ),
    },
    {
      id: "claudecli",
      label: "Claude Code CLI",
      color: "#9c6f3d",
      group: "Anthropic",
      tested: true,
      description: "Connect Locker to Claude Code CLI. If you are logged into the CLI with your claude.ai account, MCP Connectors you set up in Claude (Web) are automatically available here — no extra setup needed. Use this command only to add servers not already in your claude.ai Connectors. Fully tested and working.",
      copyText: `claude mcp add --transport http locker ${origin}/api/mcp --header "Authorization: Bearer lkr_your_token_here"`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#22c55e" }}>
            <strong>Check first:</strong> If Claude Code is logged in with your claude.ai account, MCP Connectors configured in <strong>Claude (Web)</strong> are already inherited automatically — including Locker if you set it up there. Run <code>claude mcp list</code> to confirm before adding it again manually.
          </div>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Run <code>claude mcp list</code>. If <code>claude.ai Locker</code> already appears, you're done — skip the steps below.</li>
            <li>If Locker is not listed, go to <strong>Admin → API Tokens</strong> and generate a new token. Copy it — it's shown only once.</li>
            <li>Run the command below in your terminal, replacing <code>lkr_your_token_here</code> with your token.</li>
            <li>The default scope is <code>local</code> (project-level). Use <code>--scope user</code> to register globally across all projects. Use <code>--scope project</code> to write a shareable <code>.mcp.json</code> at the project root.</li>
          </ol>
        </div>
      ),
    },
    {
      id: "claudecode",
      label: "Claude Code Extension",
      color: "#c97b53",
      group: "Anthropic",
      tested: true,
      description: "The Claude Code VS Code, JetBrains, and Antigravity IDE extensions share the same account session as the CLI. If you connected Locker via Claude (Web) OAuth, it is automatically available in all Claude Code surfaces — no extra config needed. Fully tested and working.",
      copyText: `claude mcp add --transport http locker ${origin}/api/mcp --header "Authorization: Bearer lkr_your_token_here"`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ background: "rgba(168,85,247,0.06)", border: "1px solid rgba(168,85,247,0.2)", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "var(--accent)" }}>
            <strong>Inherits from claude.ai account:</strong> Claude Code extensions are authenticated via your claude.ai OAuth session. MCP Connectors you set up in <strong>Claude (Web)</strong> — including Locker — are automatically surfaced in the VS Code, JetBrains, and Antigravity IDE extensions without any additional configuration.
          </div>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Use <code>/mcp</code> in the extension chat panel to check if <code>claude.ai Locker</code> already appears. If it does, you're done.</li>
            <li>If Locker is not listed, it means it hasn't been connected via Claude (Web) yet — see the <strong>Claude (Web)</strong> setup guide to do that first.</li>
            <li>Alternatively, register Locker directly via the CLI using the command below (requires an API token from <strong>Admin → API Tokens</strong>). Use <code>--scope user</code> to make it available across all projects and all Claude Code surfaces.</li>
          </ol>
          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
            This applies to all Claude Code IDE surfaces: <strong>VS Code</strong>, <strong>JetBrains</strong> (IntelliJ, WebStorm, etc.), and <strong>Antigravity IDE</strong> — they all share the same claude.ai account session.
          </p>
        </div>
      ),
    },
    {
      id: "claudeweb",
      label: "Claude (Web)",
      color: "#b85c38",
      group: "Anthropic",
      tested: true,
      description: "Connect claude.ai to Locker via the Connectors feature. Uses OAuth — no API token needed. Once connected, Locker is also automatically available in Claude Code CLI and all Claude Code IDE extensions (VS Code, JetBrains, Antigravity) via your shared account session. Requires a Claude Pro, Team, or Enterprise plan.",
      copyText: `${origin}/api/mcp`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ background: "rgba(184,92,56,0.06)", border: "1px solid rgba(184,92,56,0.25)", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#fb923c" }}>
            <strong>Shared via account session:</strong> Claude Code CLI and all Claude Code IDE extensions (VS Code, JetBrains, Antigravity) are authenticated with your claude.ai account. MCP Connectors set up here are automatically inherited by those clients — connecting Locker here is the easiest way to get it everywhere.
          </div>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Open <strong>claude.ai</strong> → click your profile avatar → <strong>Settings → Connectors → Add connector</strong>.</li>
            <li>Enter a name (e.g. <code>Locker</code>) and paste the server URL below.</li>
            <li>Claude will redirect you to Locker to sign in and approve access via OAuth — no API token needed.</li>
            <li>Once authorized, Locker tools are available in claude.ai chats, and automatically in Claude Code CLI and all Claude Code IDE extensions.</li>
          </ol>
        </div>
      ),
    },
    {
      id: "cursor",
      label: "Cursor",
      color: "#00e5ff",
      group: "VS Code",
      description: "Access Locker memory in Cursor's Composer or Chat panels.",
      copyText: `npx -y mcp-remote ${origin}/api/mcp --header "Authorization: Bearer lkr_your_token_here"`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Admin → API Tokens</strong> and generate a new token.</li>
            <li>Open Cursor Settings → <strong>Features &gt; MCP</strong> → <strong>+ Add New MCP Server</strong>.</li>
            <li>Set Name to <code>locker</code>, Type to <code>command</code>, paste the command below replacing <code>lkr_your_token_here</code> with your token.</li>
            <li>Click <strong>Save</strong> and verify the indicator turns green.</li>
          </ol>
        </div>
      ),
    },
    {
      id: "cline",
      label: "Cline",
      color: "#ff6b6b",
      group: "VS Code",
      description: "Enable your Cline assistant to recall technical rules and context inside VS Code.",
      copyText: `{
  "mcpServers": {
    "locker": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "${origin}/api/mcp",
        "--header",
        "Authorization: Bearer \${LOCKER_TOKEN}"
      ],
      "env": {
        "LOCKER_TOKEN": "lkr_your_token_here"
      }
    }
  }
}`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Admin → API Tokens</strong> and generate a new token.</li>
            <li>Open <code>cline_mcp_settings.json</code> (at <code>~/.vscode/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json</code>).</li>
            <li>Add the <code>locker</code> block (copy snippet below) into <code>mcpServers</code>, replacing <code>lkr_your_token_here</code> with your token.</li>
            <li>Cline will reload and gain access to the memory tools.</li>
          </ol>
        </div>
      ),
    },
    {
      id: "kilocode",
      label: "Kilo Code",
      color: "#f59e0b",
      group: "VS Code",
      description: "Connect Kilo Code to Locker using Kilo Code's native remote (HTTP) MCP transport.",
      copyText: `{
  "mcp": {
    "locker": {
      "type": "remote",
      "url": "${origin}/api/mcp",
      "headers": {
        "Authorization": "Bearer lkr_your_token_here"
      },
      "enabled": true
    }
  }
}`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Admin → API Tokens</strong> and generate a new token.</li>
            <li><strong>Option A (UI):</strong> Open the settings panel in the Kilo Code sidebar → <strong>Agent Behaviour → MCP Servers</strong>. Add a new server with type <code>remote</code>, name <code>locker</code>, URL <code>{origin}/api/mcp</code>, and add the header <code>Authorization: Bearer lkr_your_token_here</code>.</li>
            <li><strong>Option B (Manual):</strong> Create or edit <code>.kilocode/mcp.json</code> at your project root, or globally at <code>~/.config/kilo/kilo.json</code>. Add the JSON configuration snippet below, replacing <code>lkr_your_token_here</code> with your token.</li>
            <li>Save the file or click the refresh button in the settings panel to activate the server.</li>
          </ol>
        </div>
      ),
    },
    {
      id: "continue",
      label: "Continue",
      color: "#2f80ed",
      group: "VS Code",
      description: "Integrate personal memory context inside the Continue code assistant in VS Code or JetBrains.",
      copyText: `"mcp": {
  "locker": {
    "command": "npx",
    "args": [
      "-y",
      "mcp-remote",
      "${origin}/api/mcp",
      "--header",
      "Authorization: Bearer \${LOCKER_TOKEN}"
    ],
    "env": {
      "LOCKER_TOKEN": "lkr_your_token_here"
    }
  }
}`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Admin → API Tokens</strong> and generate a new token.</li>
            <li>Open <code>~/.continue/config.json</code>.</li>
            <li>Paste the snippet below inside the top-level <code>mcp</code> object, replacing <code>lkr_your_token_here</code> with your token.</li>
            <li>Save — Continue activates the tools automatically.</li>
          </ol>
        </div>
      ),
    },
    {
      id: "copilot",
      label: "GitHub Copilot",
      color: "#6f42c1",
      group: "VS Code",
      description: "Connect GitHub Copilot Chat in VS Code to Locker. VS Code MCP servers defined in .vscode/mcp.json are shared — GitHub Copilot and VS Code agent mode both read from the same file.",
      copyText: `{
  "servers": {
    "locker": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "${origin}/api/mcp",
        "--header",
        "Authorization: Bearer \${LOCKER_TOKEN}"
      ],
      "env": {
        "LOCKER_TOKEN": "lkr_your_token_here"
      }
    }
  }
}`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ background: "rgba(111,66,193,0.06)", border: "1px solid rgba(111,66,193,0.2)", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#a78bfa" }}>
            <strong>Shared with VS Code:</strong> MCP servers defined in <code>.vscode/mcp.json</code> (workspace-scoped) or VS Code's <code>settings.json</code> (user-scoped) are available to both GitHub Copilot Chat and VS Code's native agent mode. Configure it once and both use it.
          </div>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Admin → API Tokens</strong> and generate a new token.</li>
            <li><strong>Option A (User-scoped):</strong> Open VS Code Settings → search <strong>MCP</strong> → click <strong>Edit in settings.json</strong>, then add the snippet below under <code>mcp.servers</code>.</li>
            <li><strong>Option B (Workspace-scoped):</strong> Create or edit <code>.vscode/mcp.json</code> in your workspace root and add the snippet (see the VS Code entry for that format).</li>
            <li>Replace <code>lkr_your_token_here</code> with your token. Copilot Chat will fetch memory context when answering questions.</li>
          </ol>
        </div>
      ),
    },
    {
      id: "vscode",
      label: "VS Code",
      color: "#007acc",
      group: "VS Code",
      description: "Configure VS Code native MCP support via .vscode/mcp.json. This workspace file is shared — both VS Code agent mode and GitHub Copilot Chat read MCP servers from it.",
      copyText: `{
  "servers": {
    "locker": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "${origin}/api/mcp",
        "--header",
        "Authorization: Bearer \${LOCKER_TOKEN}"
      ],
      "env": {
        "LOCKER_TOKEN": "lkr_your_token_here"
      }
    }
  }
}`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ background: "rgba(0,122,204,0.06)", border: "1px solid rgba(0,122,204,0.2)", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#60a5fa" }}>
            <strong>Shared config:</strong> <code>.vscode/mcp.json</code> is the workspace-level VS Code MCP config. Both VS Code's native agent mode and GitHub Copilot Chat read from this same file — add Locker once and both tools have access.
          </div>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Admin → API Tokens</strong> and generate a new token.</li>
            <li>Create or edit <code>.vscode/mcp.json</code> in your workspace root.</li>
            <li>Paste the snippet below, replacing <code>lkr_your_token_here</code> with your token.</li>
            <li>VS Code will pick up the server on the next session start. Open the MCP panel (<strong>View → MCP Servers</strong>) to verify the connection.</li>
          </ol>
        </div>
      ),
    },
    {
      id: "codex_cli",
      label: "Codex CLI",
      color: "#0f9d58",
      group: "OpenAI",
      tested: true,
      description: "Connect the OpenAI Codex CLI to Locker via native HTTP MCP transport — no mcp-remote wrapper needed. Fully tested and working.",
      copyText: `[mcp_servers.locker]
url = "${origin}/api/mcp"
enabled = true
startup_timeout_ms = 10000

[mcp_servers.locker.headers]
Authorization = "Bearer lkr_your_token_here"`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <p style={{ margin: 0, color: "var(--text-muted)" }}>
            Locker acts as an independent AI memory layer hosted directly as a serverless Cloudflare Worker. Codex connects via Streamable HTTP.
          </p>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Admin → API Tokens</strong> and generate a new token.</li>
            <li>Locate your global Codex configuration file on your local machine:
              <ul style={{ paddingLeft: 20, marginTop: 4, marginBottom: 4 }}>
                <li>Windows: <code>C:\\Users\\&lt;YourUsername&gt;\\.codex\\config.toml</code></li>
                <li>macOS/Linux: <code>~/.codex/config.toml</code></li>
              </ul>
            </li>
            <li>Open the file in your preferred text editor.</li>
            <li>Append the configuration block below directly to the end of the file, replacing <code>lkr_your_token_here</code> with your token.</li>
            <li>Locker tools will be available in your next Codex session. Verify with <code>codex mcp list</code>.</li>
          </ol>
        </div>
      ),
    },
    {
      id: "codex_app",
      label: "Codex App",
      color: "#0c8a4f",
      group: "OpenAI",
      tested: true,
      description: "Connect the Codex desktop application (macOS/Windows) to Locker. Fully tested and confirmed.",
      copyText: `[mcp_servers.locker]
url = "${origin}/api/mcp"
enabled = true
startup_timeout_ms = 10000

[mcp_servers.locker.headers]
Authorization = "Bearer lkr_your_token_here"`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ margin: 0, color: "var(--text-muted)" }}>
            Locker acts as an independent AI memory layer hosted directly as a serverless Cloudflare Worker. Because it runs at the edge, Codex must connect using Streamable HTTP.
          </p>
          
          <div style={{ borderLeft: "2px solid var(--accent)", paddingLeft: 12, display: "flex", flexDirection: "column", gap: 4 }}>
            <strong style={{ color: "var(--text)" }}>Method 1: Configuration via Codex Desktop UI</strong>
            <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 3, margin: 0 }}>
              <li>Open the Codex Desktop Application and navigate to the <strong>MCP Server Settings</strong> panel.</li>
              <li>Select the option to add a new server, and choose <strong>HTTP / Remote</strong> as your connection type.</li>
              <li>Enter <code>{origin}/api/mcp</code> into the URL configuration field.</li>
              <li>Leave the <em>Bearer token env var</em> field completely blank.</li>
              <li>Navigate down to the Headers grid and click <strong>+ Add header</strong>.</li>
              <li>In the Key column, type <code>Authorization</code>.</li>
              <li>In the Value column, type the word <code>Bearer</code> followed by a single space, and then paste your literal Locker token (e.g., <code>Bearer lkr_23633dbc...</code>).</li>
              <li>Click <strong>Save</strong> in the bottom right corner of the application screen.</li>
            </ol>
          </div>

          <div style={{ borderLeft: "2px solid var(--accent)", paddingLeft: 12, display: "flex", flexDirection: "column", gap: 4 }}>
            <strong style={{ color: "var(--text)" }}>Method 2: Manual Configuration via config.toml (Recommended)</strong>
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>
              Because the Codex Windows app interface occasionally isolates active chat session configurations, writing directly to Codex's global configuration file ensures consistent context injection across both the CLI and Desktop clients.
            </p>
            <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 3, margin: 0 }}>
              <li>Locate your global Codex configuration file on your local machine:
                <ul style={{ paddingLeft: 20, marginTop: 2, marginBottom: 2 }}>
                  <li>Windows: <code>C:\\Users\\&lt;YourUsername&gt;\\.codex\\config.toml</code></li>
                  <li>macOS/Linux: <code>~/.codex/config.toml</code></li>
                </ul>
              </li>
              <li>Open the file in your preferred text editor.</li>
              <li>Append the configuration block below directly to the end of the file, replacing <code>lkr_your_token_here</code> with your token.</li>
              <li>Save and close the file.</li>
            </ol>
          </div>

          <div style={{ background: "rgba(168,85,247,0.04)", border: "1px solid rgba(168,85,247,0.15)", borderRadius: 6, padding: "10px 12px" }}>
            <strong style={{ color: "var(--accent)", display: "block", marginBottom: 4 }}>Verifying Connection State</strong>
            <ul style={{ paddingLeft: 16, display: "flex", flexDirection: "column", gap: 2, margin: 0, fontSize: 12 }}>
              <li>Fully close your Codex environment. On Windows, ensure you completely terminate the background engine via the system tray or Task Manager (<code>taskkill /f /im codex.exe</code>) before restarting.</li>
              <li>Open a fresh Codex desktop chat instance or a new terminal window.</li>
              <li>Type the <code>/mcp</code> system command into the chat container prompt.</li>
              <li>Verify that <code>locker</code> appears in the active servers list and that its tools are successfully exposed to the model's runtime context.</li>
            </ul>
          </div>
        </div>
      ),
    },
    {
      id: "codex_vscode",
      label: "Codex Extension",
      color: "#0a7a46",
      group: "OpenAI",
      tested: true,
      description: "Connect the official OpenAI Codex VS Code extension to Locker — same config.toml as the CLI and app. Fully tested and working.",
      copyText: `[mcp_servers.locker]
url = "${origin}/api/mcp"
enabled = true
startup_timeout_ms = 10000

[mcp_servers.locker.headers]
Authorization = "Bearer lkr_your_token_here"`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <p style={{ margin: 0, color: "var(--text-muted)" }}>
            Connect the official OpenAI Codex VS Code extension to Locker — same <code>config.toml</code> as the CLI and app.
          </p>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Admin → API Tokens</strong> and generate a new token.</li>
            <li>In the Codex extension sidebar, open the gear menu and select <strong>MCP settings → Open config.toml</strong>.</li>
            <li>Append the configuration block below directly to the end of the file, replacing <code>lkr_your_token_here</code> with your token.</li>
            <li>Save — the extension reads from the same <code>~/.codex/config.toml</code> as the CLI and app.</li>
          </ol>
        </div>
      ),
    },
    {
      id: "antigravity",
      label: "Antigravity 2.0",
      color: "#818cf8",
      group: "Google",
      tested: true,
      description: "Register the Locker memory server in the Antigravity 2.0 CLI using its native HTTP MCP transport.",
      copyText: `{
  "mcpServers": {
    "locker": {
      "serverUrl": "${origin}/api/mcp",
      "headers": {
        "Authorization": "Bearer lkr_your_token_here"
      }
    }
  }
}`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Admin → API Tokens</strong> and generate a new token.</li>
            <li>Open <code>~/.gemini/config/mcp_config.json</code> (create it if it doesn't exist).</li>
            <li>Add the <code>locker</code> block (copy snippet below) into <code>mcpServers</code>, replacing <code>lkr_your_token_here</code> with your token.</li>
            <li>The Antigravity agent will recall memories during task planning and execution.</li>
          </ol>
        </div>
      ),
    },
    {
      id: "antigravity_ide",
      label: "Antigravity 2.0 IDE",
      color: "#4f46e5",
      group: "Google",
      tested: true,
      description: "Register the Locker memory server in the Antigravity 2.0 VS Code or JetBrains extension — it shares the same config file as the CLI.",
      copyText: `{
  "mcpServers": {
    "locker": {
      "serverUrl": "${origin}/api/mcp",
      "headers": {
        "Authorization": "Bearer lkr_your_token_here"
      }
    }
  }
}`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Admin → API Tokens</strong> and generate a new token.</li>
            <li>Open <code>~/.gemini/config/mcp_config.json</code> — both the VS Code and JetBrains extensions read from this same file.</li>
            <li>Add the <code>locker</code> block (copy snippet below) into <code>mcpServers</code>, replacing <code>lkr_your_token_here</code> with your token.</li>
            <li>In the IDE, open the MCP panel (<strong>Manage MCP Servers</strong>) to verify the server appears and reconnect if needed.</li>
          </ol>
        </div>
      ),
    },
    {
      id: "windsurf",
      label: "Windsurf",
      color: "#06b6d4",
      group: "Editors",
      description: "Connect Windsurf (Codeium's AI IDE) to Locker via native HTTP MCP transport.",
      copyText: `{
  "mcpServers": {
    "locker": {
      "serverUrl": "${origin}/api/mcp",
      "headers": {
        "Authorization": "Bearer lkr_your_token_here"
      }
    }
  }
}`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Admin → API Tokens</strong> and generate a new token.</li>
            <li>Open <code>~/.codeium/windsurf/mcp_config.json</code> on macOS/Linux, or <code>%USERPROFILE%\\.codeium\\windsurf\\mcp_config.json</code> on Windows (create if it doesn't exist).</li>
            <li>Add the <code>locker</code> block (copy snippet below) into <code>mcpServers</code>, replacing <code>lkr_your_token_here</code> with your token.</li>
            <li>In Windsurf, go to <strong>Settings → Cascade → MCP</strong> to enable MCP and verify the server is connected.</li>
          </ol>
        </div>
      ),
    },
    {
      id: "gemini_code_assist",
      label: "Gemini Code Assist",
      color: "#1a73e8",
      group: "Google",
      description: "Connect the Gemini Code Assist VS Code or JetBrains extension to Locker (Standard/Enterprise tier required for agent mode).",
      copyText: `{
  "mcpServers": {
    "locker": {
      "httpUrl": "${origin}/api/mcp",
      "headers": {
        "Authorization": "Bearer lkr_your_token_here"
      }
    }
  }
}`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Admin → API Tokens</strong> and generate a new token.</li>
            <li>In VS Code, open <code>~/.gemini/settings.json</code>. In JetBrains, use <code>mcp.json</code> in your IDE config directory.</li>
            <li>Add the <code>locker</code> block (copy snippet below) into <code>mcpServers</code>, replacing <code>lkr_your_token_here</code> with your token.</li>
            <li>MCP requires <strong>Standard or Enterprise</strong> tier — agent mode is not available on the individual/free tier.</li>
          </ol>
        </div>
      ),
    },
    {
      id: "zed",
      label: "Zed",
      color: "#084cdf",
      group: "Editors",
      description: "Connect the Zed editor to Locker via native HTTP MCP transport. Zed uses context_servers instead of mcpServers.",
      copyText: `{
  "context_servers": {
    "locker": {
      "url": "${origin}/api/mcp",
      "headers": {
        "Authorization": "Bearer lkr_your_token_here"
      }
    }
  }
}`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Admin → API Tokens</strong> and generate a new token.</li>
            <li>Open Zed settings: <code>~/.config/zed/settings.json</code> on Linux, or via <strong>Zed → Settings</strong> on macOS.</li>
            <li>Add the <code>locker</code> block (copy snippet below) into <code>context_servers</code> (Zed uses this key instead of <code>mcpServers</code>), replacing <code>lkr_your_token_here</code> with your token.</li>
            <li>Or use the UI: open the Agent Panel (<code>Cmd+Shift+A</code>), click the menu → <strong>View Server Extensions → Add Custom Server</strong>.</li>
          </ol>
        </div>
      ),
    },
    {
      id: "amp",
      label: "Amp",
      color: "#ff4500",
      group: "Editors",
      description: "Connect Sourcegraph's Amp coding agent to Locker via native HTTP MCP transport.",
      copyText: `{
  "amp.mcpServers": {
    "locker": {
      "url": "${origin}/api/mcp",
      "headers": {
        "Authorization": "Bearer lkr_your_token_here"
      }
    }
  }
}`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Admin → API Tokens</strong> and generate a new token.</li>
            <li>Open <code>~/.config/amp/settings.json</code> on macOS/Linux, or <code>%APPDATA%\\amp\\settings.json</code> on Windows. For a single project, use <code>.amp/settings.json</code> at the project root.</li>
            <li>Add the snippet below, replacing <code>lkr_your_token_here</code> with your token. Note: Amp uses <code>amp.mcpServers</code> as the top-level key.</li>
            <li>Or add via CLI: <code>amp mcp add locker --header "Authorization=Bearer lkr_your_token_here" ${origin}/api/mcp</code></li>
          </ol>
        </div>
      ),
    },
    {
      id: "kiro",
      label: "Kiro",
      color: "#ff9900",
      group: "Editors",
      description: "Connect AWS's Kiro IDE to Locker via native HTTP MCP transport. Kiro has a built-in UI for managing MCP servers.",
      copyText: `{
  "mcpServers": {
    "locker": {
      "url": "${origin}/api/mcp",
      "headers": {
        "Authorization": "Bearer lkr_your_token_here"
      }
    }
  }
}`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Admin → API Tokens</strong> and generate a new token.</li>
            <li>Open the MCP config via Command Palette (<code>Cmd+Shift+P</code> / <code>Ctrl+Shift+P</code>) → search <strong>MCP → Open MCP Config</strong>. This opens <code>~/.kiro/settings/mcp.json</code> (or <code>.kiro/settings/mcp.json</code> for workspace scope).</li>
            <li>Add the <code>locker</code> block (copy snippet below) into <code>mcpServers</code>, replacing <code>lkr_your_token_here</code> with your token.</li>
            <li>Check the MCP tab in the activity bar to verify the server is connected.</li>
          </ol>
        </div>
      ),
    },
    {
      id: "chatgpt",
      label: "ChatGPT",
      color: "#10a37f",
      group: "OpenAI",
      tested: true,
      description: "Integrate your Locker memory into ChatGPT by building a Custom GPT with an API Action. Fully tested and working.",
      copyText: `{
  "openapi": "3.1.0",
  "info": {
    "title": "Locker Memory API",
    "version": "1.0.0",
    "description": "Semantic memory search and management endpoint with MCP support."
  },
  "servers": [
    {
      "url": "${origin}"
    }
  ],
  "components": {
    "schemas": {
      "Memory": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "fact": { "type": "string" },
          "category": { "type": "string", "enum": ["rules", "projects", "references"] },
          "tags": { "type": "array", "items": { "type": "string" } },
          "source": { "type": "string" },
          "projectKey": { "type": "string" },
          "isActive": { "type": "boolean" }
        }
      }
    },
    "securitySchemes": {
      "bearerAuth": {
        "type": "http",
        "scheme": "bearer",
        "description": "Bearer token (lkr_* format)"
      }
    }
  },
  "security": [{ "bearerAuth": [] }],
  "paths": {
    "/api/mcp": {
      "post": {
        "operationId": "mcpCall",
        "summary": "MCP Tool Invocation",
        "description": "Call any Locker MCP tool via JSON-RPC 2.0",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "jsonrpc": { "type": "string", "enum": ["2.0"] },
                  "id": { "type": "integer", "description": "Request ID" },
                  "method": { "type": "string", "enum": ["tools/call"] },
                  "params": {
                    "type": "object",
                    "properties": {
                      "name": {
                        "type": "string",
                        "enum": ["recall_context", "search_memories", "get_memory_summary", "commit_memory", "update_memory", "delete_memory"],
                        "description": "Tool name"
                      },
                      "arguments": {
                        "type": "object",
                        "description": "Tool-specific arguments"
                      }
                    },
                    "required": ["name", "arguments"]
                  }
                },
                "required": ["jsonrpc", "id", "method", "params"]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "jsonrpc": { "type": "string" },
                    "id": { "type": "integer" },
                    "result": { "type": "object" }
                  }
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    }
  }
}`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Admin → API Tokens</strong> and generate a new token. Copy it — shown only once.</li>
            <li>Open <strong>ChatGPT → Explore GPTs → Create</strong> → <strong>Configure</strong> tab.</li>
            <li>Scroll down to <strong>Actions</strong> → click <strong>Create new action</strong>.</li>
            <li>Paste the OpenAPI schema below into the <strong>Schema</strong> field.</li>
            <li>Under <strong>Authentication</strong>, choose <strong>API Key</strong>, select <strong>Bearer</strong>, and paste your token.</li>
            <li>Click <strong>Save</strong>. Verify the server connection shows a green checkmark.</li>
            <li>In the <strong>Instructions</strong> field, paste the system prompt below (the detailed tool instructions).</li>
            <li>Save your GPT. Test by asking "give me a list of my current projects" or "what are my coding rules?"</li>
          </ol>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: 12, marginTop: 12 }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8, fontWeight: 600 }}>System Prompt for GPT Instructions:</div>
            <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, padding: 10, fontSize: 11, fontFamily: "monospace", lineHeight: 1.5, color: "var(--text)", maxHeight: 240, overflowY: "auto" }}>
              You have access to a personal long-term memory vault called <strong>Locker</strong>. When the user asks about their projects, rules, preferences, or background, <strong>immediately call the mcpCall action</strong> with the appropriate tool. Do not defer or ask the user to retrieve it themselves.{"\n\n"}
              <strong>Tool Selection Guide:</strong>{"\n"}
              • <strong>Projects, active work:</strong> Call search_memories with {`{ "category": "projects", "limit": 100 }`}{"\n"}
              • <strong>Rules, guidelines, preferences:</strong> Call recall_context with {`{ "query": "<user's question>", "category": "rules", "topK": 10 }`}{"\n"}
              • <strong>Open-ended questions:</strong> Call recall_context with {`{ "query": "<user's question>", "topK": 10 }`}{"\n"}
              • <strong>Overview of memories:</strong> Call get_memory_summary with {`{}`}{"\n"}
              • <strong>Remember something new:</strong> Call commit_memory with {`{ "fact": "<statement>", "category": "rules" or "projects" or "references", "tags": "<tags>" }`}{"\n\n"}
              <strong>Critical:</strong> Always call tools immediately when user asks about projects, memories, or context. Never expose JSON-RPC format to the user. Integrate results naturally into responses.
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "geminicli",
      label: "Gemini CLI",
      color: "#34a853",
      group: "Google",
      description: "Connect the Gemini CLI (@google/gemini-cli) to Locker via native HTTP MCP transport — no mcp-remote wrapper needed.",
      copyText: `{
  "mcpServers": {
    "locker": {
      "httpUrl": "${origin}/api/mcp",
      "headers": {
        "Authorization": "Bearer lkr_your_token_here"
      }
    }
  }
}`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Admin → API Tokens</strong> and generate a new token.</li>
            <li>Open <code>~/.gemini/settings.json</code> (create it if it doesn't exist). For project-scoped config use <code>.gemini/settings.json</code> at your project root.</li>
            <li>Add the <code>locker</code> block (copy snippet below) into <code>mcpServers</code>, replacing <code>lkr_your_token_here</code> with your token.</li>
            <li>Or add via CLI: <code>gemini mcp add --transport http --header "Authorization: Bearer lkr_your_token_here" locker ${origin}/api/mcp</code></li>
          </ol>
        </div>
      ),
    },
    {
      id: "gemini",
      label: "Gemini (Gems)",
      color: "#4285f4",
      group: "Google",
      description: "Gemini Gems (gemini.google.com) don't support MCP directly. Use a custom instruction prompt to tell Gemini how to call the Locker API.",
      copyText: `You have access to a personal memory retrieval API at ${origin}/api/mcp. All requests require the header "Authorization: Bearer lkr_your_token_here". If you need context about my background, projects, or rules, send a POST request to that URL with the JSON-RPC body {"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"recall_context","arguments":{"query":"<topic>"}}} and include the Authorization header.`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Admin → API Tokens</strong> and generate a new token.</li>
            <li>Create a new <strong>Gem</strong> in the Gemini dashboard.</li>
            <li>Under <strong>Instructions</strong>, paste the directive below, replacing <code>lkr_your_token_here</code> with your token.</li>
          </ol>
        </div>
      ),
    },
    {
      id: "grok",
      label: "Grok",
      color: "#e7e7e7",
      group: "Other",
      description: "Connect your Locker memories to Grok Agents using custom Grok Web Actions.",
      copyText: `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"recall_context","arguments":{"query":"{{QUERY}}"}}}`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Admin → API Tokens</strong> and generate a new token.</li>
            <li>Create a custom <strong>Grok Agent</strong> on X.</li>
            <li>Add a <strong>Web Action</strong>: URL <code style={{ color: "var(--accent)" }}>${origin}/api/mcp</code>, method POST.</li>
            <li>Add a custom request header: <code style={{ color: "var(--accent)" }}>Authorization: Bearer lkr_your_token_here</code> (replace with your token).</li>
            <li>Set the JSON payload to the snippet below. Grok will query Locker whenever you ask about personal rules or references.</li>
          </ol>
        </div>
      ),
    },
    {
      id: "perplexity",
      label: "Perplexity",
      color: "#20b2aa",
      group: "Other",
      description: "Make your Locker memories available in Perplexity Collections using custom instruction overrides.",
      copyText: `You have access to my personal memory API at ${origin}/api/mcp. All requests must include the header "Authorization: Bearer lkr_your_token_here". Query this endpoint when asked about my rules, preferences, active projects, or background by sending a POST with body {"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"recall_context","arguments":{"query":"<topic>"}}}.`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Admin → API Tokens</strong> and generate a new token.</li>
            <li>Create a new <strong>Collection</strong> in Perplexity.</li>
            <li>In <strong>AI Profile / Instructions</strong>, paste the directive below, replacing <code>lkr_your_token_here</code> with your token.</li>
            <li>Perplexity will include the Authorization header when querying Locker.</li>
          </ol>
        </div>
      ),
    },
  ], [origin]);

  const handleCopy = useCallback(async (text?: string) => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  const handleTestConnection = useCallback(async () => {
    setTestLoading(true);
    setTestResult(null);
    try {
      const response = await fetch('/api/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {},
        }),
      });

      if (response.ok) {
        const data = (await response.json()) as any;
        const toolCount = data.result?.tools?.length || 0;
        setTestResult({
          status: 'success',
          message: `✓ Connected successfully! Found ${toolCount} MCP tool${toolCount !== 1 ? 's' : ''} available in your vault.`
        });
      } else {
        setTestResult({
          status: 'error',
          message: `Connection failed (HTTP status ${response.status}). Ensure the endpoint is reachable.`
        });
      }
    } catch (err: any) {
      setTestResult({
        status: 'error',
        message: `Connection error: ${err?.message || 'Unable to reach the endpoint. Check your server status.'}`
      });
    } finally {
      setTestLoading(false);
    }
  }, []);

  const filteredIntegrations = useMemo(() => {
    return SERVICES.filter((s) => {
      const query = searchQuery.toLowerCase();
      return (
        s.label.toLowerCase().includes(query) ||
        s.group.toLowerCase().includes(query) ||
        s.description.toLowerCase().includes(query)
      );
    });
  }, [SERVICES, searchQuery]);

  const selectedService = SERVICES.find((s) => s.id === activeSection);

  const renderContent = () => {
    if (selectedService) {
      return (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, background: "var(--accent-dim)", color: "var(--accent)", border: "1px solid rgba(168,85,247,0.2)", borderRadius: 20, padding: "2px 10px", fontWeight: 600 }}>
              {selectedService.group} Integration
            </span>
            {selectedService.tested ? (
              <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.3)", color: "#22c55e", borderRadius: 20, padding: "2px 10px", fontWeight: 500 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e" }} />
                Tested & Confirmed
              </span>
            ) : (
              <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.3)", color: "#f59e0b", borderRadius: 20, padding: "2px 10px", fontWeight: 500 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#f59e0b" }} />
                Reference Guide
              </span>
            )}
          </div>
          <h2 style={{ fontSize: 24, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>{selectedService.label}</h2>
          <p style={{ color: "var(--text-muted)", fontSize: 14, marginBottom: 24, lineHeight: 1.6 }}>{selectedService.description}</p>
          
          {!selectedService.tested && (
            <div style={{
              background: "rgba(245, 158, 11, 0.05)",
              border: "1px solid rgba(245, 158, 11, 0.2)",
              borderRadius: "var(--radius)",
              padding: "12px 16px",
              marginBottom: 24,
              fontSize: 13,
              color: "#f59e0b",
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              lineHeight: 1.5,
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }}>
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <span>
                <strong>Community Reference Guide:</strong> This integration config has not been fully tested or validated for this version of Locker. Settings may require adjustments depending on your client version.
              </span>
            </div>
          )}

          <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 20, marginBottom: 24 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--accent)", marginBottom: 12 }}>Installation Instructions</h3>
            {selectedService.instructions}
          </div>

          {selectedService.copyText && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
                  Configuration Block
                </span>
                <button
                  onClick={() => handleCopy(selectedService.copyText)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 10px",
                    background: copied ? "rgba(34,197,94,0.12)" : "var(--surface2)",
                    border: copied ? "1px solid rgba(34,197,94,0.3)" : "1px solid var(--border)",
                    color: copied ? "#22c55e" : "var(--text-muted)",
                    fontSize: 12,
                    fontWeight: 500,
                    borderRadius: 6,
                    cursor: "pointer",
                    transition: "all 0.2s",
                  }}
                >
                  {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
                  {copied ? "Copied!" : "Copy Configuration"}
                </button>
              </div>
              <pre style={{
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                padding: "16px",
                fontFamily: "monospace",
                fontSize: 12,
                maxHeight: 320,
                overflow: "auto",
                lineHeight: 1.6,
                color: "var(--text)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                margin: 0,
              }}>{selectedService.copyText}</pre>
            </div>
          )}
        </div>
      );
    }

    switch (activeSection) {
      case "overview":
        return (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>System Overview</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              Locker is a secure, long-term personal and team memory vault built for artificial intelligence workflows. 
              It provides a standardized, encrypted location for AI clients to store and retrieve technical context, 
              coding rules, team preferences, and project specifications.
            </p>
            
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 32 }}>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 18 }}>⚡</span>
                  <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", margin: 0 }}>
                    Hybrid Retrieval Engine
                  </h3>
                </div>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  Powered by Cloudflare Vectorize and SQLite. Combines semantic vector search and exact token/substring matches via Reciprocal Rank Fusion (RRF) to ensure high-accuracy conceptual matches without missing specific keyword tokens.
                </p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 18 }}>🔒</span>
                  <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", margin: 0 }}>
                    End-to-End Encrypted
                  </h3>
                </div>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  All memory data is encrypted using AES-256-GCM under a unique per-vault Data Encryption Key (DEK). The DEK is wrapped by a server-side Key Encryption Key — compromising the database or the environment variable alone is insufficient to decrypt any data.
                </p>
              </div>
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 16 }}>Key Features & Workflows</h3>
            
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16, marginBottom: 32 }}>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
                <h4 style={{ margin: "0 0 6px 0", fontSize: 14, fontWeight: 700, color: "var(--text)", display: "flex", alignItems: "center", gap: 8 }}>
                  <span>🧠</span> Memory Ingestion & Management
                </h4>
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 12px 0", lineHeight: 1.6 }}>
                  Create, update, and manage long-term facts either through the visual browser-based dashboard or directly via connected LLMs using programmatic MCP interfaces. Suggest new rules during conversation sessions and approve them in the recommendations queue.
                </p>
                <div style={{ display: "flex", gap: 12, fontSize: 12, flexWrap: "wrap" }}>
                  <button onClick={() => setActiveSection("managing-memories")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit", fontWeight: 600 }}>
                    Manage Memories Guide →
                  </button>
                  <span style={{ color: "var(--border)" }}>|</span>
                  <button onClick={() => setActiveSection("import-memories")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit", fontWeight: 600 }}>
                    Import & Ingestion Guide →
                  </button>
                </div>
              </div>

              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
                <h4 style={{ margin: "0 0 6px 0", fontSize: 14, fontWeight: 700, color: "var(--text)", display: "flex", alignItems: "center", gap: 8 }}>
                  <span>🛠️</span> Tech Stack Blueprinting
                </h4>
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 12px 0", lineHeight: 1.6 }}>
                  Build custom constraints for 12 technology stack categories (Languages, Frameworks, DBs, ORMs, styling strategy) using the Stack Creator wizard. Save standard profiles as reusable templates to skip regenerations and maintain consistency.
                </p>
                <div style={{ display: "flex", gap: 12, fontSize: 12, flexWrap: "wrap" }}>
                  <button onClick={() => setActiveSection("stack-creator")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit", fontWeight: 600 }}>
                    Tech Stack Creator Guide →
                  </button>
                  <span style={{ color: "var(--border)" }}>|</span>
                  <button onClick={() => setActiveSection("templates")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit", fontWeight: 600 }}>
                    Blueprint Templates Guide →
                  </button>
                </div>
              </div>

              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
                <h4 style={{ margin: "0 0 6px 0", fontSize: 14, fontWeight: 700, color: "var(--text)", display: "flex", alignItems: "center", gap: 8 }}>
                  <span>💾</span> Multi-Agent Rule Compilation
                </h4>
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 12px 0", lineHeight: 1.6 }}>
                  Translate stored technical guidelines into formatted instructions for specific AI developer agents. Downloads are supported in the UI for CLAUDE.md, .cursorrules, copilot-instructions.md, GEMINI.md, AGENTS.md, and .agents/rules/rules.md. Synchronize files automatically inside local project directories via MCP.
                </p>
                <div style={{ display: "flex", gap: 12, fontSize: 12, flexWrap: "wrap" }}>
                  <button onClick={() => setActiveSection("export-rules")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit", fontWeight: 600 }}>
                    Rules Exporting & Sync Guide →
                  </button>
                </div>
              </div>

              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
                <h4 style={{ margin: "0 0 6px 0", fontSize: 14, fontWeight: 700, color: "var(--text)", display: "flex", alignItems: "center", gap: 8 }}>
                  <span>👥</span> Team Governance & Security
                </h4>
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 12px 0", lineHeight: 1.6 }}>
                  Leverage Organization settings to govern billing seats, isolate sub-teams, and restrict scoped memories to specific project workspace keys. Locker enforces a strict security protocol, ephemeral V8 Workers sandboxing, entropy-based DLP at write time, and PBKDF2-hardened token hashing.
                </p>
                <div style={{ display: "flex", gap: 12, fontSize: 12, flexWrap: "wrap" }}>
                  <button onClick={() => setActiveSection("team-collaboration")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit", fontWeight: 600 }}>
                    Team Collaboration Guide →
                  </button>
                  <span style={{ color: "var(--border)" }}>|</span>
                  <button onClick={() => setActiveSection("security-privacy")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit", fontWeight: 600 }}>
                    Security Architecture & Pillars →
                  </button>
                </div>
              </div>
            </div>

            <div style={{ background: "rgba(168, 85, 247, 0.04)", border: "1px solid rgba(168, 85, 247, 0.15)", borderRadius: 12, padding: 18 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                🛡️ Core Security Model
              </h3>
              <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                All database items are encrypted using AES-256-GCM under per-vault Data Encryption Keys (DEKs) wrapped by a server-side Key Encryption Key. Secrets are scanned and redacted at write time using entropy-based DLP. API tokens are hashed with PBKDF2 at 100,000 iterations. Relational queries, D1 logs, and vector indices are fully anonymized. Read/write capabilities are regulated via scoped API token bitmasks.
              </p>
            </div>
          </div>
        );
      case "connection-auth":
        return (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>Connection & Authentication</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              To connect an external AI model or development assistant to Locker, you must supply the Model Context Protocol (MCP) endpoint address and a cryptographically signed API token.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 32 }}>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                  <span style={{ fontSize: 11, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                    🔌 MCP Endpoint Address
                  </span>
                  <button
                    onClick={() => handleCopy(`${origin}/api/mcp`)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "4px 10px",
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      color: "var(--text)",
                      fontSize: 11,
                      fontWeight: 600,
                      borderRadius: 6,
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <CopyIcon size={11} /> Copy Address
                  </button>
                </div>
                <code style={{ display: "block", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", fontFamily: "monospace", fontSize: 12, color: "var(--text)", overflowX: "auto", whiteSpace: "nowrap" }}>
                  {origin}/api/mcp
                </code>
              </div>

              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                  <span style={{ fontSize: 11, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                    🔑 HTTP Authentication Header
                  </span>
                  <button
                    onClick={() => handleCopy("Authorization: Bearer <your-api-token>")}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "4px 10px",
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      color: "var(--text)",
                      fontSize: 11,
                      fontWeight: 600,
                      borderRadius: 6,
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <CopyIcon size={11} /> Copy Header
                  </button>
                </div>
                <code style={{ display: "block", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", fontFamily: "monospace", fontSize: 12, color: "var(--text)", overflowX: "auto", whiteSpace: "nowrap" }}>
                  Authorization: Bearer &lt;your-api-token&gt;
                </code>
              </div>
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Obtaining an API Token</h3>
            
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
              {[
                { step: "1", text: "Navigate to the Admin page from the top navigation bar." },
                { step: "2", text: "Under the personal settings sidebar, click API Tokens." },
                { step: "3", text: "Click the Generate Token button. Give the token a descriptive name (e.g., 'Claude Desktop') and select the specific scopes it is authorized to call (such as 'recall_context' or 'commit_memory')." }
              ].map((s) => (
                <div key={s.step} style={{ display: "flex", gap: 14, alignItems: "flex-start", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: "50%", background: "var(--accent-dim)", color: "var(--accent)",
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0,
                    border: "1px solid rgba(168,85,247,0.2)"
                  }}>{s.step}</div>
                  <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.5 }}>{s.text}</p>
                </div>
              ))}
            </div>
          </div>
        );
      case "security-privacy":
        return (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 11, background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", color: "#10b981", borderRadius: 20, padding: "2px 10px", fontWeight: 600 }}>
                🛡️ Zero-Trust Security Architecture
              </span>
              </div>
            
            <h2 style={{ fontSize: 28, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>Security & Privacy Guide</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 15, lineHeight: 1.6, marginBottom: 28 }}>
              Locker operates on a zero-compromise security model designed to safeguard sensitive tech stack architecture, corporate code guidelines, and personal context. Our edge-native infrastructure isolates, encrypts, and audits every layer of data interaction.
            </p>

            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: 20,
              marginBottom: 32
            }}>
              {/* Card 1: Zero-Knowledge Envelope Encryption */}
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 16, padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 20 }}>🔑</span>
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", margin: 0 }}>AES-256-GCM Envelope Encryption</h3>
                </div>
                <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, margin: 0 }}>
                  All memory contents, tech stack profiles, and templates are encrypted using a two-layer envelope scheme prior to database insertion:
                </p>
                <ul style={{ paddingLeft: 18, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.7, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  <li><strong>Per-User Data Encryption Keys (DEK):</strong> Each vault receives a unique randomly generated 256-bit AES-GCM key. All memory data is encrypted exclusively under this DEK — the master server key never directly touches user data.</li>
                  <li><strong>Key Encryption Key (KEK) Wrapping:</strong> Each DEK is itself encrypted (wrapped) using the server-side KEK via AES-256-GCM and stored in D1. Compromising the database alone or the environment key alone is insufficient to decrypt any data — both are required.</li>
                  <li><strong>Memory-Only Key Scope:</strong> Unwrapped DEKs reside strictly in ephemeral edge worker memory during request processing and are never logged, persisted, or sent to clients.</li>
                  <li><strong>Encrypted Backups:</strong> Database logs, D1 transaction snapshots, and storage backups consist exclusively of ciphertext — wrapped DEKs and encrypted payloads.</li>
                </ul>
              </div>

              {/* Card 2: SQLite Relational Boundaries & Triggers */}
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 16, padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 20 }}>🛡️</span>
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", margin: 0 }}>Relational Boundaries & SQLite Triggers</h3>
                </div>
                <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, margin: 0 }}>
                  Isolation is enforced deep inside the SQLite engine to guarantee absolute separation of user and organizational domains:
                </p>
                <ul style={{ paddingLeft: 18, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.7, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  <li><strong>SQLite Condition Triggers:</strong> Active database-level triggers strictly govern data insertion and updates, preventing scope mismatch.</li>
                  <li><strong>Multi-Tenant Isolation:</strong> Structured <code>scopeType</code> (<code>personal</code>, <code>organization</code>, <code>team</code>) acts as a cryptographic boundary.</li>
                  <li><strong>Foreign Key Protection:</strong> Destructive operations or queries attempting to leak records across scopes are immediately blocked at the database engine layer.</li>
                </ul>
              </div>

              {/* Card 3: Web Crypto TOTP 2FA */}
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 16, padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 20 }}>📲</span>
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", margin: 0 }}>Web Crypto TOTP Two-Factor Auth</h3>
                </div>
                <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, margin: 0 }}>
                  Secure destructive or administrative operations via programmatic multi-factor authorization:
                </p>
                <ul style={{ paddingLeft: 18, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.7, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  <li><strong>RFC 6238 Standard:</strong> Code generation and validation is performed using high-speed Web Crypto HMAC-SHA1 at the edge.</li>
                  <li><strong>MFA for MCP:</strong> Destructive client tools (delete or update memory) require a valid 6-digit TOTP code when 2FA is active.</li>
                  <li><strong>Setup & Backup:</strong> Setup via settings wizard with generated secret keys, QR validation verification, and download-capable recovery keys.</li>
                </ul>
              </div>

              {/* Card 4: MCP Passcode Safeguards */}
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 16, padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 20 }}>🔑</span>
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", margin: 0 }}>MCP Deletion & Write Passcode</h3>
                </div>
                <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, margin: 0 }}>
                  A static passcode protection layer securing programmatic endpoints from rogue or runaway AI requests:
                </p>
                <ul style={{ paddingLeft: 18, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.7, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  <li><strong>Fallback Protection:</strong> When 2FA is inactive, write or delete actions executed via MCP are blocked unless the correct passcode is supplied.</li>
                  <li><strong>PBKDF2 Hashing:</strong> Passcodes and API tokens are stored using PBKDF2-HMAC-SHA256 at 100,000 iterations (Cloudflare Workers max) with a random per-token salt — resistant to GPU-accelerated brute-force even if the database is leaked.</li>
                  <li><strong>Explicit Confirmation:</strong> Requires setting the <code>confirm === true</code> parameter alongside the valid passcode credential.</li>
                </ul>
              </div>

              {/* Card 5: Moderated Conflict Resolution */}
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 16, padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 20 }}>📝</span>
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", margin: 0 }}>User-Moderated Conflict Reviews</h3>
                </div>
                <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, margin: 0 }}>
                  Halts silent automated updates to prevent memory corruption and LLM hallucination overrides:
                </p>
                <ul style={{ paddingLeft: 18, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.7, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  <li><strong>Recommendation Queue:</strong> Conflicting facts or proposed modifications are diverted to a review queue (<code>memoryRecommendations</code>).</li>
                  <li><strong>Visual Conflict UI:</strong> Conflict review banners and cards allow users to compare, approve, or reject suggestions.</li>
                  <li><strong>No Silent Archiving:</strong> Inferred contradictions trigger an active notification instead of silently overwriting historical context.</li>
                </ul>
              </div>

              {/* Card 6: V8 Sandboxing & Session Audits */}
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 16, padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 20 }}>⚙️</span>
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", margin: 0 }}>V8 Ephemeral Sandboxing & Auditing</h3>
                </div>
                <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, margin: 0 }}>
                  Advanced tracking and runtime isolation shield the application and trace its execution:
                </p>
                <ul style={{ paddingLeft: 18, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.7, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  <li><strong>V8 Ephemeral Sandbox:</strong> Runtime execution is sandboxed in Cloudflare Worker processes, shutting down attack surfaces.</li>
                  <li><strong>Enterprise Audit Trails:</strong> Every MCP call or administrative modification logs the timestamp, IP address, user-agent, and target scope.</li>
                  <li><strong>Session Management:</strong> Users can inspect and revoke active sessions directly from the Sessions settings panel.</li>
                </ul>
              </div>

              {/* Card 7: Entropy-Based DLP */}
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 16, padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 20 }}>🔍</span>
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", margin: 0 }}>Entropy-Based Data Loss Prevention</h3>
                </div>
                <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, margin: 0 }}>
                  Secrets and PII are detected and redacted at write time — before encryption — using a multi-layer scanning engine:
                </p>
                <ul style={{ paddingLeft: 18, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.7, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  <li><strong>Shannon Entropy Gating:</strong> Candidate values in key-value assignments, JSON fields, and Authorization headers are scored for entropy. Only high-entropy strings (≥ 4.0 bits/char) in secret-looking contexts are flagged, eliminating false positives on legitimate code IDs and slugs.</li>
                  <li><strong>Structural Pattern Detection:</strong> Unmistakable credential formats — AWS access keys, Stripe keys, GitHub PATs, Slack tokens, PEM private keys, and database URIs — are caught unconditionally regardless of entropy score.</li>
                  <li><strong>PII Scanning:</strong> Email addresses, phone numbers, credit card numbers, and SSNs are detected via dedicated regex patterns and always redacted.</li>
                  <li><strong>Write-Time Enforcement:</strong> DLP runs during <code>commit_memory</code> and <code>update_memory</code> — not at retrieval. Stored memories are already clean, so code snippets and identifiers recalled by AI agents are never corrupted.</li>
                </ul>
              </div>

              {/* Card 8: Auth & Session Hardening */}
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 16, padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 20 }}>⚡</span>
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", margin: 0 }}>Auth Hardening & Request Isolation</h3>
                </div>
                <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, margin: 0 }}>
                  The authentication layer is designed to eliminate race conditions and minimize database exposure under load:
                </p>
                <ul style={{ paddingLeft: 18, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.7, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  <li><strong>One-Time OAuth Bootstrap:</strong> OAuth client provisioning runs at most once per worker isolate lifetime rather than on every request, eliminating D1 write storms and race conditions under concurrent load.</li>
                  <li><strong>Isolate-Scoped Auth Cache:</strong> Authenticated session configurations are cached at the worker isolate level with a 5-minute TTL, reducing redundant D1 reads without holding stale credentials beyond the cache window.</li>
                  <li><strong>Read-Only Request Path:</strong> The per-request authentication path performs no writes to the database, ensuring that high-traffic periods cannot cause connection exhaustion or lock contention on auth tables.</li>
                </ul>
              </div>
            </div>

            <div style={{
              background: "rgba(168, 85, 247, 0.05)",
              border: "1px solid rgba(168, 85, 247, 0.15)",
              borderRadius: "12px",
              padding: "16px",
              fontSize: "13px",
              color: "var(--text-muted)",
              lineHeight: "1.6",
              display: "flex",
              alignItems: "center",
              gap: "12px",
            }}>
              <span style={{ fontSize: 20 }}>💡</span>
              <span>
                <strong>Need to configure your security?</strong> Head over to the <strong>Admin → Security</strong> tab in the navigation bar to enable Time-Based 2FA, set a deletion passcode, or audit active login sessions.
              </span>
            </div>
          </div>
        );
      case "import-memories":
        return (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>Importing & Migrating</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              Migrating your personal context, rules, and inferred preferences from existing platforms is a simple two-step process in Locker. Use our custom extraction prompts for major LLMs and batch ingest them using our AI parsing tool.
            </p>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Migration Workflow</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 32 }}>
              {[
                { step: "1", text: "Open the Import tab in the top navigation bar." },
                { step: "2", text: "Select your source platform (ChatGPT, Claude, Perplexity, Gemini, Grok, or Microsoft Copilot)." },
                { step: "3", text: "Locker displays a custom prompt tailored to extract that chatbot's internal memory store. Click Copy Prompt." },
                { step: "4", text: "Paste the prompt into your chat session with that LLM. The AI will output all its saved memories and inferred preferences in a structured JSON/markdown code block." },
                { step: "5", text: "Paste the output code block into the Locker import panel and select a project workspace scope." },
                { step: "6", text: "Click Parse with AI. Locker will automatically deduplicate, categorize (rules, projects, or references), and tag the raw dump." },
                { step: "7", text: "Verify the parsed facts on screen and click Batch Import Memories to encrypt and save them." }
              ].map((s) => (
                <div key={s.step} style={{ display: "flex", gap: 14, alignItems: "flex-start", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: "50%", background: "var(--accent-dim)", color: "var(--accent)",
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0,
                    border: "1px solid rgba(168,85,247,0.2)"
                  }}>{s.step}</div>
                  <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.5 }}>{s.text}</p>
                </div>
              ))}
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Supported Platforms</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ margin: "0 0 6px 0", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>🤖 ChatGPT & Claude</h4>
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, lineHeight: 1.6 }}>Extracts both explicit saved memory slots, custom system instructions, and implicit behavioral inferences.</p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ margin: "0 0 6px 0", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>🔍 Perplexity & Gemini</h4>
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, lineHeight: 1.6 }}>Pulls details from Perplexity personalization slots and Gemini "Saved Info" panels verbatim.</p>
              </div>
            </div>
          </div>
        );
      case "team-collaboration":
        return (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>Team Collaboration</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              Establish shared coding standards and stack specifications for your entire development team. Group members, assign roles, and connect shared workspace keys to eliminate drift across local developer environments.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 32 }}>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--accent)", margin: "0 0 8px 0" }}>🏢 Organizations</h3>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  Billing hubs that manage member seat allocations, subscription quotas, and general workspace keys. Enforces strict administrative boundaries.
                </p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--accent)", margin: "0 0 8px 0" }}>👥 Teams</h3>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  Granular sub-groups (e.g. <code>frontend-team</code>, <code>devops-team</code>). Restrict memory blocks or project scopes to specific teams so developers only receive relevant context.
                </p>
              </div>
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>User Roles & Governance</h3>
            <div style={{ 
              border: "1px solid var(--border)", 
              borderRadius: 12, 
              overflow: "hidden", 
              background: "var(--surface2)", 
              marginBottom: 32,
              width: "100%",
              overflowX: "auto"
            }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, textAlign: "left", minWidth: 500 }}>
                <thead>
                  <tr style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
                    <th style={{ padding: "12px 16px", color: "var(--text)", fontWeight: 700 }}>Role</th>
                    <th style={{ padding: "12px 16px", color: "var(--text)", fontWeight: 700 }}>Permissions & Access Boundaries</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "14px 16px", fontWeight: "bold", color: "var(--accent)" }}>Owner</td>
                    <td style={{ padding: "14px 16px", color: "var(--text-muted)", lineHeight: 1.5 }}>Full billing control, seat upgrades, organization deletion, role modification, and member pruning.</td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "14px 16px", fontWeight: "bold", color: "var(--accent)" }}>Admin</td>
                    <td style={{ padding: "14px 16px", color: "var(--text-muted)", lineHeight: 1.5 }}>Create teams, issue email invitations, delete/update shared organization memories, and edit general team lists.</td>
                  </tr>
                  <tr>
                    <td style={{ padding: "14px 16px", fontWeight: "bold", color: "var(--text)" }}>Member</td>
                    <td style={{ padding: "14px 16px", color: "var(--text-muted)", lineHeight: 1.5 }}>Read-only access or read-write access to specific scoped memory cards based on team memberships.</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div style={{ background: "rgba(168, 85, 247, 0.04)", border: "1px solid rgba(168, 85, 247, 0.15)", borderRadius: 12, padding: 18 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                📩 Inviting Members
              </h3>
              <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                Owners and Admins can invite new developers from the <strong>Organization</strong> view by typing their email. Locker generates a cryptographically signed magic link valid for 48 hours and sends an invitation email using Cloudflare's built-in Email Worker bindings.
              </p>
            </div>
          </div>
        );
      case "managing-memories":
        return (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>Managing Memories</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              Locker provides a flexible interface for managing your long-term memory vault. Memories can be created, updated, and purged either through the browser-based dashboard or directly by connected AI developer tools using Model Context Protocol (MCP).
            </p>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Managing Memories in the UI</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12, marginBottom: 32 }}>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 16 }}>
                <strong style={{ display: "block", color: "var(--text)", marginBottom: 4 }}>🧠 Creating Memories</strong>
                <span style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
                  Click the <strong>New Memory</strong> button at the top right of the dashboard. Select a Category (Rules, Projects, or References), write the Fact text, add custom tags, and optionally associate it with a specific <strong>Project Workspace</strong> key to isolate instructions.
                </span>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 16 }}>
                <strong style={{ display: "block", color: "var(--text)", marginBottom: 4 }}>✏️ Editing & Deleting</strong>
                <span style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
                  Click the edit (pencil) icon on any memory card to modify its fields, or the delete icon to remove it. Locker automatically updates the underlying SQL database and recalculates the semantic embeddings on Cloudflare Vectorize.
                </span>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 16 }}>
                <strong style={{ display: "block", color: "var(--text)", marginBottom: 4 }}>🚦 Queue Approval Workflow</strong>
                <span style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
                  Connected AI agents can suggest new rules or project details during coding sessions. Proposed memories go into the <strong>Recommendations Queue</strong>. You must log in and click <strong>Approve</strong> to persist these into long-term storage, or <strong>Reject</strong> to discard them.
                </span>
              </div>
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Programmatic Management via MCP</h3>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>
              Locker exposes secure endpoints for AI models to retrieve and mutate memories in real time. Connected developer agents utilize these JSON-RPC commands behind the scenes:
            </p>
            <ul style={{ paddingLeft: 20, color: "var(--text-muted)", fontSize: 13, lineHeight: 1.8, marginBottom: 24, display: "flex", flexDirection: "column", gap: 6 }}>
              <li><strong>Reading Context:</strong> Models call <button onClick={() => setActiveSection("mcp-tools-retrieval")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit", fontWeight: 600 }}>recall_context</button> for hybrid RRF matches, and <button onClick={() => setActiveSection("mcp-tools-retrieval")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit", fontWeight: 600 }}>search_memories</button> for exact tag/keyword scans.</li>
              <li><strong>Mutating Store:</strong> Models use <button onClick={() => setActiveSection("mcp-tools-mutation")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit", fontWeight: 600 }}>commit_memory</button> to suggest facts, <button onClick={() => setActiveSection("mcp-tools-mutation")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit", fontWeight: 600 }}>update_memory</button> to refine facts, and <button onClick={() => setActiveSection("mcp-tools-mutation")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit", fontWeight: 600 }}>delete_memory</button> to remove stale data.</li>
            </ul>
            <div style={{
              background: "rgba(168, 85, 247, 0.04)",
              border: "1px solid rgba(168, 85, 247, 0.15)",
              borderRadius: 12,
              padding: "16px",
              fontSize: 13,
              color: "var(--text-muted)",
              lineHeight: 1.6,
            }}>
              <strong>💡 Developer Tip:</strong> For more detailed input schemas, required parameters, and configuration guides for all management tools, head over to the full <button onClick={() => setActiveSection("mcp-tools-retrieval")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", fontWeight: "bold", textDecoration: "underline", padding: 0, font: "inherit" }}>MCP Tools Reference List</button>.
            </div>
          </div>
        );
      case "stack-creator":
        return (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>Tech Stack Creator</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
              The <strong>Tech Stack Creator</strong> is an interactive step-by-step wizard that allows you to define your workspace's technology profile across 12 architectural categories. Locker utilizes this profile to automatically compile optimized coding rules and agentic instructions.
            </p>

            <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 16, padding: 22, marginBottom: 28 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--accent)", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                🛠️ 12 Technology Categories
              </h3>
              <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
                Locker segments your stack into modular categories. In the UI, these are displayed as easy-to-use option tags:
              </p>
              
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {[
                  { key: "Language", val: "TypeScript, Go, Python, Rust" },
                  { key: "Runtime", val: "Node.js, Bun, Native Runtimes" },
                  { key: "Frontend", val: "React, Next.js, Vue, Svelte" },
                  { key: "Backend", val: "Express, Hono, Django, FastAPI" },
                  { key: "Database", val: "Cloudflare D1, PG, SQLite, MySQL" },
                  { key: "ORM Client", val: "Drizzle, Prisma, sqlx, pg" },
                  { key: "Deploy Platform", val: "Workers, Vercel, Fly.io, AWS" },
                  { key: "Styling", val: "Tailwind, Vanilla CSS, Styled-Components" },
                  { key: "Lint & Format", val: "ESLint, Prettier, Biome, Ruff" },
                  { key: "Test Runner", val: "Vitest, Jest, Playwright" },
                  { key: "State Manage", val: "Zustand, Redux, Jotai" },
                  { key: "Build Tool", val: "Vite, Webpack, Esbuild" }
                ].map((c) => (
                  <div key={c.key} style={{
                    fontSize: 11,
                    padding: "6px 12px",
                    borderRadius: 20,
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                    display: "flex",
                    gap: 6,
                    alignItems: "center"
                  }}>
                    <strong style={{ color: "var(--accent)" }}>{c.key}:</strong>
                    <span style={{ color: "var(--text-muted)" }}>{c.val}</span>
                  </div>
                ))}
              </div>
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Workflow Steps</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                { step: "1", text: "Navigate to the Vault page and click the New Memory button." },
                { step: "2", text: "Select Tech Stack Creator to launch the step-by-step wizard." },
                { step: "3", text: "Provide your selections for each of the 12 tech stack categories." },
                { step: "4", text: "Input any custom negative constraints (e.g., 'no Tailwind inline utilities' or 'do not write raw SQL queries outside repos')." },
                { step: "5", text: "Click Review Recommended Blueprint to compile rules tailored to your choices. Adjust individual guidelines before saving." },
                { step: "6", text: "Click Store Memory to save these rules globally or to a specific project scope. The constraints are instantly synced without exposing database structures to local clients." }
              ].map((s) => (
                <div key={s.step} style={{ display: "flex", gap: 14, alignItems: "flex-start", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: "50%", background: "var(--accent-dim)", color: "var(--accent)",
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0,
                    border: "1px solid rgba(168,85,247,0.2)"
                  }}>{s.step}</div>
                  <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.5 }}>{s.text}</p>
                </div>
              ))}
            </div>
          </div>
        );
      case "templates":
        return (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>Blueprint Templates</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
              Blueprint Templates enable teams and individual developers to save, edit, and share standard configuration profiles. Instead of selecting the same 12 categories repeatedly, you can load templates directly to populate your rules baseline instantly.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 28 }}>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--accent)", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                  💾 Creating Templates
                </h3>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  Go to the <strong>Templates</strong> view and click <strong>New Template</strong>. Set up the stack selections, custom constraints, and rule lists. Save to add the template to your database.
                </p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--accent)", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                  ⚡ Instant Loading
                </h3>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  In the Stack Creator wizard, click <strong>Load Custom Stack Blueprints</strong> to choose a template. The selections, constraints, and recommendations load instantly.
                </p>
              </div>
            </div>

            <div style={{ background: "rgba(168, 85, 247, 0.04)", border: "1px solid rgba(168, 85, 247, 0.15)", borderRadius: 12, padding: 18 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                🚀 Bypassing LLM Regeneration
              </h3>
              <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                If a template already has verified instruction sets, Locker displays a <strong>"Use Loaded Template Rules"</strong> button. Clicking this skips LLM regeneration completely and sends you directly to the review step, reducing token overhead and conserving processing time.
              </p>
            </div>
          </div>
        );
      case "export-rules":
        return (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>Exporting Agent Rules</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              Locker translates your memory rules and tech stack blueprints into optimized configuration files formatted for specific AI developer agents.
            </p>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Supported Formats & Targets</h3>
            <div style={{ 
              border: "1px solid var(--border)", 
              borderRadius: 12, 
              overflow: "hidden", 
              background: "var(--surface2)", 
              marginBottom: 32,
              width: "100%",
              overflowX: "auto"
            }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, textAlign: "left", minWidth: 550 }}>
                <thead>
                  <tr style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
                    <th style={{ padding: "12px 16px", color: "var(--text)", fontWeight: 700 }}>Format File</th>
                    <th style={{ padding: "12px 16px", color: "var(--text)", fontWeight: 700 }}>Agent / IDE Client</th>
                    <th style={{ padding: "12px 16px", color: "var(--text)", fontWeight: 700 }}>Target Path</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { file: "CLAUDE.md", client: "Claude Code (CLI / Extension)", path: "./CLAUDE.md" },
                    { file: ".cursorrules", client: "Cursor Editor (JSON formatted)", path: "./.cursorrules" },
                    { file: "copilot-instructions.md", client: "GitHub Copilot Chat", path: "./.github/copilot-instructions.md" },
                    { file: "GEMINI.md", client: "Gemini Code Assist / Global Rules", path: "~/.gemini/GEMINI.md" },
                    { file: "AGENTS.md", client: "OpenAI Codex & General Agents", path: "./AGENTS.md" },
                    { file: ".agents/rules/rules.md", client: "Google Antigravity Workspaces", path: "./.agents/rules/rules.md" }
                  ].map((f, idx, arr) => (
                    <tr key={f.file} style={{ borderBottom: idx < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
                      <td style={{ padding: "12px 16px", fontFamily: "monospace", color: "var(--accent)", fontWeight: 600 }}>{f.file}</td>
                      <td style={{ padding: "12px 16px", color: "var(--text-muted)" }}>{f.client}</td>
                      <td style={{ padding: "12px 16px", fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)" }}>{f.path}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ margin: "0 0 8px 0", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>📥 Method A: Direct UI Downloads</h4>
                <ol style={{ paddingLeft: 18, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.6, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  <li>Open the <strong>Vault</strong> page, click the <strong>Export Config File</strong> button on any stack card.</li>
                  <li>Select your target format dropdown option (e.g. <code>.cursorrules</code>).</li>
                  <li>Click <strong>Download Rules</strong> to trigger browser file delivery.</li>
                </ol>
              </div>
              
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ margin: "0 0 8px 0", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>⚡ Method B: Workspace Sync via MCP</h4>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 10px 0", lineHeight: 1.6 }}>
                  AI developer agents connected via MCP can call Locker's native sync tool to build and write rules files directly inside your active workspace without manual downloads.
                </p>
                <pre style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  padding: 10,
                  margin: 0,
                  fontFamily: "monospace",
                  fontSize: 11,
                  color: "var(--text)",
                  overflowX: "auto"
                }}>{`{
  "name": "sync_workspace_agent_configs",
  "arguments": {
    "formatType": "claude", // or cursor, gemini, agents
    "projectKey": "locker"
  }
}`}</pre>
              </div>
            </div>
          </div>
        );
      case "mcp-about":
        return (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>Model Context Protocol (MCP)</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              The Model Context Protocol (MCP) is an open-source standard created by Anthropic that allows clients (such as local AI developer tools or editors) to query secure context servers. It decouples LLM logic from specialized APIs and databases, providing a unified, secure interface for context injection.
            </p>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>The 3 Pillars of MCP</h3>
            <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.5, marginBottom: 16 }}>
              MCP defines three core structural primitives to bridge LLMs with external systems:
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 32 }}>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ margin: "0 0 6px 0", fontSize: 14, fontWeight: 700, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
                  💬 Prompts
                </h4>
                <p style={{ color: "var(--text-muted)", fontSize: 12, margin: 0, lineHeight: 1.5 }}>
                  Standardized prompt templates that servers expose to clients. Prompts can contain variable fields and system instructions, helping users write consistent queries.
                </p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ margin: "0 0 6px 0", fontSize: 14, fontWeight: 700, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
                  💾 Resources
                </h4>
                <p style={{ color: "var(--text-muted)", fontSize: 12, margin: 0, lineHeight: 1.5 }}>
                  Read-only context data sources exposed to models as raw textual content (such as log files, documentation pages, or database read operations).
                </p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ margin: "0 0 6px 0", fontSize: 14, fontWeight: 700, color: "var(--accent)", display: "flex", alignItems: "center", gap: 6 }}>
                  ⚙️ Tools (Locker Core)
                </h4>
                <p style={{ color: "var(--text-muted)", fontSize: 12, margin: 0, lineHeight: 1.5 }}>
                  Executable functions with explicit JSON schemas that allow models to modify server state. Locker relies heavily on Tools to search, store, update, and sync memories.
                </p>
              </div>
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>Transport Architectures</h3>
            <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.5, marginBottom: 16 }}>
              MCP supports multiple transport strategies depending on whether the server runs locally or remotely:
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 32 }}>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ margin: "0 0 8px 0", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>📡 Stdio Transport</h4>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  Ideal for local command-line utilities and utilities running on the same machine. Communication is performed through standard input/output streams (<code>stdin</code>/<code>stdout</code>).
                </p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ margin: "0 0 8px 0", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>⚡ SSE / HTTP Transport</h4>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  Ideal for remote web services. Uses Server-Sent Events (SSE) for server-to-client streaming, alongside client HTTP POST requests. Locker leverages HTTP endpoints to execute as a serverless edge worker.
                </p>
              </div>
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>Official Resources & Links</h3>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>
              Explore the official documentation and repositories to learn more about developing or extending Model Context Protocol applications:
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginBottom: 16 }}>
              {[
                { title: "Official Website", url: "https://modelcontextprotocol.io", icon: "🌐", desc: "The home of MCP. Includes setup guides, quickstarts, and client integrations." },
                { title: "Protocol Spec", url: "https://modelcontextprotocol.io/specification/", icon: "📜", desc: "The official JSON-RPC 2.0 schema and architectural specifications." },
                { title: "GitHub Org", url: "https://github.com/modelcontextprotocol", icon: "🐙", desc: "Official SDK repositories (TypeScript, Python, Go) and MCP servers." },
                { title: "Anthropic Intro", url: "https://www.anthropic.com/news/model-context-protocol", icon: "📰", desc: "Anthropic's official announcement and vision for standardizing AI context." }
              ].map((l) => (
                <a
                  key={l.title}
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    padding: 16,
                    background: "var(--surface2)",
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    textDecoration: "none",
                    transition: "all 0.2s ease",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--accent)";
                    e.currentTarget.style.transform = "translateY(-2px)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--border)";
                    e.currentTarget.style.transform = "translateY(0)";
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--accent)", display: "flex", alignItems: "center", gap: 6 }}>
                    <span>{l.icon}</span> {l.title}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 }}>
                    {l.desc}
                  </span>
                </a>
              ))}
            </div>
          </div>
        );
      case "mcp-tools-retrieval":
        return (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>Context Retrieval Tools</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              Context Retrieval tools allow connected AI assistants to discover available workspaces, retrieve relevant long-term memory context, and search memories semantically or using exact keyword patterns.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {ALL_TOOLS.filter((t) =>
                ["list_accessible_scopes", "recall_context", "search_memories", "get_memory_summary"].includes(t.name)
              ).map((tool) => (
                <details key={tool.name} style={{
                  background: "var(--surface2)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  overflow: "hidden"
                }}>
                  <summary style={{
                    padding: "14px 18px",
                    fontWeight: 700,
                    fontSize: 14,
                    color: "var(--accent)",
                    fontFamily: "monospace",
                    cursor: "pointer",
                    listStyleType: "none",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    userSelect: "none"
                  }}>
                    <span>⚙️ {tool.name}</span>
                    <span style={{ fontSize: 10, color: "var(--text-muted)", background: "var(--surface)", border: "1px solid var(--border)", padding: "2px 8px", borderRadius: 4 }}>
                      Click to Expand
                    </span>
                  </summary>
                  <div style={{
                    padding: "16px 18px",
                    borderTop: "1px solid var(--border)",
                    background: "var(--surface)"
                  }}>
                    <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 14px 0", lineHeight: 1.6 }}>
                      {tool.description}
                    </p>
                    <div>
                      <p style={{ fontSize: 10, color: "var(--accent)", margin: "0 0 6px 0", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
                        Input Schema
                      </p>
                      <pre style={{
                        background: "var(--surface2)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        padding: 12,
                        margin: 0,
                        fontFamily: "monospace",
                        fontSize: 11,
                        color: "var(--text)",
                        overflow: "auto",
                        maxHeight: 240,
                        lineHeight: 1.5,
                      }}>
                        {JSON.stringify(tool.inputSchema, null, 2)}
                      </pre>
                    </div>
                  </div>
                </details>
              ))}
            </div>
          </div>
        );
      case "mcp-tools-mutation":
        return (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>Memory Mutation Tools</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              Memory Mutation tools enable connected AI agents to store new facts, update existing memory statements, and purge stale records in real-time. These tools are subject to user-configured passcode or MFA controls.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {ALL_TOOLS.filter((t) =>
                ["commit_memory", "update_memory", "delete_memory"].includes(t.name)
              ).map((tool) => (
                <details key={tool.name} style={{
                  background: "var(--surface2)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  overflow: "hidden"
                }}>
                  <summary style={{
                    padding: "14px 18px",
                    fontWeight: 700,
                    fontSize: 14,
                    color: "var(--accent)",
                    fontFamily: "monospace",
                    cursor: "pointer",
                    listStyleType: "none",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    userSelect: "none"
                  }}>
                    <span>⚙️ {tool.name}</span>
                    <span style={{ fontSize: 10, color: "var(--text-muted)", background: "var(--surface)", border: "1px solid var(--border)", padding: "2px 8px", borderRadius: 4 }}>
                      Click to Expand
                    </span>
                  </summary>
                  <div style={{
                    padding: "16px 18px",
                    borderTop: "1px solid var(--border)",
                    background: "var(--surface)"
                  }}>
                    <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 14px 0", lineHeight: 1.6 }}>
                      {tool.description}
                    </p>
                    <div>
                      <p style={{ fontSize: 10, color: "var(--accent)", margin: "0 0 6px 0", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
                        Input Schema
                      </p>
                      <pre style={{
                        background: "var(--surface2)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        padding: 12,
                        margin: 0,
                        fontFamily: "monospace",
                        fontSize: 11,
                        color: "var(--text)",
                        overflow: "auto",
                        maxHeight: 240,
                        lineHeight: 1.5,
                      }}>
                        {JSON.stringify(tool.inputSchema, null, 2)}
                      </pre>
                    </div>
                  </div>
                </details>
              ))}
            </div>
          </div>
        );
      case "mcp-tools-sync":
        return (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>Workspace Sync Tools</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              Workspace Sync tools translate stack profile definitions and baseline coding rules stored in Locker into optimized instructions formatted for local developer agents.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {ALL_TOOLS.filter((t) =>
                ["sync_workspace_agent_configs"].includes(t.name)
              ).map((tool) => (
                <details key={tool.name} style={{
                  background: "var(--surface2)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  overflow: "hidden"
                }}>
                  <summary style={{
                    padding: "14px 18px",
                    fontWeight: 700,
                    fontSize: 14,
                    color: "var(--accent)",
                    fontFamily: "monospace",
                    cursor: "pointer",
                    listStyleType: "none",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    userSelect: "none"
                  }}>
                    <span>⚙️ {tool.name}</span>
                    <span style={{ fontSize: 10, color: "var(--text-muted)", background: "var(--surface)", border: "1px solid var(--border)", padding: "2px 8px", borderRadius: 4 }}>
                      Click to Expand
                    </span>
                  </summary>
                  <div style={{
                    padding: "16px 18px",
                    borderTop: "1px solid var(--border)",
                    background: "var(--surface)"
                  }}>
                    <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 14px 0", lineHeight: 1.6 }}>
                      {tool.description}
                    </p>
                    <div>
                      <p style={{ fontSize: 10, color: "var(--accent)", margin: "0 0 6px 0", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
                        Input Schema
                      </p>
                      <pre style={{
                        background: "var(--surface2)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        padding: 12,
                        margin: 0,
                        fontFamily: "monospace",
                        fontSize: 11,
                        color: "var(--text)",
                        overflow: "auto",
                        maxHeight: 240,
                        lineHeight: 1.5,
                      }}>
                        {JSON.stringify(tool.inputSchema, null, 2)}
                      </pre>
                    </div>
                  </div>
                </details>
              ))}
            </div>
          </div>
        );
      case "mcp-errors-security":
        return (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>Error Codes & Security</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              Learn about Locker's custom error response codes, programmatic MFA retries, and endpoint rate-limiting mechanisms.
            </p>

            <h3 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>JSON-RPC Error Codes</h3>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>
              Locker uses standard JSON-RPC 2.0 error codes alongside custom application-level error codes to denote security blocks, quota limits, and scoping boundaries.
            </p>

            <div style={{ 
              border: "1px solid var(--border)", 
              borderRadius: 12, 
              overflow: "hidden", 
              background: "var(--surface2)", 
              marginBottom: 36,
              width: "100%",
              overflowX: "auto"
            }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, textAlign: "left", minWidth: 600 }}>
                <thead>
                  <tr style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
                    <th style={{ padding: "12px 16px", color: "var(--text)", fontWeight: 700, width: 90 }}>Code</th>
                    <th style={{ padding: "12px 16px", color: "var(--text)", fontWeight: 700, width: 180 }}>Error Name</th>
                    <th style={{ padding: "12px 16px", color: "var(--text)", fontWeight: 700 }}>Trigger Condition</th>
                    <th style={{ padding: "12px 16px", color: "var(--text)", fontWeight: 700 }}>Recommended Client Handling</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "14px 16px", fontFamily: "monospace", color: "var(--error)", fontWeight: 600 }}>-32001</td>
                    <td style={{ padding: "14px 16px", color: "var(--text)", fontWeight: 600 }}>Unauthorized</td>
                    <td style={{ padding: "14px 16px", color: "var(--text-muted)", lineHeight: 1.4 }}>Missing, expired, or invalid API token; or lacks necessary permissions for the tool scope.</td>
                    <td style={{ padding: "14px 16px", color: "var(--text-muted)", lineHeight: 1.4 }}>Prompt user to configure a valid API key with appropriate scopes (e.g. <code>recall_context</code>).</td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "14px 16px", fontFamily: "monospace", color: "var(--error)", fontWeight: 600 }}>-32003</td>
                    <td style={{ padding: "14px 16px", color: "var(--text)", fontWeight: 600 }}>Forbidden</td>
                    <td style={{ padding: "14px 16px", color: "var(--text-muted)", lineHeight: 1.4 }}>Access to requested scope key is blocked; memory is locked (requires admin); or modifying other user's shared fact.</td>
                    <td style={{ padding: "14px 16px", color: "var(--text-muted)", lineHeight: 1.4 }}>Ensure the correct <code>projectKey</code> is provided, or request owner/admin authorization.</td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "14px 16px", fontFamily: "monospace", color: "var(--error)", fontWeight: 600 }}>-32004</td>
                    <td style={{ padding: "14px 16px", color: "var(--text)", fontWeight: 600 }}>Quota Exceeded</td>
                    <td style={{ padding: "14px 16px", color: "var(--text-muted)", lineHeight: 1.4 }}>Locker subscription limits (storage capacity, recall rates, or operation quota) exceeded.</td>
                    <td style={{ padding: "14px 16px", color: "var(--text-muted)", lineHeight: 1.4 }}>Notify user to upgrade their organization plan tier or clean up stale memory items.</td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "14px 16px", fontFamily: "monospace", color: "var(--error)", fontWeight: 600 }}>-32005</td>
                    <td style={{ padding: "14px 16px", color: "var(--text)", fontWeight: 600 }}>Plan Restricted</td>
                    <td style={{ padding: "14px 16px", color: "var(--text-muted)", lineHeight: 1.4 }}>Using features (e.g. <code>crossWorkspaceSearch</code>) that require a higher plan tier (Business+).</td>
                    <td style={{ padding: "14px 16px", color: "var(--text-muted)", lineHeight: 1.4 }}>Inform user that the requested feature is locked under a higher plan tier.</td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "14px 16px", fontFamily: "monospace", color: "#f59e0b", fontWeight: 600 }}>-32024</td>
                    <td style={{ padding: "14px 16px", color: "var(--text)", fontWeight: 600 }}>MFA Required</td>
                    <td style={{ padding: "14px 16px", color: "var(--text-muted)", lineHeight: 1.4 }}>User has TOTP 2FA enabled, but <code>totpCode</code> was missing or invalid.</td>
                    <td style={{ padding: "14px 16px", color: "var(--text-muted)", lineHeight: 1.4 }}>Prompt human-in-the-loop for 6-digit TOTP code and retry the call with <code>totpCode</code>.</td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "14px 16px", fontFamily: "monospace", color: "#f59e0b", fontWeight: 600 }}>-32025</td>
                    <td style={{ padding: "14px 16px", color: "var(--text)", fontWeight: 600 }}>Passcode Required</td>
                    <td style={{ padding: "14px 16px", color: "var(--text-muted)", lineHeight: 1.4 }}>User has Deletion Passcode enabled (2FA inactive), but <code>passcode</code> was missing or invalid.</td>
                    <td style={{ padding: "14px 16px", color: "var(--text-muted)", lineHeight: 1.4 }}>Prompt human-in-the-loop for deletion passcode and retry the call with <code>passcode</code>.</td>
                  </tr>
                  <tr>
                    <td style={{ padding: "14px 16px", fontFamily: "monospace", color: "var(--error)", fontWeight: 600 }}>-32602</td>
                    <td style={{ padding: "14px 16px", color: "var(--text)", fontWeight: 600 }}>Invalid Params</td>
                    <td style={{ padding: "14px 16px", color: "var(--text-muted)", lineHeight: 1.4 }}>Missing required field; <code>confirm</code> was not set to true; or character length limit exceeded (10,000 max).</td>
                    <td style={{ padding: "14px 16px", color: "var(--text-muted)", lineHeight: 1.4 }}>Verify input formats, ensure <code>confirm: true</code> is passed on mutations, and try again.</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>Interactive Verification Flow (MFA / Passcode)</h3>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
              To prevent prompt injection attacks from performing unauthorized write or delete actions, Locker requires explicit user validation. If an AI client attempts to mutate or delete a memory, it should implement the following human-in-the-loop (HITL) retry pattern:
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
              {[
                { step: "1", title: "Initial Invocation", desc: "The client makes a standard mutation call (e.g. delete_memory) with id and confirm: true." },
                { step: "2", title: "Security Intercept", desc: "The Locker server identifies that the user has configured MFA (returns -32024) or a passcode (returns -32025)." },
                { step: "3", title: "Human Challenge", desc: "The AI agent intercepts the specific error code, displays a message, and asks the user to enter their current code or passcode." },
                { step: "4", title: "Verify & Complete", desc: "The client sends a new tool call containing the user's input (in the totpCode or passcode property). Locker processes and executes the action." }
              ].map((s) => (
                <div key={s.step} style={{ display: "flex", gap: 14, alignItems: "flex-start", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: "50%", background: "var(--accent-dim)", color: "var(--accent)",
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0,
                    border: "1px solid rgba(168,85,247,0.2)"
                  }}>{s.step}</div>
                  <div>
                    <strong style={{ display: "block", color: "var(--text)", fontSize: 13, marginBottom: 3 }}>{s.title}</strong>
                    <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.4 }}>{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginBottom: 36 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
                  Agent Implementation Example (JavaScript / Node)
                </span>
              </div>
              <pre style={{
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                padding: "16px",
                fontFamily: "monospace",
                fontSize: 12,
                maxHeight: 380,
                overflow: "auto",
                lineHeight: 1.6,
                color: "var(--text)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                margin: 0,
              }}>{`async function performDestructiveAction(toolName, arguments) {
  // 1. Initial attempt with confirmation flag
  let result = await callMcpTool(toolName, { ...arguments, confirm: true });

  if (result.error) {
    const { code, message } = result.error;

    // 2. Intercept MFA check
    if (code === -32024) {
      const totpCode = await promptUserForInput(
        "Locker 2FA verification code required. Please check your authenticator app:"
      );
      // Retry request with totpCode
      return await callMcpTool(toolName, { ...arguments, confirm: true, totpCode });
    }

    // 3. Intercept Passcode check
    if (code === -32025) {
      const passcode = await promptUserForInput(
        "Locker deletion passcode required. Please enter your passcode:"
      );
      // Retry request with passcode
      return await callMcpTool(toolName, { ...arguments, confirm: true, passcode });
    }

    throw new Error(\`Failed to execute action: \` + message);
  }

  return result;
}`}</pre>
            </div>

            <div style={{ background: "rgba(168, 85, 247, 0.04)", border: "1px solid rgba(168, 85, 247, 0.15)", borderRadius: 12, padding: 18 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                ⚡ Rate Limits & Quota Control
              </h3>
              <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                Every API token or OAuth session has a default rate-limiting window of <strong>60 requests per minute</strong>. Exceeding this rate returns a standard <code>429 Too Many Requests</code> HTTP response. Additionally, storage space limits (number of stored facts or vectorized context entries) are checked before processing mutations, returning error code <code>-32004</code> if limits are breached.
              </p>
            </div>
          </div>
        );
      case "tester":
        return (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>Connection Tester</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              Use this utility to test if the Locker MCP server endpoint is operational. This diagnostic calls the <code>tools/list</code> JSON-RPC method to verify connection.
            </p>

            <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 16, padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <button
                  onClick={handleTestConnection}
                  disabled={testLoading}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 20px",
                    background: "var(--accent)",
                    color: "#fff",
                    fontWeight: 700,
                    fontSize: 13,
                    transition: "all 0.2s",
                    cursor: testLoading ? "not-allowed" : "pointer",
                    border: "none",
                    borderRadius: "var(--radius)",
                    boxShadow: "0 4px 6px -1px rgba(168, 85, 247, 0.2)"
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: testLoading ? "spin-slow 2s linear infinite" : "none" }}>
                    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                  </svg>
                  {testLoading ? "Testing connection..." : "Run Diagnostic Check"}
                </button>
              </div>

              {testResult && (
                <div style={{
                  padding: "14px 16px",
                  background: testResult.status === 'success' ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)",
                  border: testResult.status === 'success' ? "1px solid rgba(34,197,94,0.25)" : "1px solid rgba(239,68,68,0.25)",
                  borderRadius: 12,
                  color: testResult.status === 'success' ? "#22c55e" : "var(--error)",
                  fontSize: 13,
                  lineHeight: 1.6,
                }}>
                  {testResult.message}
                </div>
              )}
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="docs-container" style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - 52px)" }}>
      <style>{`
        .docs-content ul, .docs-content ol {
          display: block !important;
          list-style-position: outside !important;
          padding-left: 20px !important;
          margin-top: 12px !important;
          margin-bottom: 16px !important;
        }
        .docs-content ul {
          list-style-type: disc !important;
        }
        .docs-content ol {
          list-style-type: decimal !important;
        }
        .docs-content li {
          display: list-item !important;
          margin-bottom: 8px !important;
          line-height: 1.6 !important;
        }
        .docs-layout {
          display: flex;
          flex: 1;
          background: var(--bg);
        }
        .docs-sidebar {
          width: 280px;
          border-right: 1px solid var(--border);
          background: var(--surface);
          position: sticky;
          top: 52px;
          height: calc(100vh - 52px);
          overflow-y: auto;
          padding: 20px 14px;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .docs-mobile-nav {
          display: none;
          padding: 16px;
          border-bottom: 1px solid var(--border);
          background: var(--surface2);
        }
        .docs-mobile-select {
          width: 100%;
          padding: 10px 12px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          color: var(--text);
          font-weight: 600;
          outline: none;
        }
        .docs-content-wrapper {
          flex: 1;
          overflow-y: auto;
          height: calc(100vh - 52px);
          padding: 36px 48px;
        }
        .docs-content {
          max-width: 800px;
          margin: 0 auto;
        }
        .sidebar-section-title {
          font-size: 11px;
          font-weight: 800;
          color: var(--text);
          text-transform: uppercase;
          letter-spacing: 0.1em;
          margin: 22px 0 8px 8px;
          padding-bottom: 5px;
          border-bottom: 1px solid var(--border);
          opacity: 0.85;
        }
        .sidebar-button {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 7px 10px;
          background: transparent;
          border: none;
          color: var(--text-muted);
          text-align: left;
          font-size: 13px;
          font-weight: 500;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .sidebar-button:hover {
          background: var(--accent-dim);
          color: var(--text);
        }
        .sidebar-button.active {
          background: var(--accent-dim);
          border: 1px solid rgba(168,85,247,0.25);
          color: var(--accent-hover);
          font-weight: 600;
        }
        .sidebar-search {
          width: 100%;
          padding: 8px 10px 8px 28px;
          font-size: 12px;
          background: var(--surface2);
          border: 1px solid var(--border);
          border-radius: 6px;
          color: var(--text);
        }
        @keyframes spin-slow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @media (max-width: 840px) {
          .docs-layout {
            flex-direction: column;
          }
          .docs-sidebar {
            display: none;
          }
          .docs-mobile-nav {
            display: block;
          }
          .docs-content-wrapper {
            padding: 24px 16px;
            height: auto;
            overflow-y: visible;
          }
        }
      `}</style>

      {/* Mobile nav dropdown */}
      <div className="docs-mobile-nav">
        <select
          className="docs-mobile-select"
          value={activeSection}
          onChange={(e) => setActiveSection(e.target.value)}
          aria-label="Documentation Navigation"
        >
          <optgroup label="Getting Started">
            <option value="overview">Overview</option>
            <option value="connection-auth">Connection & Auth</option>
            <option value="security-privacy">Security & Privacy</option>
          </optgroup>
          <optgroup label="Features & Workflows">
            <option value="managing-memories">Managing Memories</option>
            <option value="import-memories">Importing & Migrating</option>
            <option value="team-collaboration">Team Collaboration</option>
            <option value="stack-creator">Tech Stack Creator</option>
            <option value="templates">Blueprint Templates</option>
            <option value="export-rules">Exporting Agent Rules</option>
          </optgroup>
          <optgroup label="MCP Reference">
            <option value="mcp-about">About MCP</option>
            <option value="mcp-tools-retrieval">Context Retrieval</option>
            <option value="mcp-tools-mutation">Memory Mutation</option>
            <option value="mcp-tools-sync">Workspace Sync</option>
            <option value="mcp-errors-security">Errors & Security</option>
          </optgroup>
          <optgroup label="Client Integrations">
            {SERVICES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label} ({s.group})
              </option>
            ))}
          </optgroup>
          <optgroup label="Diagnostics">
            <option value="tester">Connection Tester</option>
          </optgroup>
        </select>
      </div>

      <div className="docs-layout">
        {/* Sidebar on desktop */}
        <aside className="docs-sidebar">
          <div>
            <div style={{ position: "relative", marginBottom: 12 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                placeholder="Filter integration guides..."
                className="sidebar-search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Filter guides"
              />
            </div>

            {!searchQuery ? (
              <>
                <div>
                  <div className="sidebar-section-title">Getting Started</div>
                  <button onClick={() => setActiveSection("overview")} className={`sidebar-button ${activeSection === "overview" ? "active" : ""}`}>
                    <span>📖</span> Overview
                  </button>
                  <button onClick={() => setActiveSection("connection-auth")} className={`sidebar-button ${activeSection === "connection-auth" ? "active" : ""}`}>
                    <span>🔑</span> Connection & Auth
                  </button>
                  <button onClick={() => setActiveSection("security-privacy")} className={`sidebar-button ${activeSection === "security-privacy" ? "active" : ""}`}>
                    <span>🔒</span> Security & Privacy
                  </button>
                </div>

                <div>
                  <div className="sidebar-section-title">Features & Workflows</div>
                  <button onClick={() => setActiveSection("managing-memories")} className={`sidebar-button ${activeSection === "managing-memories" ? "active" : ""}`}>
                    <span>🧠</span> Managing Memories
                  </button>
                  <button onClick={() => setActiveSection("import-memories")} className={`sidebar-button ${activeSection === "import-memories" ? "active" : ""}`}>
                    <span>📥</span> Importing & Migrating
                  </button>
                  <button onClick={() => setActiveSection("team-collaboration")} className={`sidebar-button ${activeSection === "team-collaboration" ? "active" : ""}`}>
                    <span>👥</span> Team Collaboration
                  </button>
                  <button onClick={() => setActiveSection("stack-creator")} className={`sidebar-button ${activeSection === "stack-creator" ? "active" : ""}`}>
                    <span>🛠️</span> Tech Stack Creator
                  </button>
                  <button onClick={() => setActiveSection("templates")} className={`sidebar-button ${activeSection === "templates" ? "active" : ""}`}>
                    <span>📋</span> Blueprint Templates
                  </button>
                  <button onClick={() => setActiveSection("export-rules")} className={`sidebar-button ${activeSection === "export-rules" ? "active" : ""}`}>
                    <span>💾</span> Exporting Agent Rules
                  </button>
                </div>

                <div>
                  <div className="sidebar-section-title">MCP Reference</div>
                  <button onClick={() => setActiveSection("mcp-about")} className={`sidebar-button ${activeSection === "mcp-about" ? "active" : ""}`}>
                    <span>💡</span> About MCP
                  </button>
                  <button onClick={() => setActiveSection("mcp-tools-retrieval")} className={`sidebar-button ${activeSection === "mcp-tools-retrieval" ? "active" : ""}`}>
                    <span>🔍</span> Context Retrieval
                  </button>
                  <button onClick={() => setActiveSection("mcp-tools-mutation")} className={`sidebar-button ${activeSection === "mcp-tools-mutation" ? "active" : ""}`}>
                    <span>✍️</span> Memory Mutation
                  </button>
                  <button onClick={() => setActiveSection("mcp-tools-sync")} className={`sidebar-button ${activeSection === "mcp-tools-sync" ? "active" : ""}`}>
                    <span>🔄</span> Agent Syncing
                  </button>
                  <button onClick={() => setActiveSection("mcp-errors-security")} className={`sidebar-button ${activeSection === "mcp-errors-security" ? "active" : ""}`}>
                    <span>⚠️</span> Errors & Security
                  </button>
                </div>
              </>
            ) : null}

            <div>
              <div className="sidebar-section-title">Client Integrations</div>
              {PLATFORM_GROUPS.map((group) => {
                const groupServices = filteredIntegrations.filter((s) => s.group === group);
                if (groupServices.length === 0) return null;
                return (
                  <div key={group} style={{ marginBottom: 6 }}>
                    {!searchQuery && (
                      <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", paddingLeft: 10, margin: "6px 0 4px", opacity: 0.6 }}>
                        {group}
                      </div>
                    )}
                    {groupServices.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => setActiveSection(s.id)}
                        className={`sidebar-button ${activeSection === s.id ? "active" : ""}`}
                        style={{ paddingLeft: searchQuery ? 10 : 16 }}
                      >
                        <span style={{ fontSize: 11 }}>●</span> {s.label}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>

            {!searchQuery ? (
              <div>
                <div className="sidebar-section-title">Diagnostics</div>
                <button onClick={() => setActiveSection("tester")} className={`sidebar-button ${activeSection === "tester" ? "active" : ""}`}>
                  <span>🔌</span> Connection Tester
                </button>
              </div>
            ) : null}
          </div>
        </aside>

        {/* Content panel */}
        <main className="docs-content-wrapper">
          <article className="docs-content">
            {renderContent()}
          </article>
        </main>
      </div>
    </div>
  );
}
