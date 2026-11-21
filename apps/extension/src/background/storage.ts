import type { ExtensionSession, SessionStore } from '../auth/session.js';
import type { SecretStore } from './storage-types.js';

const SESSION_KEY = 'mark1.session';
const GEMINI_KEY = 'mark1.geminiKey';

export type LocalStorageArea = {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
};

export function createChromeSessionStore(storage: LocalStorageArea): SessionStore {
  return {
    async read() {
      const result = await storage.get(SESSION_KEY);
      const value = result[SESSION_KEY] as ExtensionSession | undefined;
      return value && typeof value.accessToken === 'string' && typeof value.expiresAt === 'number'
        ? value
        : null;
    },
    async write(session) {
      await storage.set({ [SESSION_KEY]: session });
    },
    async clear() {
      await storage.remove(SESSION_KEY);
    },
  };
}

export function createChromeSecretStore(storage: LocalStorageArea): SecretStore {
  return {
    async getGeminiKey() {
      const result = await storage.get(GEMINI_KEY);
      const key = result[GEMINI_KEY];
      return typeof key === 'string' && key.trim() !== '' ? key : null;
    },
    async setGeminiKey(key) {
      const clean = key.trim();
      if (!clean) throw new Error('PROVIDER_KEY_EMPTY');
      await storage.set({ [GEMINI_KEY]: clean });
    },
    async hasGeminiKey() {
      const result = await storage.get(GEMINI_KEY);
      const key = result[GEMINI_KEY];
      return typeof key === 'string' && key.trim() !== '';
    },
    async deleteGeminiKey() {
      await storage.remove(GEMINI_KEY);
    },
  };
}
