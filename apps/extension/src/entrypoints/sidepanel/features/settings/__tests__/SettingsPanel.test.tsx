import { describe, expect, it } from 'vitest';
import { SettingsPanel } from '../SettingsPanel.js';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SecretStore } from '../../../../../background/storage-types.js';

function store(): SecretStore {
  return {
    async getGeminiKey() { return null; },
    async setGeminiKey() {},
    async hasGeminiKey() { return false; },
    async deleteGeminiKey() {},
  };
}

describe('settings panel', () => {
  it('uses a password input and gives storage disclosure without showing a saved key', () => {
    const markup = renderToStaticMarkup(
      <SettingsPanel store={store()} provider={{ validateKey: async () => ({ valid: true }) }} />,
    );
    expect(markup).toMatch(/type="password"/);
    expect(markup).toMatch(/browser profile/i);
    expect(markup).toMatch(/<label[^>]*for="gemini-key"[^>]*>Gemini API key<\/label>/);
    expect(markup).toMatch(/<input id="gemini-key"[^>]*value=""/);
    expect(markup).not.toMatch(/value="[^"]+"/);
  });
});
