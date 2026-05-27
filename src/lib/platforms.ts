export type PlatformMeta = {
  id: string;
  label: string;
  color: string;
  group: "Anthropic" | "OpenAI" | "Google" | "VS Code" | "Editors" | "Other";
};

export const PLATFORMS: PlatformMeta[] = [
  { id: "claudedesktop",      label: "Claude Desktop",       color: "#d4956a", group: "Anthropic" },
  { id: "claudecode",         label: "Claude Code",           color: "#c97b53", group: "Anthropic" },
  { id: "codex_cli",          label: "Codex CLI",             color: "#0f9d58", group: "OpenAI"    },
  { id: "codex_app",          label: "Codex App",             color: "#0c8a4f", group: "OpenAI"    },
  { id: "codex_vscode",       label: "Codex Extension",       color: "#0a7a46", group: "OpenAI"    },
  { id: "chatgpt",            label: "ChatGPT",               color: "#10a37f", group: "OpenAI"    },
  { id: "antigravity",        label: "Antigravity 2.0",       color: "#818cf8", group: "Google"    },
  { id: "antigravity_ide",    label: "Antigravity 2.0 IDE",   color: "#4f46e5", group: "Google"    },
  { id: "gemini_code_assist", label: "Gemini Code Assist",    color: "#1a73e8", group: "Google"    },
  { id: "geminicli",          label: "Gemini CLI",            color: "#34a853", group: "Google"    },
  { id: "gemini",             label: "Gemini (Gems)",         color: "#4285f4", group: "Google"    },
  { id: "cursor",             label: "Cursor",                color: "#00e5ff", group: "VS Code"   },
  { id: "cline",              label: "Cline",                 color: "#ff6b6b", group: "VS Code"   },
  { id: "roocode",            label: "Roo Code",              color: "#ff8787", group: "VS Code"   },
  { id: "continue",           label: "Continue",              color: "#2f80ed", group: "VS Code"   },
  { id: "copilot",            label: "GitHub Copilot",        color: "#6f42c1", group: "VS Code"   },
  { id: "vscode",             label: "VS Code",               color: "#007acc", group: "VS Code"   },
  { id: "windsurf",           label: "Windsurf",              color: "#06b6d4", group: "Editors"   },
  { id: "zed",                label: "Zed",                   color: "#084cdf", group: "Editors"   },
  { id: "amp",                label: "Amp",                   color: "#ff4500", group: "Editors"   },
  { id: "kiro",               label: "Kiro",                  color: "#ff9900", group: "Editors"   },
  { id: "grok",               label: "Grok",                  color: "#e7e7e7", group: "Other"     },
  { id: "perplexity",         label: "Perplexity",            color: "#20b2aa", group: "Other"     },
];

export const PLATFORM_GROUPS = ["Anthropic", "OpenAI", "Google", "VS Code", "Editors", "Other"] as const;
export type PlatformGroup = typeof PLATFORM_GROUPS[number];
