import { describe, expect, it } from 'vitest';
import { createSettingsController } from '../settings-controller.js';
import { createInMemorySecretStore } from '../../../../../background/secret-store.js';

function providerStub() {
  const calls: string[] = [];
  return {
    calls,
    async validateKey(key: string) {
      calls.push(key);
      if (key === 'bad-key') return { valid: false as const, reason: 'invalid' as const };
      return { valid: true as const };
    },
  };
}

describe('settings controller', () => {
  it('saves and reports the key without returning the secret', async () => {
    const store = createInMemorySecretStore();
    const provider = providerStub();
    const settings = createSettingsController({ store, provider });
    await settings.saveKey('my-gemini-key');
    expect(await store.getGeminiKey()).toBe('my-gemini-key');
    expect(await settings.keyStatus()).toMatchObject({ hasKey: true });
    expect(JSON.stringify(await settings.keyStatus())).not.toContain('my-gemini-key');
  });

  it('does not contact provider during key status reads', async () => {
    const provider = providerStub();
    const settings = createSettingsController({ store: createInMemorySecretStore(), provider });
    expect((await settings.keyStatus()).hasKey).toBe(false);
    expect(provider.calls).toHaveLength(0);
  });

  it('validates only on explicit action and reports safe status codes', async () => {
    const provider = {
      async validateKey(key: string) {
        if (key === 'bad') return { valid: false as const, reason: 'invalid' as const };
        if (key === 'quota') return { valid: false as const, reason: 'quota' as const };
        if (key === 'network') return { valid: false as const, reason: 'network' as const };
        return { valid: true as const };
      },
    };
    const settings = createSettingsController({ store: createInMemorySecretStore(), provider });
    await expect(settings.validateKey('bad')).resolves.toMatchObject({ valid: false, reason: 'invalid' });
    await expect(settings.validateKey('quota')).resolves.toMatchObject({ valid: false, reason: 'quota' });
    await expect(settings.validateKey('network')).resolves.toMatchObject({ valid: false, reason: 'network' });
    expect(JSON.stringify(await settings.validateKey('bad'))).not.toContain('bad');
  });

  it('replaces and deletes an existing key', async () => {
    const store = createInMemorySecretStore();
    const settings = createSettingsController({ store, provider: providerStub() });
    await settings.saveKey('first-key');
    await settings.saveKey('second-key');
    expect(await store.getGeminiKey()).toBe('second-key');
    await settings.deleteKey();
    expect(await store.getGeminiKey()).toBeNull();
  });

  it('discloses that a key stays in this browser profile', async () => {
    const settings = createSettingsController({ store: createInMemorySecretStore(), provider: providerStub() });
    expect((await settings.keyStatus()).disclosure).toMatch(/browser profile/i);
  });
});
