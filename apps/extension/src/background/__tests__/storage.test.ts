import { describe, expect, it } from 'vitest';
import { createChromeSecretStore, createChromeSessionStore } from '../storage.js';

function fakeStorage() {
  const values: Record<string, unknown> = {};
  const removed: string[] = [];
  return {
    values,
    removed,
    area: {
      async get(keys: string | string[]) {
        const names = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(names.filter((key) => key in values).map((key) => [key, values[key]]));
      },
      async set(items: Record<string, unknown>) { Object.assign(values, items); },
      async remove(keys: string | string[]) {
        for (const key of Array.isArray(keys) ? keys : [keys]) {
          removed.push(key);
          delete values[key];
        }
      },
    },
  };
}

describe('Chrome local storage adapters', () => {
  it('persists only the short-lived extension session fields', async () => {
    const fake = fakeStorage();
    const store = createChromeSessionStore(fake.area);
    const session = { accessToken: 'access-token', expiresAt: Date.now() + 900_000 };

    await store.write(session);

    expect(fake.values['mark1.session']).toEqual(session);
    expect(JSON.stringify(fake.values)).not.toContain('refreshToken');
    expect(await store.read()).toEqual(session);
    await store.clear();
    expect(fake.removed).toContain('mark1.session');
  });

  it('stores and removes the user-supplied provider key by explicit methods', async () => {
    const fake = fakeStorage();
    const store = createChromeSecretStore(fake.area);

    await store.setGeminiKey(' key-value ');

    expect(fake.values['mark1.geminiKey']).toBe('key-value');
    await expect(store.getGeminiKey()).resolves.toBe('key-value');
    await store.deleteGeminiKey();
    expect(fake.removed).toContain('mark1.geminiKey');
    await expect(store.getGeminiKey()).resolves.toBeNull();
  });

  it('does not store an empty provider key', async () => {
    const fake = fakeStorage();
    const store = createChromeSecretStore(fake.area);

    await expect(store.setGeminiKey('  ')).rejects.toThrow('PROVIDER_KEY_EMPTY');
    expect(fake.values['mark1.geminiKey']).toBeUndefined();
  });
});
