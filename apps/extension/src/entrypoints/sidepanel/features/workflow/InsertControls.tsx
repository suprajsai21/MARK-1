import type { JSX } from 'react';

type InsertControlsProps = {
  answer: string;
  approved: boolean;
  onApprove(): void;
  onInsert(): void;
  disabled?: boolean;
};

export function InsertControls({ answer, approved, onApprove, onInsert, disabled = false }: InsertControlsProps): JSX.Element {
  return (
    <section aria-label="Review answer">
      <h2>Review before using</h2>
      <pre>{answer}</pre>
      <p>This only fills the focused editor. It does not submit your answer.</p>
      <label>
        <input type="checkbox" checked={approved} onChange={onApprove} disabled={disabled} />
        I approved this answer for insertion
      </label>
      <button type="button" onClick={onInsert} disabled={!approved || disabled}>
        Insert into editor
      </button>
    </section>
  );
}
