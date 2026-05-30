import { createFileRoute } from "@tanstack/react-router";
import { useState, useCallback } from "react";
import { PLATFORM_GROUPS } from "../lib/platforms";

export const Route = createFileRoute("/connect")({
  component: ConnectPage,
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
  group: string;
  description: string;
  instructions: React.ReactNode;
  copyText?: string;
  tested?: boolean;
};

function ConnectPage() {
  const [selectedService, setSelectedService] = useState<string>("claudedesktop");
  const [copied, setCopied] = useState(false);

  const SERVICES: SetupService[] = [
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
        "https://locker.rcormier.dev/api/mcp",
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
            <li>Go to <strong>Settings → API Tokens</strong> and generate a new token. Copy it — it's shown only once.</li>
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
      copyText: `claude mcp add --transport http locker https://locker.rcormier.dev/api/mcp --header "Authorization: Bearer lkr_your_token_here"`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Settings → API Tokens</strong> and generate a new token. Copy it — it's shown only once.</li>
            <li>Run the command below in your terminal, replacing <code>lkr_your_token_here</code> with your token.</li>
            <li>To scope it to one project instead of globally, add <code>--scope project</code> — this writes a <code>.mcp.json</code> at the project root.</li>
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
      copyText: `claude mcp add --transport http locker https://locker.rcormier.dev/api/mcp --header "Authorization: Bearer lkr_your_token_here"`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Settings → API Tokens</strong> and generate a new token. Copy it — it's shown only once.</li>
            <li>Run the command below in your terminal, replacing <code>lkr_your_token_here</code> with your token. <strong>The CLI is required to add servers</strong> — this cannot be done from the VS Code extension.</li>
            <li>To scope it to one project instead of globally, add <code>--scope project</code> — this writes a <code>.mcp.json</code> at the project root.</li>
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
      copyText: `https://locker.rcormier.dev/api/mcp`,
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
      copyText: `npx -y mcp-remote https://locker.rcormier.dev/api/mcp --header "Authorization: Bearer lkr_your_token_here"`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Settings → API Tokens</strong> and generate a new token.</li>
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
        "https://locker.rcormier.dev/api/mcp",
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
            <li>Go to <strong>Settings → API Tokens</strong> and generate a new token.</li>
            <li>Open <code>cline_mcp_settings.json</code> (at <code>~/.vscode/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json</code>).</li>
            <li>Add the <code>locker</code> block (copy snippet below) into <code>mcpServers</code>, replacing <code>lkr_your_token_here</code> with your token.</li>
            <li>Cline will reload and gain access to the memory tools.</li>
          </ol>
        </div>
      ),
    },
    {
      id: "roocode",
      label: "Roo Code",
      color: "#ff8787",
      group: "VS Code",
      description: "Add Locker memory context directly to Roo Code inside VS Code.",
      copyText: `{
  "mcpServers": {
    "locker": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://locker.rcormier.dev/api/mcp",
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
            <li>Go to <strong>Settings → API Tokens</strong> and generate a new token.</li>
            <li>Open the Roo Code MCP settings file (under globalStorage for the extension).</li>
            <li>Add the <code>locker</code> block (copy snippet below) into <code>mcpServers</code>, replacing <code>lkr_your_token_here</code> with your token.</li>
            <li>Save — Roo Code detects the server immediately.</li>
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
      "https://locker.rcormier.dev/api/mcp",
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
            <li>Go to <strong>Settings → API Tokens</strong> and generate a new token.</li>
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
        "https://locker.rcormier.dev/api/mcp",
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
            <li>Go to <strong>Settings → API Tokens</strong> and generate a new token.</li>
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
        "https://locker.rcormier.dev/api/mcp",
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
            <li>Go to <strong>Settings → API Tokens</strong> and generate a new token.</li>
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
url = "https://locker.rcormier.dev/api/mcp"
http_headers = { "Authorization" = "Bearer lkr_your_token_here" }
enabled = true`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Settings → API Tokens</strong> and generate a new token.</li>
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
url = "https://locker.rcormier.dev/api/mcp"
http_headers = { "Authorization" = "Bearer lkr_your_token_here" }
enabled = true`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Settings → API Tokens</strong> and generate a new token.</li>
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
url = "https://locker.rcormier.dev/api/mcp"
http_headers = { "Authorization" = "Bearer lkr_your_token_here" }
enabled = true`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Settings → API Tokens</strong> and generate a new token.</li>
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
      "serverUrl": "https://locker.rcormier.dev/api/mcp",
      "headers": {
        "Authorization": "Bearer lkr_your_token_here"
      }
    }
  }
}`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Settings → API Tokens</strong> and generate a new token.</li>
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
      "serverUrl": "https://locker.rcormier.dev/api/mcp",
      "headers": {
        "Authorization": "Bearer lkr_your_token_here"
      }
    }
  }
}`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Settings → API Tokens</strong> and generate a new token.</li>
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
      "serverUrl": "https://locker.rcormier.dev/api/mcp",
      "headers": {
        "Authorization": "Bearer lkr_your_token_here"
      }
    }
  }
}`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Settings → API Tokens</strong> and generate a new token.</li>
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
      "httpUrl": "https://locker.rcormier.dev/api/mcp",
      "headers": {
        "Authorization": "Bearer lkr_your_token_here"
      }
    }
  }
}`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Settings → API Tokens</strong> and generate a new token.</li>
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
      "url": "https://locker.rcormier.dev/api/mcp",
      "headers": {
        "Authorization": "Bearer lkr_your_token_here"
      }
    }
  }
}`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Settings → API Tokens</strong> and generate a new token.</li>
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
      "url": "https://locker.rcormier.dev/api/mcp",
      "headers": {
        "Authorization": "Bearer lkr_your_token_here"
      }
    }
  }
}`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Settings → API Tokens</strong> and generate a new token.</li>
            <li>Open <code>~/.config/amp/settings.json</code> on macOS/Linux, or <code>%APPDATA%\amp\settings.json</code> on Windows. For a single project, use <code>.amp/settings.json</code> at the project root.</li>
            <li>Add the snippet below, replacing <code>lkr_your_token_here</code> with your token. Note: Amp uses <code>amp.mcpServers</code> as the top-level key.</li>
            <li>Or add via CLI: <code>amp mcp add locker --header "Authorization=Bearer lkr_your_token_here" https://locker.rcormier.dev/api/mcp</code></li>
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
      "url": "https://locker.rcormier.dev/api/mcp",
      "headers": {
        "Authorization": "Bearer lkr_your_token_here"
      }
    }
  }
}`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Settings → API Tokens</strong> and generate a new token.</li>
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
      "url": "https://locker.rcormier.dev"
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
            <li>Go to <strong>Settings → API Tokens</strong> and generate a new token. Copy it — shown only once.</li>
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
              You have access to a personal long-term memory vault called <strong>Locker</strong>. When the user asks about their projects, rules, preferences, or background, <strong>immediately call the mcpCall action</strong> with the appropriate tool. Do not defer or ask the user to retrieve it themselves.{'\n\n'}
              <strong>Tool Selection Guide:</strong>{'\n'}
              • <strong>Projects, active work:</strong> Call search_memories with {`{ "category": "projects", "limit": 100 }`}{'\n'}
              • <strong>Rules, guidelines, preferences:</strong> Call recall_context with {`{ "query": "<user's question>", "category": "rules", "topK": 10 }`}{'\n'}
              • <strong>Open-ended questions:</strong> Call recall_context with {`{ "query": "<user's question>", "topK": 10 }`}{'\n'}
              • <strong>Overview of memories:</strong> Call get_memory_summary with {`{}`}{'\n'}
              • <strong>Remember something new:</strong> Call commit_memory with {`{ "fact": "<statement>", "category": "rules" or "projects" or "references", "tags": "<tags>" }`}{'\n\n'}
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
      "httpUrl": "https://locker.rcormier.dev/api/mcp",
      "headers": {
        "Authorization": "Bearer lkr_your_token_here"
      }
    }
  }
}`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Settings → API Tokens</strong> and generate a new token.</li>
            <li>Open <code>~/.gemini/settings.json</code> (create it if it doesn't exist). For project-scoped config use <code>.gemini/settings.json</code> at your project root.</li>
            <li>Add the <code>locker</code> block (copy snippet below) into <code>mcpServers</code>, replacing <code>lkr_your_token_here</code> with your token.</li>
            <li>Or add via CLI: <code>gemini mcp add --transport http --header "Authorization: Bearer lkr_your_token_here" locker https://locker.rcormier.dev/api/mcp</code></li>
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
      copyText: `You have access to a personal memory retrieval API at https://locker.rcormier.dev/api/mcp. All requests require the header "Authorization: Bearer lkr_your_token_here". If you need context about my background, projects, or rules, send a POST request to that URL with the JSON-RPC body {"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"recall_context","arguments":{"query":"<topic>"}}} and include the Authorization header.`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Settings → API Tokens</strong> and generate a new token.</li>
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
            <li>Go to <strong>Settings → API Tokens</strong> and generate a new token.</li>
            <li>Create a custom <strong>Grok Agent</strong> on X.</li>
            <li>Add a <strong>Web Action</strong>: URL <code style={{ color: "var(--accent)" }}>https://locker.rcormier.dev/api/mcp</code>, method POST.</li>
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
      copyText: `You have access to my personal memory API at https://locker.rcormier.dev/api/mcp. All requests must include the header "Authorization: Bearer lkr_your_token_here". Query this endpoint when asked about my rules, preferences, active projects, or background by sending a POST with body {"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"recall_context","arguments":{"query":"<topic>"}}}.`,
      instructions: (
        <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Go to <strong>Settings → API Tokens</strong> and generate a new token.</li>
            <li>Create a new <strong>Collection</strong> in Perplexity.</li>
            <li>In <strong>AI Profile / Instructions</strong>, paste the directive below, replacing <code>lkr_your_token_here</code> with your token.</li>
            <li>Perplexity will include the Authorization header when querying Locker.</li>
          </ol>
        </div>
      ),
    },
  ];

  const service = SERVICES.find((s) => s.id === selectedService) ?? SERVICES[0];

  const handleCopy = useCallback(async () => {
    if (!service.copyText) return;
    await navigator.clipboard.writeText(service.copyText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [service.copyText]);

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "32px 20px" }}>
      <header style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
          </svg>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>MCP Connect</h1>
          <span style={{
            fontSize: 11,
            background: "var(--accent-dim)",
            color: "var(--accent)",
            border: "1px solid rgba(168,85,247,0.3)",
            borderRadius: 20,
            padding: "2px 8px",
            fontWeight: 600,
          }}>
            {SERVICES.length} platforms
          </span>
        </div>
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
          Connect any AI client to your Locker vault via the{" "}
          <code style={{ color: "var(--accent)", fontSize: 12 }}>/api/mcp</code> endpoint.
          <strong> Claude (Web) and Claude Code</strong> are fully tested. Guides for other platforms are provided as a best-effort reference and may need adjustment.
        </p>
      </header>

      <div style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        overflow: "hidden",
      }}>
        <div style={{
          padding: "12px 18px",
          borderBottom: "1px solid var(--border)",
          background: "rgba(168,85,247,0.04)",
        }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>
            Select platform
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {PLATFORM_GROUPS.map((group) => {
              const groupServices = SERVICES.filter((s) => s.group === group);
              if (groupServices.length === 0) return null;
              return (
                <div key={group}>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 5, opacity: 0.6 }}>
                    {group}
                  </div>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {groupServices.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => { setSelectedService(s.id); setCopied(false); }}
                        style={{
                          padding: "4px 12px",
                          background: selectedService === s.id ? `${s.color}22` : "var(--surface2)",
                          border: `1px solid ${selectedService === s.id ? s.color : "var(--border)"}`,
                          color: selectedService === s.id ? s.color : "var(--text-muted)",
                          fontWeight: selectedService === s.id ? 600 : 400,
                          fontSize: 12,
                          borderRadius: 20,
                          transition: "all 0.15s",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 5,
                        }}
                      >
                        {s.label}
                        {s.tested && (
                          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#22c55e", flexShrink: 0, opacity: 0.8 }} />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ padding: 20 }}>
          {service.tested ? (
            <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 7, padding: "7px 12px", background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.25)", borderRadius: 8 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              <span style={{ fontSize: 12, color: "#22c55e", fontWeight: 500 }}>Tested and confirmed working</span>
            </div>
          ) : (
            <div style={{ marginBottom: 12, display: "flex", alignItems: "flex-start", gap: 8, padding: "9px 12px", background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 8 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <span style={{ fontSize: 12, color: "#f59e0b", lineHeight: 1.5 }}>
                <strong>In testing.</strong> This guide has not been fully verified. Config syntax may vary by version — check the platform's official docs if something doesn't work.
              </span>
            </div>
          )}
          <div style={{
            marginBottom: 16,
            padding: "12px 14px",
            background: "rgba(255,255,255,0.02)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
          }}>
            <p style={{ color: "var(--text-muted)", fontSize: 12, marginBottom: 10 }}>{service.description}</p>
            {service.instructions}
          </div>

          {service.copyText && (
            <>
              <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                Configuration snippet
              </div>
              <pre style={{
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                padding: "12px 14px",
                fontFamily: "monospace",
                fontSize: 12,
                maxHeight: 260,
                overflowY: "auto",
                lineHeight: 1.6,
                color: "var(--text)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                marginBottom: 12,
              }}>
                {service.copyText}
              </pre>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  onClick={handleCopy}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "8px 16px",
                    background: copied ? "rgba(34,197,94,0.15)" : "var(--surface2)",
                    border: copied ? "1px solid rgba(34,197,94,0.4)" : "1px solid var(--border)",
                    color: copied ? "var(--success)" : "var(--text-muted)",
                    fontWeight: 500,
                    fontSize: 13,
                    transition: "all 0.2s",
                  }}
                >
                  {copied ? <CheckIcon /> : <CopyIcon />}
                  {copied ? "Copied!" : "Copy configuration"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
