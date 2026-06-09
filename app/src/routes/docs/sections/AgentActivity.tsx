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
  BulletList,
} from "../ui";

const TRACKED_TOOLS = [
  ["recall_context", "Semantic memory retrieval", "Query text, top-k, optimize flag"],
  ["commit_memory", "New fact written", "Category, tags, body (sanitized)"],
  ["update_memory", "Existing fact modified", "Memory ID, changed fields"],
  ["delete_memory", "Fact removed", "Memory ID, reason if provided"],
  ["store_credential", "Credential written to vault", "Credential label (value redacted)"],
  ["retrieve_credential", "Credential read from vault", "Credential label (value redacted)"],
];

export default function AgentActivity(_props: SectionProps) {
  return (
    <div>
      <SectionTitle>Agent Activity Dashboard</SectionTitle>
      <Lead>
        Every MCP operation your AI clients perform is logged to a real-time activity feed. The
        dashboard maps each event to the calling client, the memories accessed, and the semantic
        similarity scores — so you can audit exactly what context your AI had.
      </Lead>

      <SubHeading>What is tracked</SubHeading>
      <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
        Every tool call is logged with the following fields:
      </p>
      <ul
        style={{
          paddingLeft: 20,
          color: "var(--text-muted)",
          fontSize: 13,
          lineHeight: 1.8,
          marginBottom: 20,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <li><strong style={{ color: "var(--text)" }}>Timestamp</strong> — ISO 8601 with millisecond precision</li>
        <li><strong style={{ color: "var(--text)" }}>Token ID & label</strong> — the human-readable name you assigned the token (e.g., "Cursor - Roger")</li>
        <li><strong style={{ color: "var(--text)" }}>Tool name</strong> — which MCP tool was invoked</li>
        <li><strong style={{ color: "var(--text)" }}>Input parameters</strong> — sanitized copy of the arguments passed</li>
        <li><strong style={{ color: "var(--text)" }}>Memories returned</strong> — IDs and cosine similarity scores for every memory surfaced</li>
        <li><strong style={{ color: "var(--text)" }}>Latency</strong> — end-to-end time in milliseconds</li>
      </ul>
      <Table
        headers={["Tool", "Meaning", "Logged parameters"]}
        rows={TRACKED_TOOLS.map(([tool, meaning, params]) => [
          <code key={tool} style={{ color: "var(--accent)" }}>{tool}</code>,
          meaning,
          params,
        ])}
      />

      <SubHeading>Reading the timeline</SubHeading>
      <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
        The activity feed is sorted newest-first. Each collapsed entry shows:
      </p>
      <Grid min={220}>
        <Card>
          <CardTitle>Agent label</CardTitle>
          <CardBody>Human-readable token name, e.g., "Cursor - Roger" or "Claude Desktop".</CardBody>
        </Card>
        <Card>
          <CardTitle>Tool called</CardTitle>
          <CardBody>The MCP tool name, e.g., <code>recall_context</code>.</CardBody>
        </Card>
        <Card>
          <CardTitle>Query (truncated)</CardTitle>
          <CardBody>First 120 characters of the query string passed by the agent.</CardBody>
        </Card>
        <Card>
          <CardTitle>Memories returned</CardTitle>
          <CardBody>Count of memories surfaced and the top cosine similarity score (0–1 scale).</CardBody>
        </Card>
        <Card>
          <CardTitle>Timestamp</CardTitle>
          <CardBody>Relative time (e.g., "3 min ago") with hover tooltip showing the exact UTC value.</CardBody>
        </Card>
      </Grid>
      <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 28 }}>
        Click any entry to expand it and see the full parameter set, the body text of each returned
        memory (decrypted on-demand), and per-memory similarity scores.
      </p>

      <SubHeading>Debugging with the dashboard</SubHeading>
      <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
        If an agent is hallucinating or missing expected context, follow these steps:
      </p>
      <StepList
        items={[
          {
            step: "1",
            title: "Find the relevant session",
            text: "Locate the time window in the timeline when the hallucination occurred. Use the date-range filter to narrow down quickly.",
          },
          {
            step: "2",
            title: "Expand the recall_context entry",
            text: "Click the entry to see exactly which memories were returned, their decrypted body text, and their cosine similarity scores.",
          },
          {
            step: "3",
            title: "Interpret similarity scores",
            text: "Scores below 0.6 indicate poor matches. The memory may be worded too differently from the query — consider rewording or adding more specific memories.",
          },
          {
            step: "4",
            title: "Check for empty windows",
            text: "If there are no entries for a time range, the agent was either not connected, using a cached context, or the token had no recall permission.",
          },
        ]}
      />
      <InfoBox>
        <span style={{ fontSize: 16 }}>💡</span>
        <span>
          A top similarity score below 0.6 is a strong signal that your memory vault lacks a fact
          the agent needed. Add a targeted memory in that category and re-run to confirm retrieval
          improves.
        </span>
      </InfoBox>

      <div style={{ marginTop: 28 }}>
        <SubHeading>Filtering</SubHeading>
        <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 12 }}>
          The toolbar above the timeline provides four filter controls:
        </p>
        <BulletList
          items={[
            <span key="token"><strong style={{ color: "var(--text)" }}>Token / Agent label</strong> — narrow to a specific client or integration.</span>,
            <span key="tool"><strong style={{ color: "var(--text)" }}>Tool type</strong> — filter to one MCP tool (e.g., show only <code>recall_context</code> calls).</span>,
            <span key="date"><strong style={{ color: "var(--text)" }}>Date range</strong> — pick a start and end date to isolate a session window.</span>,
            <span key="errors"><strong style={{ color: "var(--text)" }}>Errors only toggle</strong> — surfaces only failed or errored calls for rapid triage.</span>,
          ]}
        />
      </div>

      <div style={{ marginTop: 28 }}>
        <SubHeading>Retention & export</SubHeading>
        <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
          Activity logs are retained for <strong style={{ color: "var(--text)" }}>90 days</strong>.
          After 90 days, entries are automatically purged from the database. If you need to preserve
          logs beyond the retention window, export before they expire.
        </p>
        <div
          style={{
            background: "var(--surface2)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: 18,
            display: "flex",
            alignItems: "flex-start",
            gap: 14,
          }}
        >
          <span style={{ fontSize: 20, flexShrink: 0 }}>📦</span>
          <div>
            <strong style={{ color: "var(--text)", display: "block", marginBottom: 4, fontSize: 14 }}>
              Export raw log
            </strong>
            <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
              Click the <strong>Export</strong> button in the top-right of the dashboard to download
              all log entries within the currently selected date range as a JSON file. The export
              includes all fields shown in the expanded view: token ID, tool, parameters, memory IDs,
              scores, and latency.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
