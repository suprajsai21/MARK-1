import { describe, expect, it } from 'vitest';
import { InsertControls } from '../InsertControls.js';
import { renderToStaticMarkup } from 'react-dom/server';

describe('insert controls', () => {
  it('never auto-submits and explains that insertion only fills the editor', () => {
    const markup = renderToStaticMarkup(
      <InsertControls
        answer="Suggested answer"
        approved={false}
        onApprove={() => undefined}
        onInsert={() => undefined}
      />,
    );
    expect(markup).toMatch(/review/i);
    expect(markup).toMatch(/does not submit/i);
    expect(markup).not.toMatch(/type="submit"/i);
  });

  it('requires an explicit separate approval before enabling insertion', () => {
    const markup = renderToStaticMarkup(
      <InsertControls
        answer="Suggested answer"
        approved={false}
        onApprove={() => undefined}
        onInsert={() => undefined}
      />,
    );
    expect(markup).toMatch(/approve/i);
    expect(markup).toMatch(/disabled=""/i);
  });
});
