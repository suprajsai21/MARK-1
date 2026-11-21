import type { SecretStore } from './storage-types.js';

export function createInMemorySecretStore(): SecretStore {
  let key: string | null = null;
  return {
    async getGeminiKey() { return key; },
    async setGeminiKey(value) {
      const clean = value.trim();
      if (!clean) throw new Error('PROVIDER_KEY_EMPTY');
      key = clean;
    },
    async hasGeminiKey() { return key !== null; },
    async deleteGeminiKey() { key = null; },
  };
}

export async function withProviderKey<T>(
  store: SecretStore,
  operation: (key: string) => Promise<T>,
): Promise<T> {
  const key = await store.getGeminiKey();
  if (!key) throw new Error('PROVIDER_KEY_MISSING');
  return operation(key);
}
