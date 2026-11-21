import type { JSX } from 'react';
import { useState } from 'react';

export function KeyEntry({ saveKey }: { saveKey(key: string): Promise<void> }): JSX.Element {
  const [key, setKey] = useState('');
  const [saved, setSaved] = useState(false);
  return (
    <section aria-label="Gemini key">
      <label>
        Gemini API key
        <input type="password" autoComplete="off" value={key} onChange={(event) => { setKey(event.currentTarget.value); setSaved(false); }} />
      </label>
      <button type="button" onClick={async () => { await saveKey(key); setKey(''); setSaved(true); }}>Save key</button>
      {saved && <p role="status">Gemini key saved on this browser profile.</p>}
      <p>The key stays in this browser profile and is used only for requests you initiate.</p>
    </section>
  );
}
