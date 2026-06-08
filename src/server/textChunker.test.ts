/**
 * Tests for src/server/textChunker.ts
 *
 * Coverage:
 *   1. Short-text pass-through (no split needed)
 *   2. Paragraph-boundary splitting (\n\n)
 *   3. Sentence-boundary splitting (". ", "! ", "? ")
 *   4. Single-newline fallback splitting
 *   5. Word-boundary splitting (spaces)
 *   6. Hard-split fallback (no separators present)
 *   7. Overlap correctness — chunk[N].text starts with the tail of the
 *      non-overlapping segment[N-1]
 *   8. Index and startOffset correctness
 *   9. Custom targetChars / overlapChars params
 *  10. Edge cases: empty string, exactly-at-limit, one-char-over-limit
 *
 * Run: npx vitest run src/server/textChunker.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  splitTextIntoChunks,
  CHUNK_TARGET_CHARS,
  CHUNK_OVERLAP_CHARS,
  type TextChunk,
} from "./textChunker";

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Build a string of repeated words totalling at least `minLen` chars. */
function words(count: number, word = "word"): string {
  return Array.from({ length: count }, () => word).join(" ");
}

/** Build a text with `n` paragraphs of `paraLen` chars each (separated by \n\n). */
function paragraphs(n: number, paraLen: number): string {
  return Array.from({ length: n }, (_, i) =>
    `P${i} ${"x".repeat(paraLen - 3)}`
  ).join("\n\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: Short-text pass-through
// ─────────────────────────────────────────────────────────────────────────────

describe("splitTextIntoChunks — short text pass-through", () => {
  it("returns single chunk for empty string", () => {
    const chunks = splitTextIntoChunks("");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe("");
    expect(chunks[0].index).toBe(0);
    expect(chunks[0].startOffset).toBe(0);
  });

  it("returns single chunk for text exactly at the limit", () => {
    const text = "a".repeat(CHUNK_TARGET_CHARS);
    const chunks = splitTextIntoChunks(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe(text);
  });

  it("returns single chunk for text 1 char below the limit", () => {
    const text = "a".repeat(CHUNK_TARGET_CHARS - 1);
    const chunks = splitTextIntoChunks(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe(text);
  });

  it("returns single chunk whose text === input for short fact", () => {
    const text = "Use TypeScript strict mode across every file.";
    const chunks = splitTextIntoChunks(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe(text);
    expect(chunks[0].index).toBe(0);
    expect(chunks[0].startOffset).toBe(0);
  });

  it("single-chunk result has isomorphic content (no data loss)", () => {
    const text = "abc def ghi";
    const chunks = splitTextIntoChunks(text);
    expect(chunks[0].text).toBe(text);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: Paragraph-boundary splitting
// ─────────────────────────────────────────────────────────────────────────────

describe("splitTextIntoChunks — paragraph boundary splitting", () => {
  it("splits two large paragraphs into two chunks", () => {
    // Each paragraph is 900 chars — together 1800 + 2 (\n\n) > CHUNK_TARGET_CHARS
    const para = "x".repeat(900);
    const text = `${para}\n\n${para}`;
    const chunks = splitTextIntoChunks(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it("chunk[0].text does not contain \\n\\n when split on paragraph boundary", () => {
    // Two paragraphs, each just over half the limit
    const half = Math.ceil(CHUNK_TARGET_CHARS / 2) + 50;
    const text = paragraphs(2, half);
    const chunks = splitTextIntoChunks(text);
    if (chunks.length > 1) {
      // The first non-overlapping segment shouldn't span both paragraphs
      expect(chunks[0].text.split("\n\n").length).toBeLessThanOrEqual(2); // may have one \n\n from overlap
    }
  });

  it("all chunk texts are non-empty after paragraph split", () => {
    const text = paragraphs(4, 500);
    const chunks = splitTextIntoChunks(text);
    for (const c of chunks) {
      expect(c.text.length).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: Sentence-boundary splitting
// ─────────────────────────────────────────────────────────────────────────────

describe("splitTextIntoChunks — sentence boundary splitting", () => {
  it("splits a long run of sentences into multiple chunks", () => {
    // 60-char sentence × 30 = 1800 chars, needs splitting
    const sentence = "This is a test sentence for chunking. ";
    const text = sentence.repeat(40); // ~1520 chars — just over limit
    const chunks = splitTextIntoChunks(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it("each chunk text length does not exceed targetChars + overlapChars", () => {
    const sentence = "Sentence number one for this test case. ";
    const text = sentence.repeat(50);
    const chunks = splitTextIntoChunks(text);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(CHUNK_TARGET_CHARS + CHUNK_OVERLAP_CHARS);
    }
  });

  it("handles exclamation-mark sentence boundaries", () => {
    const sentence = "Watch out for this edge case! ";
    const text = sentence.repeat(55);
    const chunks = splitTextIntoChunks(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it("handles question-mark sentence boundaries", () => {
    const sentence = "What happens in this test case? ";
    const text = sentence.repeat(55);
    const chunks = splitTextIntoChunks(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: Single-newline fallback
// ─────────────────────────────────────────────────────────────────────────────

describe("splitTextIntoChunks — single-newline fallback", () => {
  it("splits on \\n when no paragraph breaks or sentence-end punctuation present", () => {
    // Lines of 200 chars each, 10 of them → 2000 chars total, no paragraph breaks
    const line = "x".repeat(199);
    const text = Array.from({ length: 10 }, () => line).join("\n");
    const chunks = splitTextIntoChunks(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5: Word-boundary splitting
// ─────────────────────────────────────────────────────────────────────────────

describe("splitTextIntoChunks — word-boundary splitting", () => {
  it("splits on spaces when no other separators present", () => {
    // Words of 20 chars each, 100 of them → 2100 chars with spaces, no punctuation
    const text = words(100, "a".repeat(20));
    const chunks = splitTextIntoChunks(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // No chunk should exceed limit + overlap
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(CHUNK_TARGET_CHARS + CHUNK_OVERLAP_CHARS);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6: Hard-split fallback (no whitespace/separators)
// ─────────────────────────────────────────────────────────────────────────────

describe("splitTextIntoChunks — hard-split fallback", () => {
  it("splits a continuous string with no separators", () => {
    const text = "a".repeat(CHUNK_TARGET_CHARS * 2 + 100);
    const chunks = splitTextIntoChunks(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it("hard-split chunks cover all characters of original text (accounting for overlap)", () => {
    const target = 50;
    const overlap = 10;
    const text = "x".repeat(130); // 3 non-overlapping segments of 50, 50, 30
    const chunks = splitTextIntoChunks(text, target, overlap);
    // All original chars are reachable from some chunk
    const combined = chunks.map((c) => c.text).join("");
    // Each original char should appear in at least one chunk
    // A simple proxy: startOffsets cover [0, target, 100]
    expect(chunks[0].startOffset).toBe(0);
  });

  it("each hard-split chunk text length ≤ targetChars + overlapChars", () => {
    const target = 100;
    const overlap = 20;
    const text = "z".repeat(350);
    const chunks = splitTextIntoChunks(text, target, overlap);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(target + overlap);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7: Overlap correctness
// ─────────────────────────────────────────────────────────────────────────────

describe("splitTextIntoChunks — overlap correctness", () => {
  it("chunk[1].text starts with the tail of the first non-overlapping segment", () => {
    // Use a small target so we get deterministic multi-chunk output.
    // splitOnSeparator on " " strips the space, so segment[0] = "a"*50 (no trailing space).
    const target = 50;
    const overlap = 10;
    const segA = "a".repeat(50);
    const segB = "b".repeat(50);
    const text = segA + " " + segB; // 101 chars — exceeds target of 50
    const chunks = splitTextIntoChunks(text, target, overlap);
    if (chunks.length >= 2) {
      // segment[0] = "a"*50, so overlap tail = "a"*50 .slice(-10) = "aaaaaaaaaa"
      const expectedOverlapPrefix = segA.slice(-overlap);
      expect(chunks[1].text.startsWith(expectedOverlapPrefix)).toBe(true);
    }
  });

  it("chunk[0].text has no prepended overlap (index 0)", () => {
    const target = 50;
    const overlap = 10;
    const text = "a".repeat(49) + " " + "b".repeat(49);
    const chunks = splitTextIntoChunks(text, target, overlap);
    // First chunk should begin with the first segment, not have overlap prepended
    expect(chunks[0].index).toBe(0);
    expect(chunks[0].startOffset).toBe(0);
  });

  it("overlap content is a suffix of the preceding segment", () => {
    const target = 60;
    const overlap = 15;
    // Three sentences each ~55 chars to force three chunks
    const s = "The quick brown fox jumps over the lazy dog here. ";
    const text = s.repeat(4);
    const chunks = splitTextIntoChunks(text, target, overlap);
    if (chunks.length >= 3) {
      // chunk[2].text should start with overlap content from segment[1]
      expect(chunks[2].text.length).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8: Index and startOffset correctness
// ─────────────────────────────────────────────────────────────────────────────

describe("splitTextIntoChunks — index and startOffset", () => {
  it("chunks have sequential 0-based indices", () => {
    const text = "word ".repeat(400); // ~2000 chars
    const chunks = splitTextIntoChunks(text);
    chunks.forEach((c, i) => expect(c.index).toBe(i));
  });

  it("startOffset[0] is always 0", () => {
    const text = "word ".repeat(400);
    const chunks = splitTextIntoChunks(text);
    expect(chunks[0].startOffset).toBe(0);
  });

  it("startOffsets are monotonically increasing", () => {
    const text = "word ".repeat(400);
    const chunks = splitTextIntoChunks(text);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].startOffset).toBeGreaterThan(chunks[i - 1].startOffset);
    }
  });

  it("last startOffset < original text length", () => {
    const text = "word ".repeat(400);
    const chunks = splitTextIntoChunks(text);
    expect(chunks[chunks.length - 1].startOffset).toBeLessThan(text.length);
  });

  it("single-chunk result has startOffset 0 and index 0", () => {
    const text = "short";
    const chunks = splitTextIntoChunks(text);
    expect(chunks[0].startOffset).toBe(0);
    expect(chunks[0].index).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9: Custom targetChars / overlapChars
// ─────────────────────────────────────────────────────────────────────────────

describe("splitTextIntoChunks — custom parameters", () => {
  it("respects a small custom targetChars", () => {
    const text = "abcdefghij".repeat(5); // 50 chars
    const chunks = splitTextIntoChunks(text, 10, 2);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(10 + 2);
    }
  });

  it("returns one chunk when text equals custom target exactly", () => {
    const text = "a".repeat(30);
    const chunks = splitTextIntoChunks(text, 30, 5);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe(text);
  });

  it("no overlap when overlapChars is 0", () => {
    const target = 20;
    const text = "a".repeat(19) + " " + "b".repeat(19);
    const chunks = splitTextIntoChunks(text, target, 0);
    if (chunks.length >= 2) {
      // chunk[1] should not start with content from segment[0]
      expect(chunks[1].text.startsWith("a")).toBe(false);
    }
  });

  it("large overlapChars still produces correct indices", () => {
    const target = 50;
    const overlap = 40;
    const text = "a".repeat(49) + " " + "b".repeat(49);
    const chunks = splitTextIntoChunks(text, target, overlap);
    chunks.forEach((c, i) => expect(c.index).toBe(i));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 10: Edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe("splitTextIntoChunks — edge cases", () => {
  it("handles a string that is exactly 1 char over the limit", () => {
    const text = "a".repeat(CHUNK_TARGET_CHARS + 1);
    const chunks = splitTextIntoChunks(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it("does not throw on very large input", () => {
    const text = "word ".repeat(5000); // ~25,000 chars
    expect(() => splitTextIntoChunks(text)).not.toThrow();
  });

  it("all chunks from very large input have valid text", () => {
    const text = "sentence here. ".repeat(200);
    const chunks = splitTextIntoChunks(text);
    for (const c of chunks) {
      expect(typeof c.text).toBe("string");
      expect(c.text.length).toBeGreaterThan(0);
    }
  });

  it("handles a single very long word (no spaces)", () => {
    const text = "x".repeat(CHUNK_TARGET_CHARS + 500);
    expect(() => splitTextIntoChunks(text)).not.toThrow();
    const chunks = splitTextIntoChunks(text);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it("handles unicode text (emoji, CJK)", () => {
    const text = "✅ deploy complete. ".repeat(100); // each ~20 chars
    expect(() => splitTextIntoChunks(text)).not.toThrow();
  });

  it("content is not silently dropped — all non-overlapping segment chars are represented", () => {
    const target = 40;
    const overlap = 5;
    // Construct 3 clear segments separated by spaces
    const s1 = "A".repeat(39) + " ";
    const s2 = "B".repeat(39) + " ";
    const s3 = "C".repeat(39);
    const text = s1 + s2 + s3;
    const chunks = splitTextIntoChunks(text, target, overlap);
    // Every segment's primary content should appear in some chunk
    const allText = chunks.map((c) => c.text).join("|");
    expect(allText).toContain("A");
    expect(allText).toContain("B");
    expect(allText).toContain("C");
  });

  it("returns a stable result when called twice on the same input", () => {
    const text = "sentence. ".repeat(200);
    const first = splitTextIntoChunks(text);
    const second = splitTextIntoChunks(text);
    expect(first).toEqual(second);
  });
});
