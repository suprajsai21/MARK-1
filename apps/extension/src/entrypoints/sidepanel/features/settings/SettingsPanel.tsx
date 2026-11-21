import type { JSX } from 'react';
import { useState } from 'react';
import type { SecretStore } from '../../../../background/storage-types.js';
import type { SettingsProvider } from './settings-controller.js';
import { createSettingsController } from './settings-controller.js';

type SettingsProps = { store: SecretStore; provider: SettingsProvider };

export function SettingsPanel({ store, provider }: SettingsProps): JSX.Element {
  const controller = createSettingsController({ store, provider });
  const [key, setKey] = useState('');
  const [message, setMessage] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const refresh = async () => {
    const status = await controller.keyStatus();
    setHasKey(status.hasKey);
    setMessage(status.disclosure);
  };

  return (
    <section aria-label="Settings">
      <h2>Gemini settings</h2>
      <p>The Gemini key is optional and belongs to your Google account. It stays in this browser profile and is sent only to Google Gemini when you choose to generate.</p>
      <label>
        Gemini API key
        <input type="password" autoComplete="off" value={key} onChange={(event) => setKey(event.currentTarget.value)} aria-label="Gemini API key" />
      </label>
      <button type="button" onClick={async () => { await controller.saveKey(key); setKey(''); await refresh(); }}>Save key</button>
      <button type="button" onClick={async () => {
        const result = await controller.validateKey(key);
        setMessage(result.valid ? 'Gemini key is valid.' : `Key check failed: ${result.reason}.`);
      }}>Validate key</button>
      <button type="button" disabled={!hasKey} onClick={async () => { await controller.deleteKey(); await refresh(); }}>Delete key</button>
      <p role="status">{message}</p>
    </section>
  );
}
