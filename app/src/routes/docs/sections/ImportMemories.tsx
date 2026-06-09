import type { SectionProps } from "../types";
import { SectionTitle, Lead, SubHeading, Card, CardTitle, CardBody, Grid, StepList, InfoBox } from "../ui";

export default function ImportMemories(_props: SectionProps) {
  return (
    <div>
      <SectionTitle>Import Memories</SectionTitle>
      <Lead>
        Locker can ingest memories from raw text, chatbot export files, or structured JSON, using Workers AI
        to tag, deduplicate, and categorize each fact automatically.
      </Lead>

      {/* Supported Formats */}
      <SubHeading>Supported Formats</SubHeading>
      <Grid min={240}>
        <Card>
          <CardTitle>
            <span style={{ fontSize: 15 }}>📄</span>
            Plain Text
          </CardTitle>
          <CardBody>
            Paste or upload a <code style={{ color: "var(--accent)", fontSize: 12 }}>.txt</code> file with
            one fact per line. Each non-empty line is treated as a discrete memory candidate and passed
            through the AI extraction pipeline.
          </CardBody>
        </Card>
        <Card>
          <CardTitle>
            <span style={{ fontSize: 15 }}>💬</span>
            Chatbot Conversation Exports
          </CardTitle>
          <CardBody>
            Supports ChatGPT and Claude conversation JSON exports. The pipeline strips message metadata,
            extracts factual statements from the conversation body, and ignores non-informational turns.
          </CardBody>
        </Card>
        <Card>
          <CardTitle>
            <span style={{ fontSize: 15 }}>🗂️</span>
            Structured JSON
          </CardTitle>
          <CardBody>
            Upload a JSON array where each item is{" "}
            <code style={{ color: "var(--accent)", fontSize: 12 }}>{"{ body, category, tags }"}</code>.
            Pre-structured imports skip the AI categorization step and are committed directly after DLP
            and deduplication checks.
          </CardBody>
        </Card>
      </Grid>

      {/* AI Processing Pipeline */}
      <SubHeading>AI Processing Pipeline</SubHeading>
      <Card accent="purple">
        <CardTitle>
          <span style={{ fontSize: 15 }}>🤖</span>
          Powered by Llama-3.3-70B on Workers AI
        </CardTitle>
        <CardBody>
          <p style={{ margin: "0 0 10px 0" }}>
            On upload, the pipeline runs the following steps in sequence before anything is committed:
          </p>
          <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.9 }}>
            <li>
              <strong style={{ color: "var(--text)" }}>Parse</strong> — raw input is normalized and split into
              candidate statements.
            </li>
            <li>
              <strong style={{ color: "var(--text)" }}>Extract</strong> — Llama-3.3-70B identifies discrete
              factual statements and discards filler or conversational content.
            </li>
            <li>
              <strong style={{ color: "var(--text)" }}>Categorize</strong> — each fact is assigned a category
              (rules / projects / references / stack) based on content semantics.
            </li>
            <li>
              <strong style={{ color: "var(--text)" }}>Tag</strong> — relevant tags are suggested automatically
              from the fact body.
            </li>
            <li>
              <strong style={{ color: "var(--text)" }}>Deduplicate</strong> — each fact is compared against
              existing memories using semantic similarity. Near-matches are flagged for review.
            </li>
            <li>
              <strong style={{ color: "var(--text)" }}>Preview</strong> — the full result set is shown for
              human review before any data is written.
            </li>
          </ol>
        </CardBody>
      </Card>

      <div style={{ marginBottom: 28 }} />

      {/* How to Import */}
      <SubHeading>How to Import</SubHeading>
      <StepList
        items={[
          {
            step: "1",
            title: "Open the Import panel",
            text: "Navigate to Memories, then click the Import button (upload icon) in the top bar of the Memories page.",
          },
          {
            step: "2",
            title: "Provide your source",
            text: "Paste raw text directly into the input field, or drag-and-drop a JSON or plain text file onto the upload zone.",
          },
          {
            step: "3",
            title: "Review the AI-generated preview",
            text: "Each extracted fact is displayed with its inferred category and suggested tags. Edit any field — body, category, or tags — before confirming. Remove facts you don't want to import.",
          },
          {
            step: "4",
            title: 'Click "Commit Import"',
            text: "All confirmed facts are bulk-inserted. Each is individually encrypted with AES-256-GCM, vectorized via bge-m3 embeddings, and enriched with GraphRAG entity extraction.",
          },
        ]}
      />

      {/* Deduplication */}
      <SubHeading>Deduplication</SubHeading>
      <Card>
        <CardTitle>
          <span style={{ fontSize: 15 }}>🔗</span>
          Semantic Similarity Deduplication
        </CardTitle>
        <CardBody>
          <p style={{ margin: "0 0 10px 0" }}>
            The import pipeline compares each incoming fact against all existing vault memories using
            vector-based semantic similarity. Facts that exceed the similarity threshold are flagged as
            potential duplicates. For each flagged pair the existing memory is shown side-by-side with
            the incoming fact. You can:
          </p>
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
            <li><strong style={{ color: "var(--text)" }}>Skip</strong> — discard the incoming fact and keep the existing memory unchanged.</li>
            <li><strong style={{ color: "var(--text)" }}>Merge</strong> — combine both facts into a single updated memory body.</li>
            <li><strong style={{ color: "var(--text)" }}>Force-add</strong> — import the incoming fact as a new distinct entry alongside the existing one.</li>
          </ul>
        </CardBody>
      </Card>

      <div style={{ marginBottom: 28 }} />

      {/* DLP Gate */}
      <SubHeading>DLP Gate on Import</SubHeading>
      <InfoBox>
        <span style={{ fontSize: 18 }}>🚫</span>
        <span>
          Import respects the same Data Loss Prevention quarantine rules as manual memory creates.
          High-entropy secrets, credential patterns (AWS keys, GitHub PATs, Stripe keys, PEM blocks, DB
          URIs), and PII (emails, SSNs, credit cards) detected in imported text are flagged before import
          completes. Flagged content must be removed or edited in the preview step before the commit is
          allowed.
        </span>
      </InfoBox>
    </div>
  );
}
