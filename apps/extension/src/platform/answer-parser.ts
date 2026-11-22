export type ParsedAnswer = {
  raw: string;
  code: string;
  language: string;
  hasCodeBlock: boolean;
  explanation: string;
};

/**
 * Parses raw LLM answer output to extract structured code and educational explanation.
 * When the answer contains fenced code blocks (```lang ... ```), it extracts the
 * primary code block for editor insertion, and preserves the surrounding reasoning
 * for the user's study review.
 */
export function parseAnswer(rawText: string): ParsedAnswer {
  if (!rawText || !rawText.trim()) {
    return {
      raw: '',
      code: '',
      language: 'text',
      hasCodeBlock: false,
      explanation: '',
    };
  }

  // Regex to match fenced markdown code blocks: ```[language]\n[code]```
  const codeBlockRegex = /```([a-zA-Z0-9_+#.-]*)\s*\n?([\s\S]*?)```/;
  const match = codeBlockRegex.exec(rawText);

  if (match) {
    const rawLang = match[1]?.trim() || '';
    const code = match[2]?.trim() || '';
    const language = rawLang.toLowerCase() || 'code';

    // Remove the primary code block from explanation to keep clean study notes
    const explanation = rawText.replace(match[0], '').replace(/\n{3,}/g, '\n\n').trim();

    return {
      raw: rawText,
      code,
      language,
      hasCodeBlock: code.length > 0,
      explanation: explanation || 'Full solution code provided above.',
    };
  }

  // If no markdown code fence is present, the entire text is the answer/code
  const trimmed = rawText.trim();
  return {
    raw: rawText,
    code: trimmed,
    language: 'text',
    hasCodeBlock: false,
    explanation: trimmed,
  };
}
