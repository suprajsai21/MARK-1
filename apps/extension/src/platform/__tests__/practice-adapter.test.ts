import { beforeEach, describe, expect, it } from 'vitest';
import { createPracticeAdapter } from '../adapters/practice.js';
import { isIntegrationReady } from '../policy.js';

describe('practice adapter', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('is recognized as integration ready with capture and insert capabilities', () => {
    const adapter = createPracticeAdapter('http://localhost:5173');
    expect(isIntegrationReady(adapter)).toBe(true);
    expect(adapter.readiness?.allowedActions).toContain('capture');
    expect(adapter.readiness?.allowedActions).toContain('insert');
  });

  it('captures question prompt from testid container', () => {
    const adapter = createPracticeAdapter('http://localhost:5173');
    const questionEl = document.createElement('div');
    questionEl.setAttribute('data-testid', 'question-prompt');
    questionEl.innerText = 'Write a function to compute the Fibonacci sequence up to N.';
    document.body.appendChild(questionEl);

    const result = adapter.pageCapture();
    expect(result).not.toBeNull();
    expect(result?.code).toBe('CAPTURE_OK');
    expect(result?.question).toContain('Fibonacci sequence');
  });

  it('inserts code into a focused or available textarea without submitting forms', () => {
    const adapter = createPracticeAdapter('http://localhost:5173');
    const form = document.createElement('form');
    let submitted = false;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submitted = true;
    });

    const textarea = document.createElement('textarea');
    form.appendChild(textarea);
    document.body.appendChild(form);

    const success = adapter.pageInsert('def fib(n):\n    return n if n <= 1 else fib(n-1) + fib(n-2)');
    expect(success).toBe(true);
    expect(textarea.value).toContain('def fib(n):');
    expect(submitted).toBe(false);
  });

  it('inserts text into contenteditable elements', () => {
    const adapter = createPracticeAdapter('http://localhost:5173');
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    editor.className = 'cm-content';
    document.body.appendChild(editor);

    const success = adapter.pageInsert('console.log("hello");');
    expect(success).toBe(true);
  });

  it('returns false when no editor is present in DOM', () => {
    const adapter = createPracticeAdapter('http://localhost:5173');
    const success = adapter.pageInsert('some text');
    expect(success).toBe(false);
  });
});
