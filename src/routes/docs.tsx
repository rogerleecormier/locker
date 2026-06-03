import { createFileRoute } from "@tanstack/react-router";
import { useState, useCallback, useMemo } from "react";
import { ALL_TOOLS } from "./_api.mcp";
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
      description: "Connect the Claude Desktop app directly to your hosted MCP endpoint.",
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
            <li>Go to <strong>Admin → API Tokens</strong> and generate a new token. Copy it — it's shown only once.</li>
            <li>Open <code>claude_desktop_config.json</code> (under <code>~/.config/Claude/</code> on Linux/Mac or <code>%APPDATA%/Claude/</code> on Windows).</li>
            <li>Add the <code>locker</code> block (copy snippet below) into <code>mcpServers</code>, replacing <code>lkr_your_token_here</code> with your token.</li>
            <li>Restart Claude Desktop. The tools will appear in your chats.</li>
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
      description: "Connect Locker to the Claude Code CLI. Fully tested and working.",
      copyText: `claude mcp add --transport http locker ${origin}/api/mcp --header "Authorization: Bearer lkr_your_token_here"`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Admin → API Tokens</strong> and generate a new token. Copy it — it's shown only once.</li>
            <li>Run the command below in your terminal, replacing <code>lkr_your_token_here</code> with your token.</li>
            <li>The default scope is <code>local</code> (project-level, not committed). Add <code>--scope project</code> to write a shareable <code>.mcp.json</code> at the project root, or <code>--scope user</code> to apply it across all projects.</li>
            <li>Verify with <code>claude mcp list</code>. Locker tools are now available in your Claude Code CLI sessions.</li>
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
      description: "Integrate Locker into the Claude Code VS Code extension. Fully tested and working.",
      copyText: `claude mcp add --transport http locker ${origin}/api/mcp --header "Authorization: Bearer lkr_your_token_here"`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Admin → API Tokens</strong> and generate a new token. Copy it — it's shown only once.</li>
            <li>Run the command below in your terminal, replacing <code>lkr_your_token_here</code> with your token. <strong>The CLI is required to add servers</strong> — this cannot be done from the VS Code extension.</li>
            <li>The default scope is <code>local</code> (project-level, not committed). Add <code>--scope project</code> to write a shareable <code>.mcp.json</code> at the project root, or <code>--scope user</code> to apply it across all projects.</li>
            <li>Verify with <code>claude mcp list</code>. Once added, the VS Code extension picks up the server automatically — use <code>/mcp</code> in the chat panel to view status or reconnect.</li>
          </ol>
        </div>
      ),
    },
    {
      id: "claudeweb",
      label: "Claude (Web)",
      color: "#b85c38",
      group: "Anthropic",
      tested: true,
      description: "Connect claude.ai to your Locker vault via the Connectors feature. Uses OAuth — no API token needed. Requires a Claude Pro, Team, or Enterprise plan.",
      copyText: `${origin}/api/mcp`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Open <strong>claude.ai</strong> → click your profile avatar → <strong>Settings → Connectors → Add connector</strong>.</li>
            <li>Enter a name (e.g. <code>Locker</code>) and paste the server URL below.</li>
            <li>Claude will redirect you to Locker to sign in and approve access — no API token needed.</li>
            <li>Once authorized, the Locker memory tools will be available in your Claude.ai chats.</li>
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
      description: "Connect GitHub Copilot Chat in VS Code to Locker.",
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
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Admin → API Tokens</strong> and generate a new token.</li>
            <li>Open VS Code Settings → search <strong>MCP</strong> → click <strong>Edit in settings.json</strong>.</li>
            <li>Add the snippet below under <code>github.copilot.chat.mcp</code>, replacing <code>lkr_your_token_here</code> with your token.</li>
            <li>Copilot Chat will fetch memory context when answering questions.</li>
          </ol>
        </div>
      ),
    },
    {
      id: "vscode",
      label: "VS Code",
      color: "#007acc",
      group: "VS Code",
      description: "Configure VS Code MCP support via .vscode/mcp.json in your workspace.",
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
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Admin → API Tokens</strong> and generate a new token.</li>
            <li>Create or edit <code>.vscode/mcp.json</code> in your workspace root.</li>
            <li>Paste the snippet below, replacing <code>lkr_your_token_here</code> with your token.</li>
            <li>VS Code will pick up the server on the next session start.</li>
          </ol>
        </div>
      ),
    },
    {
      id: "codex_cli",
      label: "Codex CLI",
      color: "#0f9d58",
      group: "OpenAI",
      description: "Connect the OpenAI Codex CLI to Locker via native HTTP MCP transport — no mcp-remote wrapper needed.",
      copyText: `[mcp_servers.locker]
url = "${origin}/api/mcp"
http_headers = { "Authorization" = "Bearer lkr_your_token_here" }
enabled = true`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Admin → API Tokens</strong> and generate a new token.</li>
            <li>Open <code>~/.codex/config.toml</code> (create it if it doesn't exist — Codex uses TOML, not JSON).</li>
            <li>Paste the snippet below, replacing <code>lkr_your_token_here</code> with your token.</li>
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
      description: "Connect the Codex desktop app (macOS/Windows) to Locker — it shares the same config file as the CLI.",
      copyText: `[mcp_servers.locker]
url = "${origin}/api/mcp"
http_headers = { "Authorization" = "Bearer lkr_your_token_here" }
enabled = true`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Admin → API Tokens</strong> and generate a new token.</li>
            <li>In the Codex app, open the gear menu and select <strong>MCP settings → Open config.toml</strong>.</li>
            <li>Paste the snippet below, replacing <code>lkr_your_token_here</code> with your token.</li>
            <li>Save the file — Codex picks up the change without a restart.</li>
          </ol>
        </div>
      ),
    },
    {
      id: "codex_vscode",
      label: "Codex Extension",
      color: "#0a7a46",
      group: "OpenAI",
      description: "Connect the official OpenAI Codex VS Code extension to Locker — same config.toml as the CLI and app.",
      copyText: `[mcp_servers.locker]
url = "${origin}/api/mcp"
http_headers = { "Authorization" = "Bearer lkr_your_token_here" }
enabled = true`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Admin → API Tokens</strong> and generate a new token.</li>
            <li>In the Codex extension sidebar, open the gear menu and select <strong>MCP settings → Open config.toml</strong>.</li>
            <li>Paste the snippet below, replacing <code>lkr_your_token_here</code> with your token.</li>
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
            <li>Open <code>~/.codeium/windsurf/mcp_config.json</code> on macOS/Linux, or <code>%USERPROFILE%\.codeium\windsurf\mcp_config.json</code> on Windows (create if it doesn't exist).</li>
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
            <li>Open <code>~/.config/amp/settings.json</code> on macOS/Linux, or <code>%APPDATA%\amp\settings.json</code> on Windows. For a single project, use <code>.amp/settings.json</code> at the project root.</li>
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
            <h2 style={{ fontSize: 24, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>System Overview</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.7, marginBottom: 20 }}>
              Locker is a secure, long-term personal and team memory vault built for artificial intelligence workflows. 
              It provides a standardized, encrypted location for AI clients to store and retrieve technical context, 
              coding rules, team preferences, and project specifications.
            </p>
            
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 28 }}>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 18 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--accent)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  ⚡ Semantic Retrieval
                </h3>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.5 }}>
                  Powered by Cloudflare Vectorize. Facts are queried using vector embeddings, returning semantically relevant results in less than 50 milliseconds globally.
                </p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 18 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--accent)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  🔒 End-to-End Encrypted
                </h3>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.5 }}>
                  All memory data is encrypted using AES-256-GCM prior to database insertion. Decryption keys remain strictly inside the edge worker process.
                </p>
              </div>
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>Core Capabilities</h3>
            <ul style={{ paddingLeft: 20, color: "var(--text-muted)", fontSize: 14, lineHeight: 1.8, display: "flex", flexDirection: "column", gap: 6 }}>
              <li><strong>Zero-Plaintext Storage:</strong> Database logs, D1 backups, and indices are completely encrypted and unreadable without server-side keys.</li>
              <li><strong>Granular Authorization:</strong> API tokens are created with strict permissions, allowing you to define read-only or read-write access for different clients.</li>
              <li><strong>Collaborative Vaults:</strong> Share specific technical documentation or project notes with your team by configuring Organization hubs.</li>
              <li><strong>Recommendation Queue:</strong> Review proposed memory additions submitted by AI models mid-session before committing them to the permanent vault.</li>
            </ul>
          </div>
        );
      case "connection-auth":
        return (
          <div>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>Connection & Authentication</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.7, marginBottom: 24 }}>
              To connect an external AI model or development assistant to Locker, you must supply the Model Context Protocol (MCP) endpoint address and a cryptographically signed API token.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
                    MCP Endpoint Endpoint Address
                  </span>
                  <button
                    onClick={() => handleCopy(`${origin}/api/mcp`)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "2px 8px",
                      background: "transparent",
                      border: "none",
                      color: "var(--accent)",
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    <CopyIcon size={11} /> Copy
                  </button>
                </div>
                <code style={{ display: "block", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "10px 12px", fontFamily: "monospace", fontSize: 12, color: "var(--text)", overflow: "auto" }}>
                  {origin}/api/mcp
                </code>
              </div>

              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
                    HTTP Authentication Header
                  </span>
                  <button
                    onClick={() => handleCopy("Authorization: Bearer <your-api-token>")}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "2px 8px",
                      background: "transparent",
                      border: "none",
                      color: "var(--accent)",
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    <CopyIcon size={11} /> Copy
                  </button>
                </div>
                <code style={{ display: "block", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "10px 12px", fontFamily: "monospace", fontSize: 12, color: "var(--text)", overflow: "auto" }}>
                  Authorization: Bearer &lt;your-api-token&gt;
                </code>
              </div>
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginTop: 28, marginBottom: 12 }}>Obtaining an API Token</h3>
            <ol style={{ paddingLeft: 20, color: "var(--text-muted)", fontSize: 14, lineHeight: 1.8, display: "flex", flexDirection: "column", gap: 6 }}>
              <li>Navigate to the <strong>Admin</strong> page from the top navigation bar.</li>
              <li>Under the personal settings sidebar, click <strong>API Tokens</strong>.</li>
              <li>Click the <strong>Generate Token</strong> button. Give the token a name (e.g., <code>Claude Desktop</code>) and select the specific scopes it is authorized to call (such as <code>recall_context</code> or <code>commit_memory</code>).</li>
            </ol>
          </div>
        );
      case "import-memories":
        return (
          <div>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>Importing & Migrating</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.7, marginBottom: 20 }}>
              Migrating your personal context, rules, and inferred preferences from existing platforms is a simple two-step process in Locker. You can copy custom extraction prompts for major LLMs and batch ingest them using our AI parsing tool.
            </p>

            <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>Workflow</h3>
            <ol style={{ paddingLeft: 20, color: "var(--text-muted)", fontSize: 14, lineHeight: 1.8, marginBottom: 24 }}>
              <li>Open the <strong>Import</strong> tab in the navigation bar.</li>
              <li>Select your source platform (ChatGPT, Claude, Perplexity, Gemini, Grok, or Microsoft Copilot).</li>
              <li>Locker displays a custom prompt tailored to extract that chatbot's internal memory store and custom instructions. Click <strong>Copy Prompt</strong> (or <strong>Deep Link Search</strong>).</li>
              <li>Paste the prompt into your chat session with that LLM. The AI will output all its saved memories and inferred preferences in a structured code block.</li>
              <li>Paste the output code block into the Locker import panel and select a project workspace scope.</li>
              <li>Click <strong>Parse with AI</strong>. Locker will automatically deduplicate, categorize (rules, projects, or references), and tag the raw dump.</li>
              <li>Verify the parsed facts on screen and click <strong>Batch Import Memories</strong> to encrypt and save them.</li>
            </ol>

            <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>Supported Platforms</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 14 }}>
                <h4 style={{ margin: "0 0 4px 0", fontSize: 13, fontWeight: 600, color: "var(--text)" }}>ChatGPT & Claude</h4>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0, lineHeight: 1.5 }}>Extracts both explicit saved memory slots, custom system instructions, and implicit behavioral inferences.</p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 14 }}>
                <h4 style={{ margin: "0 0 4px 0", fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Perplexity & Gemini</h4>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0, lineHeight: 1.5 }}>Pulls details from Perplexity personalization slots and Gemini "Saved Info" panels verbatim.</p>
              </div>
            </div>
          </div>
        );
      case "team-collaboration":
        return (
          <div>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>Team Collaboration</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.7, marginBottom: 20 }}>
              Establish shared coding standards and stack specifications for your entire development team. Group members, assign roles, and connect shared workspace keys to eliminate drift across local developer environments.
            </p>

            <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>Organizations & Teams</h3>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.7, marginBottom: 16 }}>
              Locker enforces clean hierarchical boundaries to govern shared memories:
            </p>
            <ul style={{ paddingLeft: 20, color: "var(--text-muted)", fontSize: 14, lineHeight: 1.8, marginBottom: 24 }}>
              <li><strong>Organizations:</strong> Billing hubs that manage member seat allocations, subscription quotas, and general workspace keys.</li>
              <li><strong>Teams:</strong> Granular sub-groups (e.g. <code>frontend-team</code>, <code>devops-team</code>). You can restrict memory blocks or project scopes to specific teams so developers only receive context relevant to their work.</li>
            </ul>

            <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>User Roles & Governance</h3>
            <div style={{ overflowX: "auto", marginBottom: 24 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, textAlign: "left" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--border)" }}>
                    <th style={{ padding: "8px 12px", color: "var(--text)" }}>Role</th>
                    <th style={{ padding: "8px 12px", color: "var(--text)" }}>Permissions & Access Boundaries</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "10px 12px", fontWeight: "bold", color: "var(--accent)" }}>Owner</td>
                    <td style={{ padding: "10px 12px", color: "var(--text-muted)", lineHeight: 1.5 }}>Full billing control, seat upgrades, organization deletion, role modification, and member pruning.</td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "10px 12px", fontWeight: "bold", color: "var(--accent)" }}>Admin</td>
                    <td style={{ padding: "10px 12px", color: "var(--text-muted)", lineHeight: 1.5 }}>Create teams, issue email invitations, delete/update shared organization memories, and edit general team lists.</td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "10px 12px", fontWeight: "bold", color: "var(--text)" }}>Member</td>
                    <td style={{ padding: "10px 12px", color: "var(--text-muted)", lineHeight: 1.5 }}>Read-only access or read-write access to specific scoped memory cards based on team memberships.</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>Inviting Members</h3>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.7, marginBottom: 20 }}>
              Owners and Admins can invite new developers from the <strong>Organization</strong> view by typing their email. Locker generates a cryptographically signed magic link valid for 48 hours and sends an invitation email using Cloudflare's built-in Email Worker bindings.
            </p>
          </div>
        );
      case "managing-memories":
        return (
          <div>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>Managing Memories</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.7, marginBottom: 20 }}>
              Locker provides a flexible interface for managing your long-term memory vault. Memories can be created, updated, and purged either through the browser-based dashboard or directly by connected AI developer tools using Model Context Protocol (MCP).
            </p>

            <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>Managing Memories in the UI</h3>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.7, marginBottom: 16 }}>
              The <strong>Vault</strong> dashboard displays all your current saved memories, categorized and searchable:
            </p>
            <ul style={{ paddingLeft: 20, color: "var(--text-muted)", fontSize: 14, lineHeight: 1.8, marginBottom: 24 }}>
              <li><strong>Creating Memories:</strong> Click the <strong>New Memory</strong> button at the top right of the dashboard. Select a Category (Rules, Projects, or References), write the Fact text, add custom tags, and optionally associate it with a specific <strong>Project Workspace</strong> key to isolate instructions.</li>
              <li><strong>Editing & Deleting:</strong> Click the edit (pencil) icon on any memory card to modify its fields, or the delete icon to remove it. When you edit or delete a memory, Locker automatically updates the underlying SQL relational database and recalculates the semantic embeddings on Cloudflare Vectorize.</li>
              <li><strong>Queue Approval Workflow:</strong> Connected AI agents can suggest new rules or project details during coding sessions. Proposed memories go into the <strong>Recommendations Queue</strong>. You must log in and click <strong>Approve</strong> to persist these into long-term storage, or <strong>Reject</strong> to discard them, giving you complete oversight of your vault.</li>
            </ul>

            <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>Programmatic Management via MCP</h3>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.7, marginBottom: 16 }}>
              Locker exposes secure endpoints for AI models to retrieve and mutate memories in real time. Connected developer agents utilize these JSON-RPC commands behind the scenes:
            </p>
            <ul style={{ paddingLeft: 20, color: "var(--text-muted)", fontSize: 14, lineHeight: 1.8, marginBottom: 24 }}>
              <li><strong>Reading Context:</strong> Models call <button onClick={() => setActiveSection("mcp-tools")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit" }}>recall_context</button> for semantic vector searches and <button onClick={() => setActiveSection("mcp-tools")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit" }}>search_memories</button> for exact tag/keyword scans.</li>
              <li><strong>Mutating Store:</strong> Models use <button onClick={() => setActiveSection("mcp-tools")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit" }}>commit_memory</button> to suggest facts, <button onClick={() => setActiveSection("mcp-tools")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit" }}>update_memory</button> to refine facts, and <button onClick={() => setActiveSection("mcp-tools")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit" }}>delete_memory</button> to remove stale data.</li>
            </ul>
            <div style={{
              background: "rgba(168, 85, 247, 0.05)",
              border: "1px solid rgba(168, 85, 247, 0.2)",
              borderRadius: "var(--radius)",
              padding: "12px 16px",
              fontSize: 13,
              color: "var(--text-muted)",
              lineHeight: 1.6,
            }}>
              <strong>💡 Developer Tip:</strong> For more detailed input schemas, required parameters, and configuration guides for all management tools, head over to the full <button onClick={() => setActiveSection("mcp-tools")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", fontWeight: "bold", textDecoration: "underline", padding: 0, font: "inherit" }}>MCP Tools Reference List</button>.
            </div>
          </div>
        );
      case "stack-creator":
        return (
          <div>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>Tech Stack Creator</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.7, marginBottom: 20 }}>
              The <strong>Tech Stack Creator</strong> is an interactive step-by-step wizard that allows you to define your workspace's technology profile across 12 architectural categories. Locker utilizes this profile to automatically compile optimized coding rules and agentic instructions.
            </p>

            <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 18, marginBottom: 24 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--accent)", marginBottom: 8 }}>
                🛠️ 12 Technology Categories
              </h3>
              <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 12 }}>
                Locker segments your stack into modular selections to enforce clean structural boundaries:
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px", fontSize: 12, color: "var(--text)" }}>
                <div>• <strong>Language</strong> (TypeScript, Go, Python, Rust)</div>
                <div>• <strong>Runtime</strong> (Node.js, Bun, Native Runtimes)</div>
                <div>• <strong>Frontend</strong> (React, Next.js, Vue, Svelte)</div>
                <div>• <strong>Backend Framework</strong> (Express, Hono, Django, FastAPI)</div>
                <div>• <strong>Database</strong> (Cloudflare D1, PostgreSQL, SQLite, MySQL)</div>
                <div>• <strong>ORM / DB Client</strong> (Drizzle ORM, Prisma, sqlx, pg)</div>
                <div>• <strong>Deploy Platform</strong> (Workers, Vercel, Fly.io, AWS)</div>
                <div>• <strong>Styling Strategy</strong> (Tailwind, Vanilla CSS, Styled Components)</div>
                <div>• <strong>Lint & Format</strong> (ESLint + Prettier, Biome, Ruff)</div>
                <div>• <strong>Test Runner</strong> (Vitest, Jest, Playwright)</div>
                <div>• <strong>State Management</strong> (Zustand, Redux, Jotai)</div>
                <div>• <strong>Build Tool</strong> (Vite, Webpack, Esbuild)</div>
              </div>
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>Workflow</h3>
            <ol style={{ paddingLeft: 20, color: "var(--text-muted)", fontSize: 14, lineHeight: 1.8, display: "flex", flexDirection: "column", gap: 6 }}>
              <li>Navigate to the <strong>Vault</strong> page and click the <strong>New Memory</strong> button.</li>
              <li>Select <strong>Tech Stack Creator</strong> to launch the step-by-step wizard.</li>
              <li>Provide your selections for each of the 12 tech stack categories.</li>
              <li>Input any custom <strong>negative constraints</strong> (e.g., "no Tailwind inline utilities" or "do not write raw SQL queries outside repos").</li>
              <li>Click <strong>Review Recommended Blueprint</strong> to compile rules tailored to your choices. Adjust individual guidelines before saving.</li>
              <li>Click <strong>Store Memory</strong> to save these rules globally or to a specific project scope. The constraints are instantly synced without exposing database structures to local clients.</li>
            </ol>
          </div>
        );
      case "templates":
        return (
          <div>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>Blueprint Templates</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.7, marginBottom: 20 }}>
              <strong>Blueprint Templates</strong> enable teams and individual developers to save, edit, and share standard configuration profiles. Instead of selecting the same 12 categories repeatedly, you can load templates directly to populate your rules baseline instantly.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 28 }}>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 18 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--accent)", marginBottom: 8 }}>
                  💾 Creating Templates
                </h3>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.5 }}>
                  Go to the <strong>Templates</strong> view and click <strong>New Template</strong>. Set up the stack selections, custom constraints, and rule lists. Save to add the template to your database.
                </p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 18 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--accent)", marginBottom: 8 }}>
                  ⚡ Instant Loading
                </h3>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.5 }}>
                  In the Stack Creator wizard, click <strong>Load Custom Stack Blueprints</strong> to choose a template. The selections, constraints, and recommendations load instantly.
                </p>
              </div>
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>Bypassing LLM Regeneration</h3>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.7, marginBottom: 20 }}>
              If a template already has verified instruction sets, Locker displays a <strong>"Use Loaded Template Rules"</strong> button. Clicking this skips LLM regeneration completely and sends you directly to the review step, reducing token overhead and conserving processing time.
            </p>
          </div>
        );
      case "export-rules":
        return (
          <div>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>Exporting Agent Rules</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.7, marginBottom: 24 }}>
              Locker translates your memory rules and tech stack blueprints into optimized configuration files formatted for specific AI developer agents.
            </p>

            <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>Supported Formats & Targets</h3>
            <div style={{ overflowX: "auto", marginBottom: 28 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, textAlign: "left" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--border)" }}>
                    <th style={{ padding: "8px 12px", color: "var(--text)" }}>Format File</th>
                    <th style={{ padding: "8px 12px", color: "var(--text)" }}>Agent / IDE Client</th>
                    <th style={{ padding: "8px 12px", color: "var(--text)" }}>Recommended Target Path</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "10px 12px", fontFamily: "monospace", color: "var(--accent)" }}>CLAUDE.md</td>
                    <td style={{ padding: "10px 12px", color: "var(--text-muted)" }}>Claude Code (CLI / Extension)</td>
                    <td style={{ padding: "10px 12px", fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)" }}>./CLAUDE.md</td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "10px 12px", fontFamily: "monospace", color: "var(--accent)" }}>.cursorrules</td>
                    <td style={{ padding: "10px 12px", color: "var(--text-muted)" }}>Cursor Editor (JSON formatted)</td>
                    <td style={{ padding: "10px 12px", fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)" }}>./.cursorrules</td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "10px 12px", fontFamily: "monospace", color: "var(--accent)" }}>copilot-instructions.md</td>
                    <td style={{ padding: "10px 12px", color: "var(--text-muted)" }}>GitHub Copilot Chat</td>
                    <td style={{ padding: "10px 12px", fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)" }}>./.github/copilot-instructions.md</td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "10px 12px", fontFamily: "monospace", color: "var(--accent)" }}>GEMINI.md</td>
                    <td style={{ padding: "10px 12px", color: "var(--text-muted)" }}>Gemini Code Assist / Global Rules</td>
                    <td style={{ padding: "10px 12px", fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)" }}>~/.gemini/GEMINI.md</td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "10px 12px", fontFamily: "monospace", color: "var(--accent)" }}>AGENTS.md</td>
                    <td style={{ padding: "10px 12px", color: "var(--text-muted)" }}>OpenAI Codex & General Agents</td>
                    <td style={{ padding: "10px 12px", fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)" }}>./AGENTS.md</td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "10px 12px", fontFamily: "monospace", color: "var(--accent)" }}>.agents/rules/rules.md</td>
                    <td style={{ padding: "10px 12px", color: "var(--text-muted)" }}>Google Antigravity Workspaces</td>
                    <td style={{ padding: "10px 12px", fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)" }}>./.agents/rules/rules.md</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>Method A: Direct Downloads via UI</h3>
            <ol style={{ paddingLeft: 20, color: "var(--text-muted)", fontSize: 14, lineHeight: 1.8, marginBottom: 24, display: "flex", flexDirection: "column", gap: 6 }}>
              <li>Open the <strong>Vault</strong> page, click the <strong>Export Config File</strong> button on any stack card.</li>
              <li>Select your target format dropdown option (e.g. <code>.agents/rules/rules.md</code>).</li>
              <li>Click <strong>Download Rules</strong> to trigger browser file delivery. Move it to the appropriate destination directory.</li>
            </ol>

            <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>Method B: Workspace Sync via MCP Tool</h3>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.7, marginBottom: 16 }}>
              If your developer agent is connected via MCP (e.g. Claude Code or Antigravity), it can call Locker's native sync tool to build and write rules files directly inside your active workspace without manual downloads.
            </p>
            <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 18 }}>
              <h4 style={{ margin: "0 0 8px 0", fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Tool: sync_workspace_agent_configs</h4>
              <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px 0", lineHeight: 1.5 }}>
                Writes compiled stack instructions into files matching the target path schema of the requested formatting convention.
              </p>
              <pre style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: 12,
                margin: 0,
                fontFamily: "monospace",
                fontSize: 11,
                color: "var(--text)",
                overflow: "auto",
                lineHeight: 1.5,
              }}>{`{
  "method": "tools/call",
  "params": {
    "name": "sync_workspace_agent_configs",
    "arguments": {
      "formatType": "claude", // or cursor, copilot, gemini, agents, antigravity
      "projectKey": "locker" // optional project filter
    }
  }
}`}</pre>
            </div>
          </div>
        );
      case "mcp-about":
        return (
          <div>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>Model Context Protocol (MCP)</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.7, marginBottom: 20 }}>
              The Model Context Protocol (MCP) is an open-source standard created by Anthropic that allows clients (such as local AI applications, IDEs, and CLI tools) to safely communicate with external tools, APIs, and data stores through unified schemas.
            </p>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.7, marginBottom: 20 }}>
              Instead of building bespoke integrations for every editor and model, MCP defines a standard JSON-RPC 2.0 protocol over HTTP or standard input/output streams. Locker uses the HTTP transport protocol, exposing a set of tools that models can invoke at any time during a conversation context.
            </p>
            <div style={{ background: "rgba(168,85,247,0.06)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 16, marginTop: 24 }}>
              <h4 style={{ margin: "0 0 6px 0", color: "var(--text)", fontSize: 13, fontWeight: 600 }}>💡 Standard JSON-RPC Format</h4>
              <p style={{ color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5, margin: 0 }}>
                External clients communicate with Locker using POST requests. Request payloads follow standard JSON-RPC 2.0 formatting: e.g., specifying <code>method: "tools/call"</code> along with the target tool name and parameters in the <code>params</code> argument.
              </p>
            </div>
          </div>
        );
      case "mcp-tools":
        return (
          <div>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>MCP Tools Reference</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.7, marginBottom: 24 }}>
              The following tools are exposed by the Locker endpoint. AI models with the proper token scopes can invoke these tools automatically.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {ALL_TOOLS.map((tool) => (
                <div key={tool.name} style={{
                  background: "var(--surface2)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  padding: 18,
                }}>
                  <h3 style={{ margin: "0 0 8px 0", fontSize: 15, fontWeight: 600, color: "var(--accent)", fontFamily: "monospace" }}>
                    {tool.name}
                  </h3>
                  <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 16px 0", lineHeight: 1.6 }}>
                    {tool.description}
                  </p>
                  <div>
                    <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "0 0 6px 0", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
                      Input Schema
                    </p>
                    <pre style={{
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
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
              ))}
            </div>
          </div>
        );
      case "tester":
        return (
          <div>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>Connection Tester</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.7, marginBottom: 24 }}>
              Use this utility to test if the Locker MCP server endpoint is operational. This diagnostic calls the <code>tools/list</code> JSON-RPC method to verify connection.
            </p>

            <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
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
                    fontWeight: 600,
                    fontSize: 13,
                    transition: "all 0.2s",
                    cursor: testLoading ? "not-allowed" : "pointer",
                    border: "none",
                    borderRadius: "var(--radius)",
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
                  borderRadius: "var(--radius)",
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
          font-size: 10px;
          font-weight: 700;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          margin: 12px 0 6px 8px;
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
            <option value="mcp-tools">Tools Schema</option>
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
                  <button onClick={() => setActiveSection("mcp-tools")} className={`sidebar-button ${activeSection === "mcp-tools" ? "active" : ""}`}>
                    <span>🛠️</span> Tools List
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
