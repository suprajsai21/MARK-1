import { describe, expect, it } from 'vitest';
import { createWorkflowController } from '../workflow-controller.js';

function harness() {
  let generated = 0;
  let inserted = 0;
  let workflow: 'practice' | 'exam' = 'practice';
  const controller = createWorkflowController({
    capture: async () => ({ prompt: 'Question from the page', source: 'approved-adapter' as const, code: 'CAPTURE_OK' }),
    generate: async () => { generated += 1; return { answer: 'Suggested answer' }; },
    insert: async () => { inserted += 1; },
    getContext: async () => ({ workflow, userInitiated: true }),
  });
  return {
    controller,
    counts: () => ({ generated, inserted }),
    setWorkflow: (next: 'practice' | 'exam') => { workflow = next; },
  };
}

describe('workflow controller', () => {
  it('moves from ready to question review before generation', async () => {
    const { controller, counts } = harness();
    await controller.capture();
    expect(controller.getState()).toMatchObject({ kind: 'questionReview', prompt: 'Question from the page' });
    expect(counts()).toEqual({ generated: 0, inserted: 0 });
  });

  it('requires explicit question confirmation before provider generation', async () => {
    const { controller, counts } = harness();
    await controller.setPrompt('A manually pasted question text');
    expect(controller.getState()).toMatchObject({ kind: 'questionReview' });
    expect(counts().generated).toBe(0);

    await controller.confirmQuestion();
    expect(counts().generated).toBe(1);
  });

  it('requires explicit answer approval before insertion', async () => {
    const { controller, counts } = harness();
    await controller.capture();
    await controller.confirmQuestion();
    expect(controller.getState()).toMatchObject({ kind: 'answerReview', answer: 'Suggested answer' });
    await controller.insert();
    expect(counts().inserted).toBe(0);
    expect(controller.getState()).toMatchObject({ kind: 'answerReview' });
  });

  it('inserts only after explicit answer approval', async () => {
    const { controller, counts } = harness();
    await controller.capture();
    await controller.confirmQuestion();
    await controller.approveAnswer();
    await controller.insert();
    expect(counts().inserted).toBe(1);
    expect(controller.getState()).toMatchObject({ kind: 'ready' });
  });

  it('blocks capture and generation for an exam workflow', async () => {
    const { controller, counts, setWorkflow } = harness();
    setWorkflow('exam');
    await controller.capture();
    await controller.confirmQuestion();
    expect(controller.getState()).toMatchObject({ kind: 'error', code: 'WORKFLOW_NOT_AUTHORIZED' });
    expect(counts()).toEqual({ generated: 0, inserted: 0 });
  });

  it('cancels in-flight generation and discards its result', async () => {
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    let finish: ((value: { answer: string }) => void) | undefined;
    const controller = createWorkflowController({
      capture: async () => ({ prompt: 'Question text', source: 'approved-adapter' as const, code: 'CAPTURE_OK' }),
      generate: async (_prompt, signal) => new Promise((resolve) => {
        markStarted();
        signal.addEventListener('abort', () => resolve({ answer: 'must be discarded' }));
        finish = resolve;
      }),
      insert: async () => undefined,
      getContext: async () => ({ workflow: 'practice' as const, userInitiated: true }),
    });

    await controller.setPrompt('Question text');
    const generating = controller.confirmQuestion();
    await started;
    controller.cancel();
    finish?.({ answer: 'must be discarded' });
    await generating;
    expect(controller.getState()).toMatchObject({ kind: 'ready' });
  });

  it('resets all review state after sign-out', async () => {
    const { controller } = harness();
    await controller.capture();
    controller.signOut();
    expect(controller.getState()).toMatchObject({ kind: 'signedOut' });
  });
});
