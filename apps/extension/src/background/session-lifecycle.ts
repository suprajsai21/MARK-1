import type { ExtensionSession } from '../auth/session.js';
import type { LocalStorageArea } from './storage.js';

const SESSION_KEY = 'mark1.session';
const SESSION_ALARM = 'mark1.session-expiry';

export type SessionLifecycleOptions = {
  storage: LocalStorageArea;
  onExpired?: () => Promise<void> | void;
};

export function createSessionLifecycle(options: SessionLifecycleOptions) {
  return {
    async save(session: ExtensionSession): Promise<void> {
      if (session.expiresAt <= Date.now()) throw new Error('SESSION_EXPIRED');
      await options.storage.set({ [SESSION_KEY]: session });
      await chrome.alarms.create(SESSION_ALARM, { when: session.expiresAt });
    },
    async read(): Promise<ExtensionSession | null> {
      const record = await options.storage.get(SESSION_KEY);
      const value = record[SESSION_KEY] as ExtensionSession | undefined;
      if (!value || typeof value.accessToken !== 'string' || typeof value.expiresAt !== 'number') return null;
      if (value.expiresAt <= Date.now()) {
        await this.clear();
        return null;
      }
      return value;
    },
    async clear(): Promise<void> {
      await options.storage.remove(SESSION_KEY);
      await chrome.alarms.clear(SESSION_ALARM);
    },
    async handleAlarm(name: string): Promise<void> {
      if (name !== SESSION_ALARM) return;
      const session = await this.read();
      if (!session) await options.onExpired?.();
    },
  };
}
