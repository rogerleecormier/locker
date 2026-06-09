import type { SectionProps } from "../types";
import {
  SectionTitle,
  Lead,
  SubHeading,
  Card,
  CardTitle,
  CardBody,
  Grid,
  StepList,
  Table,
  InfoBox,
  CodeBlock,
} from "../ui";

function CopyIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

const FORMATS = [
  ["cursor", ".cursorrules", "Cursor IDE"],
  ["claude", "CLAUDE.md", "Claude Desktop / Claude Code"],
  ["copilot", ".github/copilot-instructions.md", "GitHub Copilot"],
  ["gemini", "GEMINI.md", "Gemini CLI / Gemini Code Assist"],
  ["agents", "AGENTS.md", "OpenAI Codex / generic agents"],
  ["antigravity", ".agents/rules/rules.md", "Antigravity / custom runtimes"],
];

const INSTALL_CMD = "npm install -g locker-sync";
const SYNC_ALL_CMD = "npx locker-sync sync --token <your-api-token> --format all";
const SYNC_CLAUDE_CMD = "npx locker-sync sync --token <your-api-token> --format claude";

export default function ExportRules({ handleCopy }: SectionProps) {
  return (
    <div>
      <SectionTitle>Export Rules & locker-sync CLI</SectionTitle>
      <Lead>
        Translate your Locker memories and stack blueprint into AI agent instruction files for
        Cursor, Claude, GitHub Copilot, Gemini, and more. Sync files automatically into local
        project directories via MCP or the locker-sync CLI.
      </Lead>

      <SubHeading>Supported output formats</SubHeading>
      <Table
        headers={["Format flag", "Output file", "Client"]}
        rows={FORMATS.map(([flag, file, client]) => [
          <code key={flag} style={{ color: "var(--accent)" }}>{flag}</code>,
          <code key={file}>{file}</code>,
          client,
        ])}
      />

      <SubHeading>Downloading from the UI</SubHeading>
      <StepList
        items={[
          {
            step: "1",
            title: "Open Export Rules",
            text: "Go to Memories → Export Rules from the left sidebar.",
          },
          {
            step: "2",
            title: "Select output format",
            text: "Choose one of the six supported formats from the dropdown (cursor, claude, copilot, gemini, agents, antigravity).",
          },
          {
            step: "3",
            title: "Generate & Download",
            text: 'Click "Generate & Download". The file is synthesized from your rule memories and active stack blueprint, then downloaded to your browser immediately.',
          },
        ]}
      />

      <SubHeading>locker-sync CLI</SubHeading>
      <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
        The <code>locker-sync</code> CLI lets you sync rule files directly into your project
        directory from a terminal. Run it from your project root so files land in the right place.
      </p>

      <div style={{ marginBottom: 16 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 6,
          }}
        >
          <span
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              fontWeight: 600,
            }}
          >
            Install globally
          </span>
          <button
            onClick={() => handleCopy(INSTALL_CMD)}
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
            }}
          >
            <CopyIcon size={11} /> Copy
          </button>
        </div>
        <CodeBlock>{INSTALL_CMD}</CodeBlock>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 6,
          }}
        >
          <span
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              fontWeight: 600,
            }}
          >
            Sync all formats
          </span>
          <button
            onClick={() => handleCopy(SYNC_ALL_CMD)}
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
            }}
          >
            <CopyIcon size={11} /> Copy
          </button>
        </div>
        <CodeBlock>{SYNC_ALL_CMD}</CodeBlock>
      </div>

      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 6,
          }}
        >
          <span
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              fontWeight: 600,
            }}
          >
            Sync a single format (example: claude)
          </span>
          <button
            onClick={() => handleCopy(SYNC_CLAUDE_CMD)}
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
            }}
          >
            <CopyIcon size={11} /> Copy
          </button>
        </div>
        <CodeBlock>{SYNC_CLAUDE_CMD}</CodeBlock>
      </div>

      <SubHeading>MCP export_rules tool</SubHeading>
      <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
        Agents can call <code>export_rules</code> directly via MCP to receive the compiled
        instruction text as a string. This is useful for agents that need to self-configure or pass
        instructions down to sub-agents without touching the file system.
      </p>
      <Grid>
        <Card accent="purple">
          <CardTitle>Self-configuration</CardTitle>
          <CardBody>
            An agent calls <code>export_rules(format: "claude")</code> at session start, receives
            the full CLAUDE.md text, and injects it into its own system prompt — no file access
            required.
          </CardBody>
        </Card>
        <Card accent="blue">
          <CardTitle>Sub-agent delegation</CardTitle>
          <CardBody>
            An orchestrating agent calls <code>export_rules</code> and forwards the result to a
            spawned sub-agent so both operate under identical constraints without repeated MCP
            round-trips.
          </CardBody>
        </Card>
      </Grid>

      <SubHeading>What gets included</SubHeading>
      <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
        Exported files are synthesized from:
      </p>
      <ul
        style={{
          paddingLeft: 20,
          color: "var(--text-muted)",
          fontSize: 13,
          lineHeight: 1.8,
          marginBottom: 24,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <li>All memories with category <strong style={{ color: "var(--text)" }}>rules</strong></li>
        <li>Your active <strong style={{ color: "var(--text)" }}>stack blueprint</strong> for the matching project tag</li>
        <li>
          Any <strong style={{ color: "var(--text)" }}>team-level rules</strong> if the token
          carries team scope
        </li>
      </ul>
      <InfoBox>
        <span style={{ fontSize: 16 }}>🔒</span>
        <span>
          Private credentials and memories tagged <code>#confidential</code> are never included in
          any export, regardless of token permissions.
        </span>
      </InfoBox>
    </div>
  );
}
