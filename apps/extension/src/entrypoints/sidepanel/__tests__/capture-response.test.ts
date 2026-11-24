import { describe, expect, it } from 'vitest';
import { normalizeCapturedPrompt } from '../capture-response.js';

describe('normalizeCapturedPrompt', () => {
  it('extracts a prompt from the background router envelope', () => {
    expect(normalizeCapturedPrompt({
      ok: true,
      question: { prompt: 'Explain the water cycle.', code: '', source: 'approved-adapter' },
    })).toBe('Explain the water cycle.');
  });

  it('rejects unavailable, malformed, or empty capture responses', () => {
    expect(normalizeCapturedPrompt({ ok: false, code: 'ADAPTER_NOT_AVAILABLE' })).toBeNull();
    expect(normalizeCapturedPrompt({ ok: true, question: null })).toBeNull();
    expect(normalizeCapturedPrompt({ ok: true, question: { prompt: '   ' } })).toBeNull();
    expect(normalizeCapturedPrompt({ ok: true, prompt: 'wrong envelope' })).toBeNull();
  });
});
