/** Validates and extracts captureQuestion's current background message response. */
export function normalizeCapturedPrompt(value: unknown): string | null {
  if (!value || typeof value !== 'object' || (value as { ok?: unknown }).ok !== true) return null;
  const question = (value as { question?: unknown }).question;
  if (!question || typeof question !== 'object') return null;
  const prompt = (question as { prompt?: unknown }).prompt;
  return typeof prompt === 'string' && prompt.trim().length > 0 ? prompt : null;
}
