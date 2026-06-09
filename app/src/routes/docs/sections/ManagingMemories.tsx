import type { SectionProps } from "../types";
import { SectionTitle, Lead, SubHeading, Card, CardTitle, CardBody, Grid, StepList, InfoBox } from "../ui";

export default function ManagingMemories(_props: SectionProps) {
  return (
    <div>
      <SectionTitle>Managing Memories</SectionTitle>
      <Lead>
        The Memories page is the central hub for viewing, editing, tagging, and archiving all stored
        facts inside your vault.
      </Lead>

      {/* Browsing & Filtering */}
      <SubHeading>Browsing & Filtering</SubHeading>
      <Card>
        <CardBody>
          <p style={{ margin: "0 0 10px 0" }}>
            Use the search bar to find memories by keyword across body text, tags, and category. Narrow
            results using the Category dropdown:
          </p>
          <ul style={{ margin: "0 0 10px 0", paddingLeft: 18, lineHeight: 1.8 }}>
            <li><strong style={{ color: "var(--text)" }}>rules</strong> — coding standards, constraints, and guidelines</li>
            <li><strong style={{ color: "var(--text)" }}>projects</strong> — project configs, paths, and state</li>
            <li><strong style={{ color: "var(--text)" }}>references</strong> — background context and research</li>
            <li><strong style={{ color: "var(--text)" }}>stack</strong> — technology and framework choices</li>
          </ul>
          <p style={{ margin: 0 }}>
            Sort options: <strong style={{ color: "var(--text)" }}>Newest</strong>, <strong style={{ color: "var(--text)" }}>Oldest</strong>,{" "}
            <strong style={{ color: "var(--text)" }}>Most Accessed</strong>, <strong style={{ color: "var(--text)" }}>Least Accessed</strong>, and{" "}
            <strong style={{ color: "var(--text)" }}>Stale</strong> — sorts by last access date ascending, surfacing memories
            not accessed in over 30 days with an amber "Stale" badge.
          </p>
        </CardBody>
      </Card>

      <div style={{ marginBottom: 28 }} />

      {/* Stale Memory Review */}
      <SubHeading>Stale Memory Review</SubHeading>
      <div
        style={{
          background: "rgba(184,92,56,0.06)",
          border: "1px solid rgba(184,92,56,0.25)",
          borderRadius: 12,
          padding: 18,
          marginBottom: 28,
          fontSize: 13,
          color: "var(--text-muted)",
          lineHeight: 1.7,
        }}
      >
        <strong style={{ color: "var(--text)", display: "block", marginBottom: 6 }}>
          Stale memories can mislead your agents
        </strong>
        A prominent banner appears above the memory list whenever any memories have not been accessed in
        30 or more days. Each stale memory shows an amber{" "}
        <span
          style={{
            background: "rgba(184,92,56,0.15)",
            color: "#c9713a",
            borderRadius: 4,
            padding: "1px 7px",
            fontWeight: 700,
            fontSize: 11,
            letterSpacing: "0.04em",
          }}
        >
          Stale
        </span>{" "}
        chip. Use the <strong>Stale</strong> sort to bring them to the top. Periodically archive or refresh
        stale memories to prevent agents from being misled by outdated context.
      </div>

      {/* Creating a Memory */}
      <SubHeading>Creating a Memory</SubHeading>
      <StepList
        items={[
          {
            step: "1",
            title: 'Click "+ New Memory"',
            text: 'The button appears in the top-right of the Memories page.',
          },
          {
            step: "2",
            title: "Fill in the memory body",
            text: "Enter the fact text. Keep each memory atomic — one discrete statement per entry is recommended for best retrieval accuracy.",
          },
          {
            step: "3",
            title: "Set Category and Tags",
            text: "Choose a category from the dropdown (rules, projects, references, or stack). Add comma-separated tags. Use #confidential to enable JIT approval gating for sensitive facts.",
          },
          {
            step: "4",
            title: "Set Scope (optional)",
            text: "Restrict the memory to a specific team workspace key to isolate it from other scopes. Leave blank for global vault access.",
          },
          {
            step: "5",
            title: "Click Save",
            text: "The memory is encrypted, vectorized, and stored. Workers AI extracts entity nodes and relationship edges for GraphRAG enrichment automatically.",
          },
        ]}
      />

      {/* Editing & Versioning */}
      <SubHeading>Editing & Versioning</SubHeading>
      <Grid min={260}>
        <Card>
          <CardTitle>Editing a Memory</CardTitle>
          <CardBody>
            Click any memory card to open the detail modal. Edit the body, tags, or category inline.
            Every save writes a new record to <code style={{ color: "var(--accent)", fontSize: 12 }}>memory_versions</code>{" "}
            with a full diff, actor, and timestamp — the original is never overwritten.
          </CardBody>
        </Card>
        <Card>
          <CardTitle>Version History & Rollback</CardTitle>
          <CardBody>
            Open the <strong>Version History</strong> tab inside the memory detail modal to see a
            chronological list of all prior versions. Click any version to preview the previous body,
            then click <strong>Restore</strong> to roll back to that state with one click.
          </CardBody>
        </Card>
      </Grid>

      {/* Archiving */}
      <SubHeading>Archiving</SubHeading>
      <InfoBox>
        <span style={{ fontSize: 18 }}>📦</span>
        <span>
          Archived memories are excluded from all agent recall and semantic search results but are retained
          in full for audit and compliance purposes. Archive from the memory detail modal or via the row
          action menu (⋯). Archived memories remain visible in a dedicated Archived view and can be
          restored at any time.
        </span>
      </InfoBox>

      <div style={{ marginBottom: 28 }} />

      {/* Conflict Badge */}
      <SubHeading>Conflict Badge</SubHeading>
      <Card accent="orange">
        <CardTitle>
          <span style={{ fontSize: 16 }}>⚠️</span>
          Conflicting Memories Detected
        </CardTitle>
        <CardBody>
          When the navigation sidebar shows a numeric badge on <strong>Conflicts</strong>, at least one pair
          of memories contains contradicting facts (for example, "Use Node 18" vs. "Use Node 20"). Navigate
          to the Conflicts section to review side-by-side diffs, choose the authoritative version, and close
          each recommendation. Unresolved conflicts can cause agents to receive inconsistent context during
          retrieval.
        </CardBody>
      </Card>
    </div>
  );
}
