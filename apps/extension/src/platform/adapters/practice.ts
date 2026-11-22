import type { PageCaptureResult, PlatformAdapter } from '../types.js';

/**
 * Platform adapter for authorized local and web practice environments.
 * Safely extracts problem statements and supports controlled editor insertion
 * into standard code editors (textarea, Monaco, CodeMirror, Ace) without form submission.
 */
export function createPracticeAdapter(origin: string): PlatformAdapter {
  return {
    id: 'practice',
    origin,
    mode: 'capture',
    readiness: {
      linkMethodVerified: true,
      stagingAccessVerified: true,
      approvedWorkflowIds: ['practice-session'],
      allowedActions: ['capture', 'insert'],
      evidenceReference: 'practice-bench-v1',
    },
    pageCapture: (): PageCaptureResult | null => {
      if (typeof document === 'undefined') return null;

      // Selectors commonly used in practice environments
      const selectors = [
        '[data-testid="question-prompt"]',
        '[data-testid="problem-statement"]',
        '.question-prompt',
        '.problem-statement',
        '.practice-question',
        '.problem-description',
        '#problem-statement',
        'article.problem-description',
      ];

      for (const sel of selectors) {
        const el = document.querySelector<HTMLElement>(sel);
        const text = el?.innerText?.trim();
        if (text && text.length >= 12) {
          return { question: text, code: 'CAPTURE_OK' };
        }
      }

      // Fallback: check for heading + following paragraphs in practice container
      const container = document.querySelector<HTMLElement>('main, #root, #app, .practice-container');
      if (container) {
        const h = container.querySelector<HTMLElement>('h1, h2, h3');
        const p = container.querySelector<HTMLElement>('p');
        if (h && p) {
          const combined = `${h.innerText.trim()}\n\n${p.innerText.trim()}`.trim();
          if (combined.length >= 12) {
            return { question: combined, code: 'CAPTURE_OK' };
          }
        }
      }

      return null;
    },
    pageInsert: (text: string): boolean => {
      if (typeof document === 'undefined') return false;

      const isEditable = (el: Element | null): el is HTMLElement => {
        if (!el) return false;
        if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
          return !el.disabled && !el.readOnly;
        }
        if (el instanceof HTMLElement) {
          const editable = el.getAttribute('contenteditable');
          return editable === '' || editable === 'true';
        }
        return false;
      };

      // 1. Check currently active element
      let target: HTMLElement | null = isEditable(document.activeElement)
        ? (document.activeElement as HTMLElement)
        : null;

      // 2. Fallback to candidate editor elements in the DOM
      if (!target) {
        const editorSelectors = [
          'textarea:not([disabled]):not([readonly])',
          '.monaco-editor textarea',
          '.cm-content[contenteditable="true"]',
          '.CodeMirror textarea',
          '[contenteditable="true"]',
        ];
        for (const sel of editorSelectors) {
          const el = document.querySelector<HTMLElement>(sel);
          if (el && isEditable(el)) {
            target = el;
            break;
          }
        }
      }

      if (!target) return false;

      target.focus();

      if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
        const start = target.selectionStart ?? target.value.length;
        const end = target.selectionEnd ?? target.value.length;
        target.setRangeText(text, start, end, 'end');
        target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
        return true;
      }

      if (target.isContentEditable || target.getAttribute('contenteditable') === 'true') {
        const selection = document.getSelection();
        if (selection) {
          const range = document.createRange();
          range.selectNodeContents(target);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        }
        let inserted = false;
        try {
          inserted = document.execCommand('insertText', false, text);
        } catch {
          inserted = false;
        }
        if (!inserted) {
          target.textContent = (target.textContent || '') + text;
          inserted = true;
        }
        target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
        return inserted;
      }

      return false;
    },
  };
}
