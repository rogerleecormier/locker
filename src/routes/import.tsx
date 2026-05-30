import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useCallback } from "react";
import { batchImportMemories, parseMemoriesWithAI } from "~/server/memoryFunctions";

export const Route = createFileRoute("/import")({
  component: ImportPage,
});

function CopyIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" />
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

type Chatbot = {
  id: string;
  label: string;
  color: string;
  url: string;
  deeplinkUrl?: (prompt: string) => string;
  prompt: string;
};

const CHATBOTS: Chatbot[] = [
  {
    id: "chatgpt",
    label: "ChatGPT",
    color: "#10a37f",
    url: "https://chatgpt.com/",
    prompt: `Export everything stored in your Memory about me. I want two sections:

**Section 1 — Saved Memories (explicit entries)**
List every discrete entry from your saved memory store — the entries visible in Settings > Personalization > Manage Memories. Output each one verbatim, exactly as stored, one per line. Do not paraphrase, merge, or omit any entry.

**Section 2 — Chat History Inferences (implicit layer)**
List any additional facts, preferences, or context you have inferred about me from past conversations that are NOT in your saved memory entries — things you know about me but haven't saved as a discrete memory. One fact per line.

Format each line as:
[YYYY-MM-DD] - Entry content here.
Use [unknown] if no date is available.

Output ONLY the two sections. No intro, no sign-off, no commentary. After both sections, state how many saved memory entries were listed and whether the list is complete.`,
  },
  {
    id: "claude",
    label: "Claude",
    color: "#d4956a",
    url: "https://claude.ai/new",
    prompt: `Export all of my stored memories and any context you've learned about me from past conversations. Preserve my words verbatim where possible, especially for instructions and preferences.

## Categories (output in this order):

1. **Instructions**: Rules I've explicitly asked you to follow going forward — tone, format, style, "always do X", "never do Y", and corrections to your behavior. Only include rules from stored memories, not from conversations.

2. **Identity**: Name, age, location, education, family, relationships, languages, and personal interests.

3. **Career**: Current and past roles, companies, and general skill areas.

4. **Projects**: Projects I meaningfully built or committed to. Ideally ONE entry per project. Include what it does, current status, and any key decisions. Use the project name or a short descriptor as the first words of the entry.

5. **Preferences**: Opinions, tastes, and working-style preferences that apply broadly.

## Format:

Use section headers for each category. Within each category, list one entry per line, sorted by oldest date first. Format each line as:

[YYYY-MM-DD] - Entry content here.

If no date is known, use [unknown] instead.

## Output:
- Wrap the entire export in a single code block for easy copying.
- After the code block, state whether this is the complete set or if more remain.`,
  },
  {
    id: "perplexity",
    label: "Perplexity",
    color: "#20b2aa",
    url: "https://www.perplexity.ai/",
    deeplinkUrl: (p: string) => `https://www.perplexity.ai/search?q=${encodeURIComponent(p)}`,
    prompt: `Tell me everything you know about me: preferences, personal details, interests, recurring context, etc.

List every discrete memory entry. One entry per line. Do not paraphrase, summarize, group, or omit anything.

Format each line as:
[YYYY-MM-DD] - Entry content here.
Use [unknown] if no date is available.

End with a count of how many entries were listed and confirm whether the list is complete.`,
  },
  {
    id: "gemini",
    label: "Gemini",
    color: "#4285f4",
    url: "https://gemini.google.com/app",
    prompt: `You are helping me import context from one AI assistant to another. Your job is to go through our past conversations and sum up what you know about me.

In the output, please avoid using any first-person pronouns (I, my, me, mine) and any second-person pronouns (you, your, yours). Instead, refer to the individual you have learned about as "the user" or use neutral phrasing.

Preserve the user's words verbatim where possible, especially for instructions and preferences.

Categories (output in this order):
1. Demographics Information: Preferred names, profession, education, and general residence.
2. Interests & Preferences: Sustained, active engagements (not just owning an object or a one-time purchase).
3. Relationships: Confirmed, sustained relationships.
4. Dated Events, Projects & Plans: A log of significant, recent activities.
5. Instructions: Rules I've explicitly asked you to follow going forward, "always do X", "never do Y", and corrections to your behavior. Only include rules from stored memories, not from conversations.

Format:
Divide the content into the labeled section using the categories above. Try to include verbatim quotes from my prompts that justify each entry. Structure each entry using this format:
* The user's name is <name>.
    * Evidence: User said "call me <name>". Date: [YYYY-MM-DD].

Output:
- Output ONLY the requested information. Do not include any conversational filler, intro text, or sign-offs.

Finally, complete the sentence "Imported from: <name>", where name is ChatGPT, Claude, Grok, etc. This must be the absolute final text in your response.`,
  },
  {
    id: "grok",
    label: "Grok",
    color: "#e7e7e7",
    url: "https://x.com/i/grok",
    prompt: `Export everything stored in your persistent memory about me. List every discrete memory entry exactly as stored — the entries visible in Settings > Data Controls. One entry per line, verbatim. Do not paraphrase, summarize, merge, or omit any entry.

Format each line as:
[YYYY-MM-DD] - Entry content here.
Use [unknown] if no date is available.

Output ONLY the memory entries. No intro, no sign-off, no commentary. End with a count of entries listed and confirm whether this is the complete set.`,
  },
];

function PromptPanel() {
  const [selectedBot, setSelectedBot] = useState<string>("chatgpt");
  const [copied, setCopied] = useState(false);

  const bot = CHATBOTS.find((b) => b.id === selectedBot) ?? CHATBOTS[0];

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(bot.prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [bot.prompt]);

  const handleOpen = useCallback(async () => {
    if (bot.deeplinkUrl) {
      window.open(bot.deeplinkUrl(bot.prompt), "_blank", "noopener,noreferrer");
    } else {
      await navigator.clipboard.writeText(bot.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      window.open(bot.url, "_blank", "noopener,noreferrer");
    }
  }, [bot]);

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <span style={{ fontWeight: 600 }}>Step 1 — Get your memories out</span>
        <span style={{ color: "var(--text-muted)", fontSize: 12, marginLeft: "auto" }}>
          Copy a prompt to pull memories out of each chatbot
        </span>
      </div>

      <div style={{ padding: 18 }}>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
            Chatbot
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {CHATBOTS.map((b) => (
              <button
                key={b.id}
                onClick={() => { setSelectedBot(b.id); setCopied(false); }}
                style={{
                  padding: "6px 14px",
                  background: selectedBot === b.id ? `${b.color}22` : "var(--surface2)",
                  border: `1px solid ${selectedBot === b.id ? b.color : "var(--border)"}`,
                  color: selectedBot === b.id ? b.color : "var(--text-muted)",
                  fontWeight: selectedBot === b.id ? 600 : 400,
                  fontSize: 12,
                  borderRadius: 20,
                  transition: "all 0.15s",
                }}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{
          background: "var(--surface2)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: "12px 14px",
          fontFamily: "monospace",
          fontSize: 12,
          lineHeight: 1.7,
          color: "var(--text)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          marginBottom: 12,
          maxHeight: 240,
          overflowY: "auto",
        }}>
          {bot.prompt}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)", flexShrink: 1 }}>
            {bot.deeplinkUrl
              ? `Opens ${bot.label} with the prompt pre-filled`
              : `Copies prompt then opens ${bot.label} — just paste and send`}
          </span>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <button
              onClick={handleCopy}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 14px",
                background: copied ? "rgba(34,197,94,0.15)" : "var(--surface2)",
                border: copied ? "1px solid rgba(34,197,94,0.4)" : "1px solid var(--border)",
                color: copied ? "var(--success)" : "var(--text-muted)",
                fontWeight: 500,
                fontSize: 13,
                transition: "all 0.2s",
              }}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
              {copied ? "Copied!" : "Copy"}
            </button>
            <button
              onClick={handleOpen}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 16px",
                background: `${bot.color}22`,
                border: `1px solid ${bot.color}66`,
                color: bot.color,
                fontWeight: 600,
                fontSize: 13,
                transition: "all 0.2s",
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              Open {bot.label}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function IngestPanel() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [pasteText, setPasteText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Array<{ fact: string; category?: string; tags?: string }> | null>(null);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [source, setSource] = useState<string>("manual");

  const batchMutation = useMutation({
    mutationFn: ({ items, source }: { items: Array<{ fact: string; category?: string; tags?: string }>; source: string }) =>
      batchImportMemories({ data: { items, source } }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["memories"] });
      setPasteText("");
      setPreview(null);
      setParseError(null);
      setImportResult(result);
      setTimeout(() => setImportResult(null), 8000);
    },
  });

  async function handleProcess() {
    setParseError(null);
    setPreview(null);
    setImportResult(null);
    if (!pasteText.trim()) return;
    setParsing(true);
    try {
      const items = await parseMemoriesWithAI({ data: { text: pasteText } });
      if (items.length === 0) {
        setParseError("No memories could be extracted. Try adding more content.");
      } else {
        setPreview(items);
      }
    } catch (e) {
      setParseError((e as Error).message);
    } finally {
      setParsing(false);
    }
  }

  function handleImport() {
    if (!preview) return;
    batchMutation.mutate({ items: preview, source });
  }

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5v14M5 12l7 7 7-7" />
        </svg>
        <span style={{ fontWeight: 600 }}>Step 2 — Paste & import</span>
        <span style={{ color: "var(--text-muted)", fontSize: 12, marginLeft: "auto" }}>
          Paste the chatbot output — AI extracts and imports the memories
        </span>
      </div>

      <div style={{ padding: 18 }}>
        <textarea
          value={pasteText}
          onChange={(e) => { setPasteText(e.target.value); setParseError(null); setPreview(null); setImportResult(null); }}
          placeholder="Paste anything — chatbot memory exports, free-form text, structured or unstructured output. AI will extract the discrete facts."
          rows={8}
          maxLength={16000}
          style={{ width: "100%", padding: "10px 12px", resize: "vertical", fontFamily: "monospace", fontSize: 12, lineHeight: 1.6 }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4, marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: pasteText.length >= 16000 ? "var(--error)" : "var(--text-muted)" }}>
            {pasteText.length.toLocaleString()} / 16,000 characters
          </span>
        </div>

        {parseError && (
          <div style={{ marginTop: 8, padding: "8px 12px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "var(--radius)", color: "var(--error)", fontSize: 12 }}>
            {parseError}
          </div>
        )}

        {preview && (
          <div style={{ marginTop: 8, padding: "10px 12px", background: "rgba(168,85,247,0.08)", border: "1px solid rgba(168,85,247,0.25)", borderRadius: "var(--radius)", fontSize: 12, color: "var(--text-muted)" }}>
            <strong style={{ color: "var(--accent)" }}>Preview:</strong> {preview.length} memor{preview.length !== 1 ? "ies" : "y"} extracted.{" "}
            {preview.slice(0, 2).map((p, i) => (
              <span key={i} style={{ color: "var(--text)" }}>
                &ldquo;{p.fact.slice(0, 60)}{p.fact.length > 60 ? "…" : ""}&rdquo;
                {i < Math.min(1, preview.length - 1) ? ", " : ""}
              </span>
            ))}
            {preview.length > 2 && <span> and {preview.length - 2} more.</span>}
          </div>
        )}

        {batchMutation.isError && (
          <div style={{ marginTop: 8, padding: "8px 12px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "var(--radius)", color: "var(--error)", fontSize: 12 }}>
            Import failed: {(batchMutation.error as Error).message}
          </div>
        )}

        {importResult && (
          <div style={{ marginTop: 8, padding: "8px 12px", background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: "var(--radius)", color: "var(--success)", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span>
              Imported {importResult.imported} memor{importResult.imported !== 1 ? "ies" : "y"}.
              {importResult.skipped > 0 && (
                <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>
                  {importResult.skipped} duplicate{importResult.skipped !== 1 ? "s" : ""} skipped.
                </span>
              )}
            </span>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                onClick={() => navigate({ to: "/" })}
                style={{ padding: "4px 12px", background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.4)", color: "var(--success)", fontSize: 12, fontWeight: 600, borderRadius: "var(--radius)" }}
              >
                View memories →
              </button>
              <button onClick={() => setImportResult(null)} style={{ background: "none", color: "var(--success)", padding: "0 2px", lineHeight: 1, fontSize: 14, opacity: 0.7 }}>×</button>
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
          <button
            onClick={handleProcess}
            disabled={!pasteText.trim() || parsing || batchMutation.isPending}
            style={{ padding: "8px 16px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)" }}
          >
            {parsing ? "Extracting…" : "Extract Memories"}
          </button>
          {preview && (
            <button
              onClick={handleImport}
              disabled={batchMutation.isPending}
              style={{ padding: "8px 16px", background: "var(--accent)", color: "#fff", fontWeight: 600 }}
            >
              {batchMutation.isPending ? "Importing…" : `Import ${preview.length} Memor${preview.length !== 1 ? "ies" : "y"}`}
            </button>
          )}

          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>Source Provider:</label>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              style={{ padding: "6px 12px", fontSize: 13, background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: "var(--radius)" }}
            >
              <option value="chatgpt">ChatGPT</option>
              <option value="claude">Claude</option>
              <option value="perplexity">Perplexity</option>
              <option value="gemini">Gemini</option>
              <option value="grok">Grok</option>
              <option value="manual">Manual</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}

function ImportPage() {
  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "32px 20px" }}>
      <header style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12l7 7 7-7" />
          </svg>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>Import</h1>
          <span style={{
            fontSize: 11,
            background: "var(--accent-dim)",
            color: "var(--accent)",
            border: "1px solid rgba(168,85,247,0.3)",
            borderRadius: 20,
            padding: "2px 8px",
            fontWeight: 600,
          }}>
            Memory Extraction
          </span>
        </div>
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
          Pull your memories out of ChatGPT, Claude, Gemini, Grok, or Perplexity — then paste the output to import them into Locker.
        </p>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <PromptPanel />
        <IngestPanel />
      </div>
    </div>
  );
}
