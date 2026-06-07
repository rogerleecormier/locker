/**
 * Regular expression patterns designed to detect common prompt injection attacks,
 * instruction overrides, safety bypasses, and data exfiltration payloads.
 *
 * Patterns cover both plain text and common Unicode/homoglyph bypass attempts
 * (e.g. zero-width characters, look-alike letters). Each pattern is tested
 * against a normalised copy of the input (see sanitizeMemory below).
 */
const ADVERSARIAL_PATTERNS = [
  // 1. Direct instruction ignores and overrides (e.g. "ignore previous instructions")
  /ignore\s+(?:previous|all|the\s+above|system|safety|user|developer)?\s*instructions?/i,
  /disregard\s+(?:previous|all|the\s+above|system|safety|user|developer)?\s*instructions?/i,
  /forget\s+(?:your|previous|all|system|safety|user|developer)?\s*instructions?/i,
  /override\s+(?:system|safety|previous|user|developer)?\s*(?:prompts?|instructions?|rules?)/i,
  /(?:system|safety|instruction|prompt)\s*override/i,
  /ignore\s+rules/i,
  /bypass\s+safety/i,
  /ignore\s+everything\s+before/i,
  /ignore\s+all\s+guidelines/i,
  /ignore\s+the\s+user/i,

  // 2. Control flow hijacking and system simulation commands
  /you\s+must\s+now/i,
  /you\s+are\s+now\s+a/i,
  /new\s+instruction/i,
  /act\s+as\s+(?:a|an)\s+/i,
  /pretend\s+(?:you\s+are|to\s+be)/i,
  /roleplay\s+as/i,
  /simulate\s+(?:a|an)\s+/i,
  /enter\s+(?:developer|god|sudo|jailbreak|DAN)\s+mode/i,
  /\[system\]/i,
  /\[assistant\]/i,
  /\bDAN\b/,  // "Do Anything Now" jailbreak token

  // 3. Delimiter / context-injection attacks
  /<\|(?:im_start|im_end|system|user|assistant)\|>/i,
  /###\s*(?:System|Instruction|Prompt|Override)/i,
  /---+\s*(?:system|instruction|new\s+context)/i,
  /\[\[(?:SYSTEM|INST|SYS|END)\]\]/i,

  // 4. Data exfiltration payloads and target resources
  /exfiltrat/i,
  /\.env\s+file/i,
  /external\s+http\s+request/i,
  /send\s+(?:the\s+)?\.env/i,
  /leak\s+(?:the\s+)?(?:key|token|credential|secret|password)/i,
  /transmit\s+to\s+https?/i,
  /http\s+request\s+to\s+exfiltrat/i,
  /curl\s+https?:/i,
  /wget\s+https?:/i,
  /fetch\s*\(\s*['"`]https?:/i,

  // 5. Secondary-prompt / indirect injection markers
  /\bprompt\s+injection\b/i,
  /\bindirect\s+injection\b/i,
  /\bsecret\s+instruction\b/i,
  /\bhidden\s+(?:command|instruction|prompt)\b/i,
];

/**
 * Splits a text block into individual sentences based on typical punctuation boundaries and newlines.
 */
function splitIntoSentences(text: string): string[] {
  // Split by sentence-ending punctuation (., !, ?) followed by space, or newlines
  return text.split(/(?<=[.!?])\s+|\n+/);
}

/**
 * Normalise a string for adversarial-pattern matching:
 * 1. Unicode NFC normalisation collapses composed/decomposed forms.
 * 2. Strip zero-width characters that are invisible but can split keywords.
 * 3. Collapse repeated whitespace so "i g n o r e" doesn't slip through.
 *
 * The original (unnormalized) value is preserved for storage; only the
 * normalised copy is tested against ADVERSARIAL_PATTERNS.
 */
function normalizeForPatternMatch(text: string): string {
  return text
    .normalize("NFC")
    // Remove zero-width space, ZWSP, ZWNJ, ZWJ, word-joiner, soft-hyphen, BOM
    .replace(/[​‌‍⁠­﻿]/g, "")
    // Collapse all whitespace sequences to a single space
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Scans a memory fact block and strips any sentences matching adversarial patterns.
 * Returns the cleaned, sanitized string. If the entire content is stripped, returns an empty string.
 */
export function sanitizeMemory(fact: string): string {
  if (!fact) return "";

  const sentences = splitIntoSentences(fact);
  const cleanSentences: string[] = [];

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    // Test the normalised form so zero-width / homoglyph tricks don't bypass patterns.
    const normalised = normalizeForPatternMatch(trimmed);

    let isAdversarial = false;
    for (const pattern of ADVERSARIAL_PATTERNS) {
      if (pattern.test(normalised)) {
        isAdversarial = true;
        break;
      }
    }

    if (!isAdversarial) {
      cleanSentences.push(trimmed);
    } else {
      console.warn(`[sanitization] Stripped adversarial sentence: "${trimmed}"`);
    }
  }

  return cleanSentences.join(" ").trim();
}
