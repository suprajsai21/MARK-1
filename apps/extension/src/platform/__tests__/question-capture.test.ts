import { describe, expect, it } from 'vitest';
import { captureQuestion, MINIMUM_CAPTURE_LENGTH } from '../question-capture.js';
import type { PageCaptureResult, PlatformAdapter } from '../types.js';

function adapterFor(result: PageCaptureResult): PlatformAdapter {
  return {
    id: 'fixture',
    origin: 'https://practice.example',
    mode: 'capture',
    pageCapture: () => result,
    pageInsert: () => true,
    readiness: {
      linkMethodVerified: true,
      stagingAccessVerified: true,
      approvedWorkflowIds: ['fixture-workflow'],
      allowedActions: ['capture', 'insert'],
      evidenceReference: 'secure://integration-evidence/fixture',
    },
  };
}

function captureFrom(result: PageCaptureResult) {
  return {
    pageUrl: 'https://practice.example/lesson/1',
    adapters: [adapterFor(result)],
    runInPage: async (fn: () => PageCaptureResult) => fn(),
  };
}

describe('question capture', () => {
  it('returns nothing when there is no adapter for the page', async () => {
    await expect(captureQuestion({
      pageUrl: 'https://unknown.example/lesson',
      adapters: [],
      runInPage: async (fn) => fn(),
    })).resolves.toBeNull();
  });

  it('captures from an approved adapter only on its own origin', async () => {
    const draft = await captureQuestion(
      captureFrom({ question: 'What is the time complexity of binary search?', code: '' }),
    );

    expect(draft).toEqual({
      prompt: 'What is the time complexity of binary search?',
      code: '',
      source: 'approved-adapter',
    });
  });

  it('refuses a lookalike origin', async () => {
    await expect(captureQuestion({
      pageUrl: 'https://practice.example.evil.test/lesson/1',
      adapters: [adapterFor({ question: 'Question text that is long enough to pass the length gate.', code: '' })],
      runInPage: async (fn) => fn(),
    })).resolves.toBeNull();
  });

  it('drops captures that are too short to be a real question', async () => {
    await expect(captureQuestion(
      captureFrom({ question: 'a'.repeat(MINIMUM_CAPTURE_LENGTH - 1), code: '' }),
    )).resolves.toBeNull();
  });

  it('normalizes whitespace and never returns markup', async () => {
    const draft = await captureQuestion(
      captureFrom({ question: '  Which   option\n\nis correct?  ', code: '' }),
    );

    expect(draft?.prompt).toBe('Which option is correct?');
  });

  it('keeps the code payload trimmed', async () => {
    const draft = await captureQuestion(
      captureFrom({ question: 'What does this function return?', code: '  return 42;  ' }),
    );

    expect(draft?.code).toBe('return 42;');
  });

  it('returns null instead of throwing when the adapter fails', async () => {
    await expect(captureQuestion({
      pageUrl: 'https://practice.example/lesson/1',
      adapters: [adapterFor({ question: 'placeholder', code: '' })],
      runInPage: async () => { throw new Error('page changed'); },
    })).resolves.toBeNull();
  });

  it('returns null and never calls the page when the adapter is manual mode', async () => {
    let called = false;
    const adapter: PlatformAdapter = {
      id: 'manual-fixture',
      origin: 'https://practice.example',
      mode: 'manual',
      pageCapture: () => ({ question: 'Should never run from manual mode.', code: '' }),
      pageInsert: () => true,
      readiness: {
        linkMethodVerified: true,
        stagingAccessVerified: true,
        approvedWorkflowIds: ['fixture-workflow'],
        allowedActions: ['capture'],
        evidenceReference: 'secure://integration-evidence/fixture',
      },
    };

    await expect(captureQuestion({
      pageUrl: 'https://practice.example/lesson/1',
      adapters: [adapter],
      runInPage: async (fn) => { called = true; return fn(); },
    })).resolves.toBeNull();
    expect(called).toBe(false);
  });
});
