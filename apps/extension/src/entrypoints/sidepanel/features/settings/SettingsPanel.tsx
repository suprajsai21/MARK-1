import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import type { SecretStore } from '../../../../background/storage-types.js';
import type { SettingsProvider } from './settings-controller.js';
import { createSettingsController } from './settings-controller.js';

type SettingsProps = { store: SecretStore; provider: SettingsProvider };

export function SettingsPanel({ store, provider }: SettingsProps): JSX.Element {
  const controller = createSettingsController({ store, provider });
  const [key, setKey] = useState('');
  const [message, setMessage] = useState('');
  const [hasKey, setHasKey] = useState(false);
  useEffect(() => { void refresh(); }, []);
  const refresh = async () => {
    const status = await controller.keyStatus();
    setHasKey(status.hasKey);
    setMessage(status.disclosure);
  };

  return (
    <section className="settings-card" aria-label="Settings">
      <p className="eyebrow">Your tools</p>
      <h3 className="card-title">Gemini settings</h3>
      <p className="helper">Your Gemini API key is optional. It stays in this browser profile and is sent to Google only when you choose to generate an answer.</p>
      <label className="field-label" htmlFor="gemini-key">Gemini API key</label>
      <input id="gemini-key" className="key-field" type="password" autoComplete="off" value={key} onChange={(event) => setKey(event.currentTarget.value)} />
      <div className="button-row settings-actions">
        <button className="action secondary" type="button" disabled={!key.trim()} onClick={async () => { await controller.saveKey(key); setKey(''); await refresh(); }}>Save key</button>
        <button className="action secondary" type="button" disabled={!key.trim()} onClick={async () => {
          const result = await controller.validateKey(key);
          setMessage(result.valid ? 'Gemini key is valid.' : `Key check failed: ${result.reason}.`);
        }}>Validate</button>
        <button className="text-button" type="button" disabled={!hasKey} onClick={async () => { await controller.deleteKey(); await refresh(); }}>Delete</button>
      </div>
      <p className="helper" role="status" aria-live="polite">{message || (hasKey ? 'A Gemini key is stored in this browser.' : 'No Gemini key saved yet.')}</p>
    </section>
  );
}
