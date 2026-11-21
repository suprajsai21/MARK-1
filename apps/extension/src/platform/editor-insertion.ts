export type EditorTarget = HTMLTextAreaElement | HTMLInputElement | HTMLElement;

export type EditorInserterOptions = {
  getActiveElement(): Element | null;
  dispatchInput?: (element: EditorTarget) => void;
};

function isEditable(element: Element): element is EditorTarget {
  if (element instanceof HTMLTextAreaElement) return !element.disabled && !element.readOnly;
  if (element instanceof HTMLInputElement) {
    return !element.disabled && !element.readOnly && !['button', 'submit', 'reset', 'checkbox', 'radio', 'file'].includes(element.type);
  }
  if (!(element instanceof HTMLElement)) return false;
  const editable = element.getAttribute('contenteditable');
  return editable === '' || editable === 'true';
}

export function createEditorInserter(options: EditorInserterOptions) {
  return async (text: string, signal?: AbortSignal): Promise<void> => {
    if (signal?.aborted) throw new Error('WORKFLOW_CANCELLED');
    const target = options.getActiveElement();
    if (!target) throw new Error('EDITOR_NOT_FOCUSED');
    if (!isEditable(target)) throw new Error('EDITOR_NOT_SUPPORTED');
    if ('disabled' in target && target.disabled) throw new Error('EDITOR_NOT_SUPPORTED');
    if ('readOnly' in target && target.readOnly) throw new Error('EDITOR_NOT_SUPPORTED');

    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
      const start = target.selectionStart ?? target.value.length;
      const end = target.selectionEnd ?? target.value.length;
      target.setRangeText(text, start, end, 'end');
      (options.dispatchInput ?? ((element) => element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))))(target);
      return;
    }

    target.focus();
    const selection = document.getSelection();
    if (!selection) throw new Error('EDITOR_NOT_SUPPORTED');
    if (selection.rangeCount === 0 || !target.contains(selection.anchorNode)) {
      const range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    if (!document.execCommand('insertText', false, text)) throw new Error('EDITOR_NOT_SUPPORTED');
    (options.dispatchInput ?? ((element) => element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))))(target);
  };
}
