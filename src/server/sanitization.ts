/**
 * Regular expression patterns designed to detect common prompt injection attacks,
 * instruction overrides, safety bypasses, and data exfiltration payloads.
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
  
  // 3. Data exfiltration payloads and target resources
  /exfiltrat/i, // matches exfiltrate, exfiltration, exfiltrating, etc.
  /\.env\s+file/i,
  /external\s+http\s+request/i,
  /send\s+(?:the\s+)?\.env/i,
  /leak\s+(?:the\s+)?(?:key|token|credential|secret|password)/i,
  /transmit\s+to\s+http/i,
  /http\s+request\s+to\s+exfiltrat/i,
];

/**
 * Splits a text block into individual sentences based on typical punctuation boundaries and newlines.
 */
function splitIntoSentences(text: string): string[] {
  // Split by sentence-ending punctuation (., !, ?) followed by space, or newlines
  return text.split(/(?<=[.!?])\s+|\n+/);
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
    
    // Check if sentence matches any adversarial pattern
    let isAdversarial = false;
    for (const pattern of ADVERSARIAL_PATTERNS) {
      if (pattern.test(trimmed)) {
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
