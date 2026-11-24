import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PracticePage } from './PracticePage.js';

describe('PracticePage', () => {
  afterEach(() => {
    cleanup();
  });
  it('renders problem prompt with data-testid="question-prompt" for extension capture', () => {
    render(<PracticePage />);
    const promptEl = screen.getByTestId('question-prompt');
    expect(promptEl).toBeDefined();
    expect(promptEl.textContent).toContain('Two Sum');
    expect(promptEl.textContent).toContain('Sample Input:');
  });

  it('renders code editor with starter code', () => {
    render(<PracticePage />);
    const editor = screen.getByTestId('code-editor') as HTMLTextAreaElement;
    expect(editor.value).toContain('def twoSum');
  });

  it('switches problems when clicking tab buttons', () => {
    render(<PracticePage />);
    const reverseTab = screen.getByRole('button', { name: /Reverse String/i });
    fireEvent.click(reverseTab);

    const promptEl = screen.getByTestId('question-prompt');
    expect(promptEl.textContent).toContain('Reverse String');

    const editor = screen.getByTestId('code-editor') as HTMLTextAreaElement;
    expect(editor.value).toContain('def reverseString');
  });

  it('simulates local code run', () => {
    render(<PracticePage />);
    const runBtn = screen.getByRole('button', { name: /Run Code/i });
    fireEvent.click(runBtn);

    expect(screen.getByText(/Solution is incomplete/i)).toBeDefined();
  });
});
