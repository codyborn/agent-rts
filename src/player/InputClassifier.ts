// ============================================================
// Agent RTS - Input Classifier
// ============================================================
// Heuristically classifies player text input as either a
// command (directive to act) or a question (request for info).
// ============================================================

export type InputIntent = 'command' | 'question';

const QUESTION_WORDS = [
  'what', 'where', 'how', 'why', 'who', 'can', 'do', 'is', 'are',
  'did', 'will', 'would', 'could', 'should', 'which', 'when',
];

const QUESTION_PHRASES = [
  'report', 'status', 'tell me', 'sitrep', 'what do you see',
  'what\'s', 'whats', 'how many', 'any enemies', 'are there',
  'do you see', 'can you see', 'what are', 'what is',
];

/**
 * Classify a text input as a command or question using heuristics.
 */
export function classifyInput(text: string): InputIntent {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 'command';

  // Ends with question mark
  if (trimmed.endsWith('?')) return 'question';

  const lower = trimmed.toLowerCase();

  // Check question phrases (multi-word patterns first)
  for (const phrase of QUESTION_PHRASES) {
    if (lower.includes(phrase)) return 'question';
  }

  // Starts with a question word
  const firstWord = lower.split(/\s+/)[0];
  if (QUESTION_WORDS.includes(firstWord)) return 'question';

  return 'command';
}
