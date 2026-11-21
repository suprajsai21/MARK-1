import { describe, expect, it } from 'vitest';
import { createInMemorySecretStore, withProviderKey } from '../secret-store.js';

describe('provider secret store', () => {
  it('round-trips a provider key without exposing it in reads', async () => {
    const store = createInMemorySecretStore();

    await store.setGeminiKey('key-123');

    await expect(store.hasGeminiKey()).resolves.toBe(true);
    await expect(store.getGeminiKey()).resolves.toBe('key-123');
  });

  it('deletes the key on sign-out', async () => {
    const store = createInMemorySecretStore();
    await store.setGeminiKey('key-123');

    await store.deleteGeminiKey();

    await expect(store.hasGeminiKey()).resolves.toBe(false);
    await expect(store.getGeminiKey()).resolves.toBeNull();
  });

  it('never includes the key in the object it hands to provider calls', async () => {
    const store = createInMemorySecretStore();
    await store.setGeminiKey('key-123');

    const call = await withProviderKey(store, async (key) => key);

    expect(call).toBe('key-123');
    expect(JSON.stringify(store)).not.toContain('key-123');
  });

  it('fails closed when there is no key', async () => {
    const store = createInMemorySecretStore();

    await expect(withProviderKey(store, async () => 'unreachable')).rejects.toThrow('PROVIDER_KEY_MISSING');
  });
});
