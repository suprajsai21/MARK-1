import { describe, expect, it, vi } from 'vitest';
import { createSessionLifecycle } from '../session-lifecycle.js';
import { createChromeSessionStore } from '../storage.js';

function memoryStorage() {
  const data: Record<string, unknown> = {};
  return {
    data,
    area: {
      async get(keys: string | string[]) {
        const all = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(all.filter((key) => key in data).map((key) => [key, data[key]]));
      },
      async set(items: Record<string, unknown>) { Object.assign(data, items); },
      async remove(keys: string | string[]) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; },
    },
  };
}

describe('session lifecycle', () => {
  it('persists sessions and schedules their expiry alarm', async () => {
    const memory = memoryStorage();
    const create = vi.fn(async () => undefined);
    const clear = vi.fn(async () => true);
    vi.stubGlobal('chrome', { alarms: { create, clear } });
    const lifecycle = createSessionLifecycle({ storage: memory.area });
    const session = { accessToken: 'access', expiresAt: Date.now() + 120_000 };
    await lifecycle.save(session);
    expect(memory.data['mark1.session']).toEqual(session);
    expect(create).toHaveBeenCalledWith('mark1.session-expiry', { when: session.expiresAt });
    expect(await lifecycle.read()).toEqual(session);
    vi.unstubAllGlobals();
  });

  it('removes expired sessions and reports the expiry alarm', async () => {
    const memory = memoryStorage();
    const clear = vi.fn(async () => true);
    const onExpired = vi.fn();
    vi.stubGlobal('chrome', { alarms: { create: vi.fn(), clear } });
    const lifecycle = createSessionLifecycle({ storage: memory.area, onExpired });
    memory.data['mark1.session'] = { accessToken: 'expired', expiresAt: Date.now() - 1 };
    await expect(lifecycle.read()).resolves.toBeNull();
    expect(memory.data['mark1.session']).toBeUndefined();
    expect(clear).toHaveBeenCalledWith('mark1.session-expiry');
    await lifecycle.handleAlarm('mark1.session-expiry');
    expect(onExpired).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it('does not persist refresh tokens in extension storage', async () => {
    const memory = memoryStorage();
    const store = createChromeSessionStore(memory.area);
    await store.write({ accessToken: 'temporary-access', expiresAt: Date.now() + 120_000 });
    expect(JSON.stringify(memory.data)).not.toContain('refreshToken');
    expect((await store.read())?.accessToken).toBe('temporary-access');
  });
});
