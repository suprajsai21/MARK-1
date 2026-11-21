import { describe, expect, it } from 'vitest';
import { createExtensionMessageRouter } from '../message-router.js';
import { createAdapterRegistry } from '../../platform/registry.js';
import type { PlatformAdapter } from '../../platform/types.js';

const readyReadiness = {
  linkMethodVerified: true,
  stagingAccessVerified: true,
  approvedWorkflowIds: ['fixture-workflow'],
  allowedActions: ['capture'] as const,
  evidenceReference: 'secure://integration-evidence/fixture',
};

function makeAdapter(overrides: Partial<PlatformAdapter> = {}): PlatformAdapter {
  return {
    id: 'fixture',
    origin: 'https://practice.example',
    mode: 'capture',
    pageCapture: () => ({ question: 'What is 2 + 2?', code: 'CAPTURE_OK' }),
    pageInsert: () => true,
    readiness: { ...readyReadiness, allowedActions: ['capture', 'insert'] },
    ...overrides,
  };
}

function setup(adapters: PlatformAdapter[] = [makeAdapter()], overrides: Record<string, unknown> = {}) {
  return createExtensionMessageRouter({
    extensionId: 'extension-id',
    registry: createAdapterRegistry(adapters),
    sessionStore: {
      read: async () => null,
      write: async () => undefined,
      clear: async () => undefined,
    },
    localStorage: {
      get: async () => ({}),
      set: async () => undefined,
      remove: async () => undefined,
    },
    ...overrides,
  });
}

const trusted = { id: 'extension-id' };
const untrusted = { id: 'other-id' };

describe('extension message router', () => {
  it('rejects messages from an untrusted sender', async () => {
    const router = setup();
    await expect(router({ type: 'GET_STATE' }, untrusted)).resolves.toEqual({ ok: false, code: 'UNTRUSTED_SENDER' });
  });

  it('fails closed to accessUnknown when no state provider is configured', async () => {
    const router = setup();
    await expect(router({ type: 'GET_STATE' }, trusted)).resolves.toEqual({ ok: true, state: { kind: 'accessUnknown' } });
  });

  it('returns an explicit not-configured state when sign-in is unavailable', async () => {
    const router = setup();
    await expect(router({ type: 'SIGN_IN' }, trusted)).resolves.toEqual({
      ok: true,
      state: { kind: 'accessUnknown', message: 'Sign-in is not configured.' },
    });
  });

  it('surfaces a configured state verbatim, including a verified ready state', async () => {
    const router = setup(undefined, {
      getState: async () => ({ kind: 'ready', entitled: true }),
    });
    await expect(router({ type: 'GET_STATE' }, trusted)).resolves.toEqual({
      ok: true,
      state: { kind: 'ready', entitled: true },
    });
  });

  it('never reports ready when the state provider throws', async () => {
    const router = setup(undefined, {
      getState: async () => { throw new Error('network'); },
    });
    await expect(router({ type: 'GET_STATE' }, trusted)).resolves.toEqual({
      ok: true,
      state: { kind: 'accessUnknown', message: 'Could not verify your account.' },
    });
  });

  it('reports capture unavailable for an unverified integration', async () => {
    const unverified = makeAdapter({ readiness: { ...readyReadiness, stagingAccessVerified: false } });
    const router = setup([unverified], { captureQuestion: async () => ({ question: 'x' }) });
    await expect(router({ type: 'CAPTURE_QUESTION', pageUrl: 'https://practice.example/lesson/1' }, trusted))
      .resolves.toMatchObject({ ok: false, code: 'ADAPTER_NOT_AVAILABLE' });
  });

  it('captures through a verified adapter', async () => {
    const router = setup([makeAdapter()], { captureQuestion: async () => ({ question: 'What is 2 + 2?' }) });
    await expect(router({ type: 'CAPTURE_QUESTION', pageUrl: 'https://practice.example/lesson/1' }, trusted))
      .resolves.toMatchObject({ ok: true });
  });

  it('refuses insertion when the adapter is not approved for insert', async () => {
    const captureOnly = makeAdapter({ readiness: { ...readyReadiness, allowedActions: ['capture'] } });
    const router = setup([captureOnly], { insertAnswer: async () => true });
    await expect(router({ type: 'INSERT_ANSWER', pageUrl: 'https://practice.example/lesson/1', answer: '4' }, trusted))
      .resolves.toMatchObject({ ok: false, code: 'ADAPTER_NOT_AVAILABLE' });
  });

  it('inserts through a verified adapter approved for insert', async () => {
    const router = setup([makeAdapter()], { insertAnswer: async () => true });
    await expect(router({ type: 'INSERT_ANSWER', pageUrl: 'https://practice.example/lesson/1', answer: '4' }, trusted))
      .resolves.toEqual({ ok: true });
  });

  it('rejects malformed messages', async () => {
    const router = setup();
    await expect(router({ type: 'UNKNOWN' }, trusted)).resolves.toEqual({ ok: false, code: 'MESSAGE_INVALID' });
    await expect(router(null, trusted)).resolves.toEqual({ ok: false, code: 'UNTRUSTED_SENDER' });
  });
});
