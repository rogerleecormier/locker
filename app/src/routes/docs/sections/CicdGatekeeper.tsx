import type { SectionProps } from "../types";

const HOW_IT_WORKS = [
  { step: "1", text: "Your GitHub Action builds a structured diff of package.json changes (added, removed, updated deps) and any modified architecture docs." },
  { step: "2", text: "The action POSTs the diff to POST /api/cicd/gatekeeper with your project_token (a scoped lkr_ API key) and an optional project_key vault scope." },
  { step: "3", text: "The endpoint verifies the token via PBKDF2 prefix lookup — an invalid or expired token returns 401 immediately, no rules are ever read." },
  { step: "4", text: "Locker queries your D1 vault for memories tagged #architecture, #rules, #banned_dependencies, or #dependencies in the rules and references categories." },
  { step: "5", text: "Each matching memory is decrypted with your per-vault DEK, assembled into a numbered rule list, and piped alongside the diff into Workers AI (Llama 3.1 8B)." },
  { step: "6", text: "The model returns {\"pass\": boolean, \"violation_reason\": string | null}. A passing PR receives HTTP 200; any violation returns HTTP 400 with the reason, blocking the merge." },
];

const ENDPOINT = {
  method: "POST",
  path: "/api/cicd/gatekeeper",
};

const PAYLOAD_EXAMPLE = `{
  "project_token": "lkr_…",
  "project_key": "org:<uuid>",
  "package_json_diff": {
    "added":   ["moment"],
    "removed": [],
    "updated": { "react": { "from": "18.2.0", "to": "19.0.0" } }
  },
  "architecture_diff": "--- a/docs/architecture/decisions.md\\n+++ …"
}`;

const PASS_RESPONSE = `HTTP 200
{ "pass": true, "violation_reason": null }`;

const FAIL_RESPONSE = `HTTP 400
{
  "pass": false,
  "violation_reason": "moment.js is explicitly banned. Use date-fns instead."
}`;

const SETUP_STEPS = [
  { label: "Add vault rules", body: "In your Locker vault, add a rules-category memory tagged #banned_dependencies describing which packages or patterns are disallowed. Example: \"Use date-fns, moment is banned — 300 KB and unmaintained.\" Any rules or references memories tagged #architecture or #rules are also evaluated." },
  { label: "Create a scoped API token", body: "In Settings → API Tokens, generate a token with Recall permission only. Copy the lkr_ token — it is shown once. Optionally restrict it to a specific org or team scope." },
  { label: "Add GitHub secrets", body: "In your repo's Settings → Secrets and variables → Actions, add LOCKER_PROJECT_TOKEN (the lkr_ key) and LOCKER_GATEKEEPER_URL (your Locker deployment URL, e.g. https://locker.example.com). Optionally add LOCKER_PROJECT_KEY as a variable if you use a scoped vault." },
  { label: "Drop in the workflow file", body: "Copy github-action-template.yml from the repo root into .github/workflows/locker-gatekeeper.yml in your project. The workflow fires on pull_request events that touch package.json, lockfiles, or architecture docs." },
];

const SECURITY_NOTES = [
  { heading: "Fail-secure by default", body: "If the vault query fails, the AI call throws, or the model returns an unparseable response, the endpoint returns HTTP 500 with pass: false — it will never silently approve a PR on error." },
  { heading: "No rules, no gate", body: "If your vault has no memories matching the CI/CD tags, the AI still evaluates the diff against an empty rule list. The PR passes — but nothing is approved without at least reading the vault, so empty-vault behavior is predictable." },
  { heading: "Token never leaves GitHub", body: "The lkr_ token is passed as a JSON body field (not a query param) over HTTPS. Store it in GitHub Secrets — never commit it to source." },
  { heading: "Scoped minimum privilege", body: "Create a dedicated token with Recall-only permission. The gatekeeper endpoint only reads memories; it never writes to your vault." },
];

export default function CicdGatekeeper(_props: SectionProps) {
  return (
    <div>
      <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>
        CI/CD Gatekeeper
      </h2>
      <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 8 }}>
        Enforce your vault's architectural rules and banned-dependency policies on every pull request — automatically, before code merges.
      </p>
      <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 28 }}>
        The Gatekeeper endpoint reads your project's <code style={{ fontFamily: "monospace", fontSize: 13 }}>#architecture</code>,{" "}
        <code style={{ fontFamily: "monospace", fontSize: 13 }}>#rules</code>, and{" "}
        <code style={{ fontFamily: "monospace", fontSize: 13 }}>#banned_dependencies</code> vault memories, pipes them alongside the PR diff into Workers AI (Llama 3.1), and returns a structured pass/fail verdict. A drop-in GitHub Actions workflow template handles diff extraction, the API call, and PR commenting on violation.
      </p>

      {/* How it works */}
      <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>How it works</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 32 }}>
        {HOW_IT_WORKS.map((s) => (
          <div
            key={s.step}
            style={{ display: "flex", gap: 14, alignItems: "flex-start", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}
          >
            <div style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--accent-dim)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0, border: "1px solid rgba(168,85,247,0.2)" }}>
              {s.step}
            </div>
            <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.5 }}>{s.text}</p>
          </div>
        ))}
      </div>

      {/* API Reference */}
      <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>API reference</h3>
      <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span style={{ background: "var(--accent)", color: "#fff", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 4 }}>{ENDPOINT.method}</span>
          <code style={{ fontFamily: "monospace", fontSize: 13, color: "var(--text)" }}>{ENDPOINT.path}</code>
        </div>
        <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "0 0 12px 0", lineHeight: 1.5 }}>
          Authentication: pass a scoped <code style={{ fontFamily: "monospace" }}>lkr_</code> API token as <code style={{ fontFamily: "monospace" }}>project_token</code> in the JSON body. No Authorization header is used — the token travels in the body to avoid server-side logging.
        </p>
        <p style={{ color: "var(--text-muted)", fontSize: 12, fontWeight: 700, margin: "0 0 6px 0", textTransform: "uppercase", letterSpacing: "0.05em" }}>Request body</p>
        <pre style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", fontSize: 12, color: "var(--text)", overflowX: "auto", margin: "0 0 16px 0", lineHeight: 1.5 }}>
          {PAYLOAD_EXAMPLE}
        </pre>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <p style={{ color: "var(--text-muted)", fontSize: 12, fontWeight: 700, margin: "0 0 6px 0", textTransform: "uppercase", letterSpacing: "0.05em" }}>Pass response</p>
            <pre style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: 8, padding: "10px 12px", fontSize: 12, color: "var(--text)", margin: 0, lineHeight: 1.5, overflowX: "auto" }}>
              {PASS_RESPONSE}
            </pre>
          </div>
          <div>
            <p style={{ color: "var(--text-muted)", fontSize: 12, fontWeight: 700, margin: "0 0 6px 0", textTransform: "uppercase", letterSpacing: "0.05em" }}>Fail response</p>
            <pre style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8, padding: "10px 12px", fontSize: 12, color: "var(--text)", margin: 0, lineHeight: 1.5, overflowX: "auto" }}>
              {FAIL_RESPONSE}
            </pre>
          </div>
        </div>
      </div>

      {/* Required vault memory tags */}
      <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>Vault tags the gatekeeper reads</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 28 }}>
        {[
          { tag: "#banned_dependencies", note: "Packages that must never be added" },
          { tag: "#dependencies",        note: "Approved dependency guidance" },
          { tag: "#rules",               note: "General coding / project rules" },
          { tag: "#architecture",        note: "Structural constraints and ADRs" },
        ].map(({ tag, note }) => (
          <div key={tag} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px" }}>
            <code style={{ fontFamily: "monospace", fontSize: 12, color: "var(--accent)", display: "block", marginBottom: 4 }}>{tag}</code>
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 }}>{note}</p>
          </div>
        ))}
      </div>

      {/* Setup guide */}
      <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>Setup guide</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 28 }}>
        {SETUP_STEPS.map((s, i) => (
          <div key={s.label} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
            <div style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--accent-dim)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, flexShrink: 0, border: "1px solid rgba(168,85,247,0.2)", marginTop: 1 }}>
              {i + 1}
            </div>
            <div>
              <p style={{ margin: "0 0 4px 0", fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{s.label}</p>
              <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>{s.body}</p>
            </div>
          </div>
        ))}
      </div>

      {/* GitHub Action workflow */}
      <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>GitHub Actions workflow</h3>
      <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 12 }}>
        A ready-to-use workflow template is included at <code style={{ fontFamily: "monospace", fontSize: 12 }}>github-action-template.yml</code> in the Locker repository root. Copy it to <code style={{ fontFamily: "monospace", fontSize: 12 }}>.github/workflows/locker-gatekeeper.yml</code> in your project. The workflow:
      </p>
      <ul style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.7, paddingLeft: 20, marginBottom: 28 }}>
        <li>Triggers on <code style={{ fontFamily: "monospace", fontSize: 12 }}>pull_request</code> events that touch <code style={{ fontFamily: "monospace", fontSize: 12 }}>package.json</code>, lockfiles, or <code style={{ fontFamily: "monospace", fontSize: 12 }}>*.arch.md</code> documents</li>
        <li>Builds a structured <code style={{ fontFamily: "monospace", fontSize: 12 }}>package_json_diff</code> (added / removed / updated) using Node</li>
        <li>Captures a unified architecture diff for any changed architecture docs</li>
        <li>Calls <code style={{ fontFamily: "monospace", fontSize: 12 }}>POST /api/cicd/gatekeeper</code> and captures the HTTP status and response body</li>
        <li>Posts an inline PR comment with the <code style={{ fontFamily: "monospace", fontSize: 12 }}>violation_reason</code> when the gate fails</li>
        <li>Exits non-zero to fail the check if the status is not <code style={{ fontFamily: "monospace", fontSize: 12 }}>200</code></li>
      </ul>

      {/* Security */}
      <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>Security notes</h3>
      <div style={{ background: "rgba(168,85,247,0.04)", border: "1px solid rgba(168,85,247,0.15)", borderRadius: 12, padding: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {SECURITY_NOTES.map((n) => (
            <div key={n.heading}>
              <p style={{ margin: "0 0 2px 0", fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{n.heading}</p>
              <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>{n.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
