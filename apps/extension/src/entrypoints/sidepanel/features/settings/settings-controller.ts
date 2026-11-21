import type { SecretStore } from '../../../../background/storage-types.js';

export type KeyValidation =
  | { valid: true }
  | { valid: false; reason: 'invalid' | 'quota' | 'network' };

export type SettingsProvider = { validateKey(key: string): Promise<KeyValidation> };
export type SettingsControllerOptions = { store: SecretStore; provider: SettingsProvider };

export function createSettingsController(options: SettingsControllerOptions) {
  return {
    async keyStatus() {
      return {
        hasKey: await options.store.hasGeminiKey(),
        message: 'Gemini key saved on this browser profile.',
        disclosure: 'The key is stored locally in this browser profile and sent only to Google Gemini when you choose to generate.',
      };
    },
    async saveKey(key: string): Promise<void> {
      await options.store.setGeminiKey(key);
    },
    async validateKey(key: string): Promise<KeyValidation> {
      const clean = key.trim();
      if (!clean) return { valid: false, reason: 'invalid' };
      try {
        return await options.provider.validateKey(clean);
      } catch {
        return { valid: false, reason: 'network' };
      }
    },
    async deleteKey(): Promise<void> {
      await options.store.deleteGeminiKey();
    },
  };
}
