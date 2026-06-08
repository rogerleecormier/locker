/**
 * Recursive text splitter optimised for Cloudflare Edge (no NLP deps).
 *
 * BGE-M3 has a ~512-token hard limit. At ~3.5 chars/token that's ~1792 chars.
 * We target 1500 chars per chunk (safe margin) with 200-char overlap so
 * semantic context bleeds across boundaries.
 *
 * Strategy:
 *  1. Try splitting on paragraph breaks (\n\n)
 *  2. Fall back to sentence boundaries (.?!\n)
 *  3. Fall back to word boundaries (spaces)
 *  4. Hard-split as last resort
 *
 * Returns the original text unchanged if it fits in one chunk (no allocation).
 */

export const CHUNK_TARGET_CHARS = 1500;
export const CHUNK_OVERLAP_CHARS = 200;

/** A single segment produced by the splitter. */
export type TextChunk = {
  text: string;
  /** 0-based index within the chunk sequence for this parent text. */
  index: number;
  /** Character offset where this chunk starts in the original text. */
  startOffset: number;
};

/**
 * Splits `text` into overlapping semantic chunks ready for embedding.
 * Returns a single-element array when the text fits within one chunk.
 */
export function splitTextIntoChunks(
  text: string,
  targetChars = CHUNK_TARGET_CHARS,
  overlapChars = CHUNK_OVERLAP_CHARS,
): TextChunk[] {
  if (text.length <= targetChars) {
    return [{ text, index: 0, startOffset: 0 }];
  }

  const segments = recursiveSplit(text, targetChars);
  return mergeWithOverlap(segments, overlapChars);
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Ordered set of separator strategies, coarsest → finest. */
const SEPARATORS = ["\n\n", "\n", ". ", "! ", "? ", " "];

function recursiveSplit(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];

  for (const sep of SEPARATORS) {
    const parts = splitOnSeparator(text, sep, maxChars);
    if (parts.length > 1) {
      // Recursively split any parts still over the limit
      return parts.flatMap((p) =>
        p.length <= maxChars ? [p] : recursiveSplit(p, maxChars),
      );
    }
  }

  // Hard split — no separator found (e.g. continuous CJK or very long token)
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += maxChars) {
    chunks.push(text.slice(i, i + maxChars));
  }
  return chunks;
}

/**
 * Splits `text` by `sep` into pieces that do not exceed `maxChars`.
 * Pieces are accumulated greedily; a new piece starts only when adding the
 * next segment would overflow.
 */
function splitOnSeparator(text: string, sep: string, maxChars: number): string[] {
  const raw = text.split(sep);
  if (raw.length === 1) return raw; // separator not present

  const result: string[] = [];
  let current = "";

  for (const part of raw) {
    const candidate = current ? current + sep + part : part;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) result.push(current);
      current = part;
    }
  }
  if (current) result.push(current);

  return result;
}

/**
 * Given a sequence of non-overlapping segments, produces overlapping TextChunks
 * by prepending the tail of the previous segment to each subsequent one.
 */
function mergeWithOverlap(segments: string[], overlapChars: number): TextChunk[] {
  const chunks: TextChunk[] = [];
  let charOffset = 0;

  for (let i = 0; i < segments.length; i++) {
    let text = segments[i];

    if (i > 0) {
      const prev = segments[i - 1];
      // Guard: slice(-0) === slice(0) returns the full string in JS
      const overlap = overlapChars > 0 ? prev.slice(-overlapChars) : "";
      text = overlap + text;
      // Offset tracks position in original (no overlap adjustment needed for
      // search purposes — we surface startOffset so callers can deduplicate).
    }

    chunks.push({ text, index: i, startOffset: charOffset });
    charOffset += segments[i].length;
  }

  return chunks;
}
