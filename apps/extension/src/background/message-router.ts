import type { SessionStore } from '../auth/session.js';
import type { AdapterRegistry } from '../platform/types.js';
import { resolveAdapterForUrl } from '../platform/registry.js';
import { isIntegrationReady } from '../platform/policy.js';
import { captureQuestion } from '../platform/question-capture.js';
import type { LocalStorageArea } from './storage.js';
import type { BrowserAuth } from '../auth/session.js';
import { ExtensionAuth } from '../auth/session.js';
import { ExtensionClient } from '../auth/client.js';

type Message = { type: string; [key: string]: unknown };
type MessageSender = { id?: string; tab?: { url?: string } };
export type PanelAuthState =
  | { kind: 'signedOut' }
  | { kind: 'noEntitlement' }
  | { kind: 'accessUnknown'; message?: string }
  | { kind: 'ready'; entitled: true };
type MessageResponse = { ok: true; state?: PanelAuthState; question?: unknown } | { ok: false; code: string };

export type MessageRouterOptions = {
  extensionId: string;
  registry: AdapterRegistry;
  sessionStore: SessionStore;
  localStorage: LocalStorageArea;
  apiBaseUrl?: string;
  oauthClientId?: string;
  productVersionId?: string;
  browserAuth?: BrowserAuth;
  fetch?: typeof fetch;
  isTrustedPage?: (url: string) => boolean;
  getState?: () => Promise<PanelAuthState>;
  signIn?: () => Promise<PanelAuthState>;
  signOut?: () => Promise<void>;
  captureQuestion?: (pageUrl: string) => Promise<unknown>;
  insertAnswer?: (pageUrl: string, answer: string) => Promise<boolean>;
  runInsertInPage?: (fn: () => boolean, text: string) => boolean | Promise<boolean>;
  runInPage?: <T>(fn: () => T) => Promise<T | null | undefined>;
  generateAnswer?: (question: unknown, apiKey: string) => Promise<{ answer: string }>;
  onApiKeyStatus?: (hasApiKey: boolean) => Promise<void> | void;
};

export function createExtensionMessageRouter(options: MessageRouterOptions) {
  const apiBaseUrl = options.apiBaseUrl?.trim().replace(/\/$/, '');
  const oauthClientId = options.oauthClientId?.trim();
  const productVersionId = options.productVersionId?.trim();
  const auth = apiBaseUrl && oauthClientId && productVersionId && options.browserAuth
    ? new ExtensionAuth({
        authorizeUrl: `${apiBaseUrl}/v1/oauth/authorize`,
        tokenUrl: `${apiBaseUrl}/v1/oauth/token`,
        clientId: oauthClientId,
        scope: 'openid profile',
        apiBaseUrl,
        productVersionId,
        browserAuth: options.browserAuth,
        sessionStore: options.sessionStore,
        fetch: options.fetch ?? fetch,
      })
    : null;
  return async (message: unknown, sender: MessageSender): Promise<MessageResponse> => {
    if (!isMessage(message) || sender.id !== options.extensionId) return { ok: false, code: 'UNTRUSTED_SENDER' };
    if (message.type === 'GET_STATE') {
      try {
        const state = options.getState ? await options.getState() : auth ? await getVerifiedState(await auth.client()) : { kind: 'accessUnknown' as const };
        return { ok: true, state };
      } catch { return { ok: true, state: { kind: 'accessUnknown', message: 'Could not verify your account.' } }; }
    }
      if (message.type === 'SIGN_IN') {
      try {
        let state: PanelAuthState;
        if (options.signIn) state = await options.signIn();
        else if (auth) { await auth.signIn(); state = await getVerifiedState(await auth.client()); }
        else state = { kind: 'accessUnknown', message: 'Sign-in is not configured.' };
        return { ok: true, state };
      } catch { return { ok: true, state: { kind: 'accessUnknown', message: 'Could not verify your account.' } }; }
    }
    if (message.type === 'SIGN_OUT') {
      try { if (options.signOut) await options.signOut(); else await auth?.signOut(); return { ok: true, state: { kind: 'signedOut' } }; }
      catch { return { ok: true, state: { kind: 'accessUnknown', message: 'Could not confirm sign-out.' } }; }
    }
    if (message.type === 'GET_API_KEY_STATUS') {
      const hasKey = Boolean((await options.localStorage.get('mark1.geminiKey'))['mark1.geminiKey']);
      await options.onApiKeyStatus?.(hasKey);
      return { ok: true };
    }
    if (message.type === 'CAPTURE_QUESTION') {
      const pageUrl = readString(message, 'pageUrl') || sender.tab?.url || '';
      const adapter = resolveAdapterForUrl(options.registry, pageUrl);
      if (!adapter || !isIntegrationReady(adapter) || !adapter.readiness?.allowedActions.includes('capture')) return { ok: false, code: 'ADAPTER_NOT_AVAILABLE' };
      try {
        const question = options.captureQuestion ? await options.captureQuestion(pageUrl) : await captureQuestion({
          pageUrl,
          adapters: options.registry.adapters,
          runInPage: async (fn) => {
            const result = options.runInPage ? await options.runInPage(fn) : fn();
            return result ?? undefined;
          },
        });
        return question !== null && question !== undefined ? { ok: true, question } : { ok: false, code: 'CAPTURE_UNAVAILABLE' };
      } catch { return { ok: false, code: 'CAPTURE_UNAVAILABLE' }; }
    }
    if (message.type === 'INSERT_ANSWER') {
      const pageUrl = readString(message, 'pageUrl') || sender.tab?.url || '';
      const answer = readString(message, 'answer');
      const adapter = resolveAdapterForUrl(options.registry, pageUrl);
      if (!adapter || !isIntegrationReady(adapter) || !adapter.readiness?.allowedActions.includes('insert')) return { ok: false, code: 'ADAPTER_NOT_AVAILABLE' };
      try {
        const ok = options.insertAnswer
          ? await options.insertAnswer(pageUrl, answer)
          : Boolean(await options.runInsertInPage?.(() => adapter.pageInsert(answer), answer));
        return ok ? { ok: true } : { ok: false, code: 'INSERT_UNAVAILABLE' };
      } catch { return { ok: false, code: 'INSERT_UNAVAILABLE' }; }
    }
    return { ok: false, code: 'MESSAGE_INVALID' };
  };
}

async function getVerifiedState(client: ExtensionClient): Promise<PanelAuthState> {
  try {
    const active = await client.hasEntitlement();
    return active ? { kind: 'ready', entitled: true } : { kind: 'noEntitlement' };
  } catch (error) {
    if (error instanceof Error && error.message === 'NOT_SIGNED_IN') return { kind: 'signedOut' };
    return { kind: 'accessUnknown', message: 'Could not verify your account.' };
  }
}

function isMessage(value: unknown): value is Message {
  return Boolean(value && typeof value === 'object' && 'type' in value && typeof (value as { type: unknown }).type === 'string');
}
function readString(message: Record<string, unknown>, key: string): string {
  const value = message[key];
  return typeof value === 'string' ? value : '';
}
