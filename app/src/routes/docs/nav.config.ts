export interface DocSection {
  id: string;
  label: string;
  icon: string;
}

export interface DocGroup {
  title: string;
  sections: DocSection[];
}

export const DOC_GROUPS: DocGroup[] = [
  {
    title: "Getting Started",
    sections: [
      { id: "overview", label: "Overview", icon: "📖" },
      { id: "connection-auth", label: "Connection & Auth", icon: "🔑" },
      { id: "security-privacy", label: "Security & Privacy", icon: "🔒" },
    ],
  },
  {
    title: "Features",
    sections: [
      { id: "managing-memories", label: "Managing Memories", icon: "🧠" },
      { id: "import-memories", label: "Importing & Migrating", icon: "📥" },
      { id: "team-collaboration", label: "Team Collaboration", icon: "👥" },
      { id: "stack-creator", label: "Tech Stack Creator", icon: "🛠️" },
      { id: "templates", label: "Blueprint Templates", icon: "📋" },
      { id: "export-rules", label: "Exporting Agent Rules", icon: "💾" },
      { id: "agent-activity", label: "Agent Activity", icon: "◎" },
      { id: "conflicts", label: "Conflict Resolution", icon: "⚡" },
    ],
  },
  {
    title: "Webhook Integrations",
    sections: [
      { id: "webhooks", label: "Webhook Overview", icon: "🔗" },
      { id: "webhooks-github", label: "GitHub", icon: "🐙" },
      { id: "webhooks-linear", label: "Linear", icon: "◆" },
      { id: "webhooks-slack-jit", label: "Slack", icon: "💬" },
    ],
  },
  {
    title: "Compliance & Audit",
    sections: [
      { id: "verifiable-proofs", label: "Cryptographic Proofs", icon: "✓" },
    ],
  },
  {
    title: "CI/CD",
    sections: [
      { id: "cicd-gatekeeper", label: "PR Policy Gatekeeper", icon: "🚦" },
    ],
  },
  {
    title: "MCP Reference",
    sections: [
      { id: "mcp-about", label: "About MCP", icon: "💡" },
      { id: "mcp-tools-retrieval", label: "Context Retrieval", icon: "🔍" },
      { id: "mcp-tools-mutation", label: "Memory Mutation", icon: "✍️" },
      { id: "mcp-tools-sync", label: "Agent Syncing", icon: "🔄" },
      { id: "mcp-tools-credentials", label: "Credential Vault", icon: "🔐" },
      { id: "mcp-errors-security", label: "Errors & Security", icon: "⚠️" },
    ],
  },
  {
    title: "Connecting Clients",
    sections: [
      { id: "connect-oauth", label: "OAuth / Account-Based", icon: "🔐" },
      { id: "connect-manual", label: "Manual / Token-Based", icon: "🔧" },
    ],
  },
  {
    title: "Diagnostics",
    sections: [
      { id: "tester", label: "Connection Tester", icon: "🔌" },
      { id: "dlp-quarantine", label: "DLP Quarantine", icon: "🔍" },
    ],
  },
];

export const ALL_SECTION_IDS = DOC_GROUPS.flatMap((g) => g.sections.map((s) => s.id));

export const DEFAULT_SECTION = "overview";
