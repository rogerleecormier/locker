export type PlatformMeta = {
  id: string;
  label: string;
  color: string;
  group: "Anthropic" | "OpenAI" | "Google" | "VS Code" | "Editors" | "Other" | "Local";
};

export const PLATFORMS: PlatformMeta[] = [
  // Anthropic
  { id: "claudeweb",          label: "Claude",                color: "#b85c38", group: "Anthropic" },
  { id: "claudecode",         label: "Claude Code Extension", color: "#c97b53", group: "Anthropic" },
  { id: "claudecli",          label: "Claude Code CLI",       color: "#9c6f3d", group: "Anthropic" },
  { id: "claudedesktop",      label: "Claude Desktop",        color: "#d4956a", group: "Anthropic" },
  // OpenAI
  { id: "chatgpt",            label: "ChatGPT",               color: "#10a37f", group: "OpenAI"    },
  { id: "codex_cli",          label: "Codex CLI",             color: "#0f9d58", group: "OpenAI"    },
  { id: "codex_vscode",       label: "Codex Extension",       color: "#0a7a46", group: "OpenAI"    },
  // Google
  { id: "antigravity",        label: "Antigravity 2.0",       color: "#818cf8", group: "Google"    },
  { id: "antigravity_cli",    label: "Antigravity CLI",        color: "#4f46e5", group: "Google"    },
  // VS Code ecosystem
  { id: "cursor",             label: "Cursor",                color: "#00e5ff", group: "VS Code"   },
  { id: "cline",              label: "Cline",                 color: "#ff6b6b", group: "VS Code"   },
  { id: "kilocode",           label: "Kilo Code",             color: "#ff8787", group: "VS Code"   },
  { id: "continue",           label: "Continue",              color: "#2f80ed", group: "VS Code"   },
  { id: "copilot",            label: "GitHub Copilot",        color: "#6f42c1", group: "VS Code"   },
  { id: "vscode",             label: "VS Code",               color: "#007acc", group: "VS Code"   },
  // Editors
  { id: "jetbrains",          label: "JetBrains AI",          color: "#fe315d", group: "Editors"   },
  { id: "devin",              label: "Devin Desktop",         color: "#06b6d4", group: "Editors"   },
  { id: "zed",                label: "Zed",                   color: "#084cdf", group: "Editors"   },
  { id: "amp",                label: "Amp",                   color: "#ff4500", group: "Editors"   },
  { id: "kiro",               label: "Kiro",                  color: "#ff9900", group: "Editors"   },
  // Other
  { id: "amazonq",            label: "Amazon Q Developer",    color: "#ff9900", group: "Other"     },
  { id: "mistral",            label: "Le Chat",               color: "#f97316", group: "Other"     },
  { id: "mscopilot",          label: "Microsoft Copilot",     color: "#0078d4", group: "Other"     },
  { id: "grok",               label: "Grok",                  color: "#e7e7e7", group: "Other"     },
  { id: "raycast",            label: "Raycast",               color: "#ff6363", group: "Other"     },
  // Local / self-hosted
  { id: "openwebui",          label: "Open WebUI",            color: "#6ee7b7", group: "Local"     },
  { id: "lmstudio",           label: "LM Studio",             color: "#a78bfa", group: "Local"     },
  { id: "anythingllm",        label: "AnythingLLM",           color: "#fbbf24", group: "Local"     },
];

export const PLATFORM_GROUPS = ["Anthropic", "OpenAI", "Google", "VS Code", "Editors", "Other", "Local"] as const;
export type PlatformGroup = typeof PLATFORM_GROUPS[number];
