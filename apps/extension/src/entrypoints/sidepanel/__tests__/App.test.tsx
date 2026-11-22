import { describe, expect, it, vi } from 'vitest';
import { App, type PanelState } from '../App.js';
import { renderToStaticMarkup } from 'react-dom/server';

const copy: Record<PanelState['kind'], RegExp> = {
  signedOut: /sign in/i,
  noEntitlement: /access.*purchase|purchase.*access/i,
  accessUnknown: /blocked|verify/i,
  ready: /ready/i,
  questionReview: /review/i,
  generating: /generat/i,
  answerReview: /answer/i,
  error: /try again/i,
  loading: /loading/i,
};

describe('side panel states', () => {
  for (const [kind, pattern] of Object.entries(copy)) {
    it(`renders the ${kind} state for the customer`, () => {
      const state = kind === 'ready' ? { kind: 'ready' as const, entitled: true as const } : { kind: kind as Exclude<PanelState['kind'], 'ready'> };
      const markup = renderToStaticMarkup(<App state={state} />);
      expect(markup).toMatch(pattern);
      expect(markup).not.toMatch(/admin/i);
    });
  }

  it('renders settings input with password semantics and local storage disclosure', () => {
    const markup = renderToStaticMarkup(<App state={{ kind: 'ready', entitled: true }} />);
    expect(markup).toMatch(/type="password"/);
    expect(markup).toMatch(/browser profile/i);
    expect(markup).toMatch(/sent to Google only when you choose/i);
    expect(markup).toMatch(/<details class="settings-surface"/);
    expect(markup).toMatch(/<summary>Settings · Gemini and privacy<\/summary>/);
  });

  it('routes sign in request to the trusted background', async () => {
    const sendMessage = vi.fn(async () => ({ ok: true, session: { accessToken: 'access-1' } }));
    vi.stubGlobal('chrome', { runtime: { sendMessage }, storage: { local: { get: vi.fn(), set: vi.fn(), remove: vi.fn() } } });
    const markup = renderToStaticMarkup(<App state={{ kind: 'signedOut' }} />);
    expect(markup).toMatch(/Sign in/);
    expect(markup).not.toContain('access-1');
    vi.unstubAllGlobals();
  });

  it('blocks capture and generation when entitlement is unknown', () => {
    const markup = renderToStaticMarkup(<App state={{ kind: 'error', message: 'Could not verify account. Access is blocked.' }} />);
    expect(markup).toContain('Access is blocked');
    expect(markup).not.toContain('Capture from current page');
    expect(markup).not.toContain('Confirm and generate');
  });

  it('shows a blocked purchase state when entitlement is absent', () => {
    const markup = renderToStaticMarkup(<App state={{ kind: 'noEntitlement' }} />);
    expect(markup).toContain('Connect an active MARK-1 purchase');
    expect(markup).toContain('Check access');
    expect(markup).not.toContain('Capture from current page');
  });

  it('never renders study controls for unknown or unentitled states', () => {
    for (const state of [
      { kind: 'accessUnknown' as const },
      { kind: 'signedOut' as const },
      { kind: 'loading' as const },
    ]) {
      const markup = renderToStaticMarkup(<App state={state} />);
      expect(markup).not.toContain('Capture from current page');
      expect(markup).not.toContain('Confirm and generate');
    }
  });

  it('shows workflow controls only after trusted state confirms entitlement', () => {
    const markup = renderToStaticMarkup(<App state={{ kind: 'ready', entitled: true }} />);
    expect(markup).toContain('Capture from current page');
  });
});
