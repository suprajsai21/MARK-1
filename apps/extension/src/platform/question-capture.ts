import { resolveAdapterForUrl } from './registry.js';
import type { PageCaptureResult, PlatformAdapter } from './types.js';

export const MINIMUM_CAPTURE_LENGTH = 12;

export type CaptureDraft = {
  prompt: string;
  code: string;
  source: 'approved-adapter';
};

const MARKUP_PATTERN = /<[^>]*>/g;

function normalize(text: string): string {
  return text.replace(MARKUP_PATTERN, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Capture is opt-in, per-adapter, and per-origin. The page function is supplied
 * by the adapter but executed by the caller inside the tab, so this module
 * never touches the DOM itself. Anything unexpected (no adapter, foreign
 * origin, thin content, adapter failure) yields null so the panel falls back to
 * the manual paste path.
 */
export async function captureQuestion(input: {
  pageUrl: string;
  adapters: readonly PlatformAdapter[];
  runInPage: (fn: () => PageCaptureResult) => Promise<PageCaptureResult | undefined>;
}): Promise<CaptureDraft | null> {
  const adapter = resolveAdapterForUrl({ adapters: input.adapters }, input.pageUrl);
  if (!adapter || adapter.mode !== 'capture') return null;

  let captured: PageCaptureResult | undefined;
  try {
    captured = await input.runInPage(() => {
      const result = adapter.pageCapture();
      if (!result) throw new Error('CAPTURE_UNAVAILABLE');
      return result;
    });
  } catch {
    return null;
  }
  if (!captured) return null;

  const prompt = normalize(captured.question);
  if (prompt.length < MINIMUM_CAPTURE_LENGTH) return null;

  return { prompt, code: captured.code.trim(), source: 'approved-adapter' };
}

export function normalizeManualPrompt(text: string): string | null {
  const prompt = normalize(text);
  return prompt.length < MINIMUM_CAPTURE_LENGTH ? null : prompt;
}
