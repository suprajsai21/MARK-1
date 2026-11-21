import { describe, expect, it } from 'vitest';
import { createEditorInserter } from '../editor-insertion.js';

describe('conservative editor insertion', () => {
  it('inserts plain text into an explicitly approved textarea', async () => {
    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    const insert = createEditorInserter({
      getActiveElement: () => textarea,
      dispatchInput: (element) => element.dispatchEvent(new Event('input', { bubbles: true })),
    });
    await insert('Reviewed answer');
    expect(textarea.value).toBe('Reviewed answer');
    textarea.remove();
  });

  it('refuses to insert when no editor is focused', async () => {
    const insert = createEditorInserter({ getActiveElement: () => null });
    await expect(insert('answer')).rejects.toThrow('EDITOR_NOT_FOCUSED');
  });

  it('refuses hidden, disabled, readonly, or submit elements', async () => {
    for (const element of [
      Object.assign(document.createElement('textarea'), { disabled: true }),
      Object.assign(document.createElement('textarea'), { readOnly: true }),
      Object.assign(document.createElement('button'), { type: 'submit' }),
    ]) {
      const insert = createEditorInserter({ getActiveElement: () => element });
      await expect(insert('answer')).rejects.toThrow('EDITOR_NOT_SUPPORTED');
    }
  });

  it('never clicks a page control or submits a form', async () => {
    const form = document.createElement('form');
    const button = document.createElement('button');
    button.type = 'submit';
    const textarea = document.createElement('textarea');
    form.append(textarea, button);
    document.body.append(form);
    let submits = 0;
    form.addEventListener('submit', (event) => { event.preventDefault(); submits += 1; });

    const insert = createEditorInserter({ getActiveElement: () => textarea });
    await insert('Reviewed answer');

    expect(submits).toBe(0);
    expect(textarea.value).toBe('Reviewed answer');
    form.remove();
  });

  it('observes cancellation before touching the editor', async () => {
    const textarea = document.createElement('textarea');
    const controller = new AbortController();
    controller.abort();
    const insert = createEditorInserter({ getActiveElement: () => textarea });
    await expect(insert('answer', controller.signal)).rejects.toThrow('WORKFLOW_CANCELLED');
    expect(textarea.value).toBe('');
  });
});
