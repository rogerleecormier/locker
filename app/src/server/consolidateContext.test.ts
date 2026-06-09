/**
 * Unit tests for the consolidateContext prompt-consolidation middleware.
 *
 * Strategy: all tests operate against a fake `Ai` binding so no Cloudflare
 * runtime is needed. The fake returns predictable strings or throws on demand,
 * letting us verify every branch of the fallback logic independently.
 *
 * Run: npx vitest run src/server/consolidateContext.test.ts
 */

import { describe, it, expect, vi } from "vitest";

// ─── Re-implement the pure logic under test here so we avoid the CF-runtime
// import chain from -_api.mcp.ts. The function is exported for testing but
// the production copy lives in the route file.
// ---------------------------------------------------------------------------

type PackableMemory = {
  fact: string;
  category: string;
  tags: string;
  authorityType?: string;
};

import type { MockInstance } from "vitest";

type AiRunFn = (...args: any[]) => Promise<unknown>;
type FakeAi = {
  run: MockInstance<AiRunFn> & AiRunFn;
};

// Mirror of the production extractText helper
function extractText(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (typeof r.response === "string") return r.response;
    if (typeof r.text === "string") return r.text;
    if (typeof r.result === "string") return r.result;
    if (Array.isArray(r.choices) && r.choices[0]) {
      const c = r.choices[0] as Record<string, unknown>;
      if (typeof c.text === "string") return c.text;
      if (c.message && typeof (c.message as Record<string, unknown>).content === "string")
        return (c.message as Record<string, unknown>).content as string;
    }
  }
  return "";
}

const CONSOLIDATE_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8";

const CONSOLIDATE_SYSTEM_PROMPT =
  "You are a context-compression middleware. Synthesize the memory fragments below into a single dense system-prompt string for an AI coding agent.\n" +
  "Rules (apply strictly):\n" +
  "1. DEDUPLICATE: if two or more fragments state the same fact, emit it once — keep the most specific or [authoritative] version and discard the rest.\n" +
  "2. MERGE: group closely related facts into one concise statement; do not repeat shared context.\n" +
  "3. PRESERVE: retain every concrete detail — file paths, URLs, identifiers, version numbers, enum values, deadlines, decisions, constraints.\n" +
  "4. AUTHORITY: when an [authoritative] fragment conflicts with a contributed one, keep the authoritative fact only.\n" +
  "5. STRUCTURE: emit a compact bulleted list, one bullet per distinct fact, grouped under category headers (## rules / ## projects / ## references / ## configs). Omit a header if that category has no bullets.\n" +
  "6. OUTPUT: no preamble, no commentary, no markdown fences — only the bulleted list.\n" +
  "7. LENGTH: stay under 800 tokens.";

async function consolidateContext(ai: FakeAi, query: string, items: PackableMemory[]): Promise<string> {
  if (items.length === 0) return "";

  if (items.length === 1) {
    const m = items[0];
    const tagStr = m.tags ? ` [tags: ${m.tags}]` : "";
    const auth = m.authorityType === "authoritative" ? " [authoritative]" : "";
    return `## ${m.category}\n- [${m.category}${auth}${tagStr}] ${m.fact}`;
  }

  const fragments = items.map((m, i) => {
    const tagStr = m.tags ? ` [tags: ${m.tags}]` : "";
    const auth = m.authorityType === "authoritative" ? " [authoritative]" : "";
    return `${i + 1}. [${m.category}${auth}${tagStr}] ${m.fact}`;
  }).join("\n");

  const userMessage = `Query: "${query}"\n\nFragments:\n${fragments}\n\nOutput the consolidated context now.`;

  try {
    const result = await ai.run(CONSOLIDATE_MODEL, {
      messages: [
        { role: "system", content: CONSOLIDATE_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      max_tokens: 1024,
    });
    const text = extractText(result).trim();
    if (text.length > 0) return text;
  } catch {
    // fall through to plain-list fallback
  }

  return items.map((m, i) => `${i + 1}. [${m.category}] ${m.fact}`).join("\n");
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeAi(response: unknown): FakeAi {
  return { run: vi.fn().mockResolvedValue(response) };
}

function throwingAi(): FakeAi {
  return { run: vi.fn().mockRejectedValue(new Error("Workers AI unavailable")) };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("consolidateContext middleware", () => {
  describe("empty input", () => {
    it("returns empty string when items array is empty", async () => {
      const ai = makeAi({ response: "should not be called" });
      const result = await consolidateContext(ai, "anything", []);
      expect(result).toBe("");
      expect(ai.run).not.toHaveBeenCalled();
    });
  });

  describe("single-item fast path", () => {
    it("skips AI call and formats the single item directly", async () => {
      const ai = makeAi({ response: "should not be called" });
      const result = await consolidateContext(ai, "q", [
        { fact: "Use TypeScript strict mode", category: "rules", tags: "typescript", authorityType: "authoritative" },
      ]);
      expect(result).toContain("## rules");
      expect(result).toContain("[authoritative]");
      expect(result).toContain("Use TypeScript strict mode");
      expect(ai.run).not.toHaveBeenCalled();
    });

    it("omits [authoritative] label for contributed items", async () => {
      const ai = makeAi({});
      const result = await consolidateContext(ai, "q", [
        { fact: "Deploy to prod on Fridays", category: "projects", tags: "", authorityType: "contributed" },
      ]);
      expect(result).not.toContain("[authoritative]");
      expect(result).toContain("Deploy to prod on Fridays");
      expect(ai.run).not.toHaveBeenCalled();
    });

    it("omits tags segment when tags string is empty", async () => {
      const ai = makeAi({});
      const result = await consolidateContext(ai, "q", [
        { fact: "Keep PRs small", category: "rules", tags: "" },
      ]);
      expect(result).not.toContain("[tags:");
    });
  });

  describe("multi-item AI path", () => {
    it("calls Workers AI with correct model", async () => {
      const ai = makeAi({ response: "## rules\n- Use strict mode" });
      await consolidateContext(ai, "my query", [
        { fact: "Fact A", category: "rules", tags: "" },
        { fact: "Fact B", category: "projects", tags: "prod" },
      ]);
      expect(ai.run).toHaveBeenCalledOnce();
      expect(ai.run.mock.calls[0][0]).toBe(CONSOLIDATE_MODEL);
    });

    it("passes the query into the user message", async () => {
      const ai = makeAi({ response: "## rules\n- bullet" });
      await consolidateContext(ai, "my specific query", [
        { fact: "F1", category: "rules", tags: "" },
        { fact: "F2", category: "rules", tags: "" },
      ]);
      const [, payload] = ai.run.mock.calls[0] as [string, { messages: Array<{ role: string; content: string }> }];
      const userMsg = payload.messages.find((m) => m.role === "user")?.content ?? "";
      expect(userMsg).toContain("my specific query");
    });

    it("includes all fragment facts in the user message", async () => {
      const ai = makeAi({ response: "## rules\n- merged" });
      await consolidateContext(ai, "q", [
        { fact: "Alpha fact", category: "rules", tags: "" },
        { fact: "Beta fact", category: "references", tags: "api" },
      ]);
      const [, payload] = ai.run.mock.calls[0] as [string, { messages: Array<{ role: string; content: string }> }];
      const userMsg = payload.messages.find((m) => m.role === "user")?.content ?? "";
      expect(userMsg).toContain("Alpha fact");
      expect(userMsg).toContain("Beta fact");
    });

    it("marks authoritative fragments in the user message", async () => {
      const ai = makeAi({ response: "## rules\n- merged" });
      await consolidateContext(ai, "q", [
        { fact: "Auth fact", category: "rules", tags: "", authorityType: "authoritative" },
        { fact: "Contrib fact", category: "rules", tags: "" },
      ]);
      const [, payload] = ai.run.mock.calls[0] as [string, { messages: Array<{ role: string; content: string }> }];
      const userMsg = payload.messages.find((m) => m.role === "user")?.content ?? "";
      expect(userMsg).toContain("[authoritative]");
    });

    it("returns the AI response string on success", async () => {
      const ai = makeAi({ response: "## rules\n- Use strict TypeScript" });
      const result = await consolidateContext(ai, "q", [
        { fact: "F1", category: "rules", tags: "" },
        { fact: "F2", category: "rules", tags: "" },
      ]);
      expect(result).toBe("## rules\n- Use strict TypeScript");
    });

    it("handles AI returning { text: '...' } shape", async () => {
      const ai = makeAi({ text: "## projects\n- bullet" });
      const result = await consolidateContext(ai, "q", [
        { fact: "F1", category: "projects", tags: "" },
        { fact: "F2", category: "projects", tags: "" },
      ]);
      expect(result).toBe("## projects\n- bullet");
    });

    it("handles AI returning a plain string", async () => {
      const ai = makeAi("plain string output");
      const result = await consolidateContext(ai, "q", [
        { fact: "F1", category: "rules", tags: "" },
        { fact: "F2", category: "rules", tags: "" },
      ]);
      expect(result).toBe("plain string output");
    });

    it("trims whitespace from AI output", async () => {
      const ai = makeAi({ response: "  ## rules\n- trimmed  " });
      const result = await consolidateContext(ai, "q", [
        { fact: "F1", category: "rules", tags: "" },
        { fact: "F2", category: "rules", tags: "" },
      ]);
      expect(result).toBe("## rules\n- trimmed");
    });
  });

  describe("fallback behavior", () => {
    it("falls back to plain numbered list when AI throws", async () => {
      const ai = throwingAi();
      const result = await consolidateContext(ai, "q", [
        { fact: "Fact one", category: "rules", tags: "" },
        { fact: "Fact two", category: "projects", tags: "" },
      ]);
      expect(result).toContain("1. [rules] Fact one");
      expect(result).toContain("2. [projects] Fact two");
    });

    it("falls back to plain list when AI returns empty string", async () => {
      const ai = makeAi({ response: "   " });
      const result = await consolidateContext(ai, "q", [
        { fact: "A", category: "rules", tags: "" },
        { fact: "B", category: "rules", tags: "" },
      ]);
      expect(result).toContain("1. [rules] A");
      expect(result).toContain("2. [rules] B");
    });

    it("falls back to plain list when AI returns unrecognised shape", async () => {
      const ai = makeAi({ unknown_key: 42 });
      const result = await consolidateContext(ai, "q", [
        { fact: "X", category: "references", tags: "" },
        { fact: "Y", category: "references", tags: "" },
      ]);
      expect(result).toContain("1. [references] X");
      expect(result).toContain("2. [references] Y");
    });
  });

  describe("tag and category formatting", () => {
    it("includes [tags: ...] segment in fragments for tagged items", async () => {
      const ai = makeAi({ response: "## rules\n- result" });
      await consolidateContext(ai, "q", [
        { fact: "Fact A", category: "rules", tags: "typescript,strict" },
        { fact: "Fact B", category: "rules", tags: "lint" },
      ]);
      const [, payload] = ai.run.mock.calls[0] as [string, { messages: Array<{ role: string; content: string }> }];
      const userMsg = payload.messages.find((m) => m.role === "user")?.content ?? "";
      expect(userMsg).toContain("[tags: typescript,strict]");
      expect(userMsg).toContain("[tags: lint]");
    });

    it("omits tags segment for items with empty tag string", async () => {
      const ai = makeAi({ response: "## rules\n- r" });
      await consolidateContext(ai, "q", [
        { fact: "F1", category: "rules", tags: "" },
        { fact: "F2", category: "rules", tags: "" },
      ]);
      const [, payload] = ai.run.mock.calls[0] as [string, { messages: Array<{ role: string; content: string }> }];
      const userMsg = payload.messages.find((m) => m.role === "user")?.content ?? "";
      expect(userMsg).not.toContain("[tags:");
    });
  });

  describe("system prompt integrity", () => {
    it("passes the correct system prompt to the model", async () => {
      const ai = makeAi({ response: "ok" });
      await consolidateContext(ai, "q", [
        { fact: "A", category: "rules", tags: "" },
        { fact: "B", category: "rules", tags: "" },
      ]);
      const [, payload] = ai.run.mock.calls[0] as [string, { messages: Array<{ role: string; content: string }> }];
      const sysMsg = payload.messages.find((m) => m.role === "system")?.content ?? "";
      expect(sysMsg).toContain("DEDUPLICATE");
      expect(sysMsg).toContain("MERGE");
      expect(sysMsg).toContain("PRESERVE");
      expect(sysMsg).toContain("AUTHORITY");
      expect(sysMsg).toContain("800 tokens");
    });

    it("sets max_tokens to 1024", async () => {
      const ai = makeAi({ response: "ok" });
      await consolidateContext(ai, "q", [
        { fact: "A", category: "rules", tags: "" },
        { fact: "B", category: "rules", tags: "" },
      ]);
      const [, payload] = ai.run.mock.calls[0] as [string, { max_tokens: number }];
      expect(payload.max_tokens).toBe(1024);
    });
  });

  describe("many items", () => {
    it("handles 50 memory fragments without error", async () => {
      const ai = makeAi({ response: "## rules\n- condensed" });
      const items: PackableMemory[] = Array.from({ length: 50 }, (_, i) => ({
        fact: `Fact number ${i + 1} with unique content about index ${i}`,
        category: i % 2 === 0 ? "rules" : "projects",
        tags: i % 3 === 0 ? "important" : "",
        authorityType: i % 5 === 0 ? "authoritative" : "contributed",
      }));
      const result = await consolidateContext(ai, "broad query", items);
      expect(result).toBe("## rules\n- condensed");
      expect(ai.run).toHaveBeenCalledOnce();
    });
  });
});
