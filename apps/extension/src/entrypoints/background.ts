import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { createExtensionMessageRouter } from '../background/message-router.js';
import { createChromeSecretStore, createChromeSessionStore } from '../background/storage.js';
import { createSessionLifecycle } from '../background/session-lifecycle.js';
import { createAdapterRegistry } from '../platform/registry.js';
import { createPracticeAdapter } from '../platform/adapters/practice.js';

/**
 * Standard authorized local and staging practice origins.
 * Additional domains are registered following authorization review.
 */
const PRACTICE_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:4173',
  'http://localhost:8080',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:4173',
  'http://127.0.0.1:8080',
];

const registry = createAdapterRegistry(PRACTICE_ORIGINS.map(createPracticeAdapter));

export default defineBackground(() => {
  const storage = {
    get: (keys: string | string[]) => browser.storage.local.get(keys),
    set: (items: Record<string, unknown>) => browser.storage.local.set(items),
    remove: (keys: string | string[]) => browser.storage.local.remove(keys),
  };
  const secrets = createChromeSecretStore(storage);
  const values = import.meta.env;
  const lifecycle = createSessionLifecycle({ storage });
  const router = createExtensionMessageRouter({
    extensionId: browser.runtime.id,
    registry,
    sessionStore: createChromeSessionStore(storage),
    localStorage: storage,
    signOut: () => lifecycle.clear(),
    apiBaseUrl: values.WXT_API_BASE_URL || 'http://localhost:3000',
    webBaseUrl: values.WXT_WEB_BASE_URL || 'http://localhost:5173',
    oauthClientId: values.WXT_OAUTH_CLIENT_ID || 'mark1-extension',
    productVersionId: values.WXT_PRODUCT_VERSION_ID || 'mark1-v1',
    runInPage: async <T>(fn: () => T): Promise<T | null | undefined> => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return null;
      try {
        const results = await browser.scripting.executeScript({
          target: { tabId: tab.id },
          func: fn,
        });
        return (results[0]?.result as T) ?? null;
      } catch {
        return null;
      }
    },
    runInsertInPage: async (_fn: () => boolean, text: string): Promise<boolean> => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return false;
      try {
        const results = await browser.scripting.executeScript({
          target: { tabId: tab.id },
          func: (insertText: string) => {
            const isEditable = (el: Element | null): el is HTMLElement => {
              if (!el) return false;
              if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
                return !el.disabled && !el.readOnly;
              }
              if (el instanceof HTMLElement) {
                const editable = el.getAttribute('contenteditable');
                return editable === '' || editable === 'true';
              }
              return false;
            };

            let target: HTMLElement | null = isEditable(document.activeElement)
              ? (document.activeElement as HTMLElement)
              : null;

            if (!target) {
              const selectors = [
                'textarea:not([disabled]):not([readonly])',
                '.monaco-editor textarea',
                '.cm-content[contenteditable="true"]',
                '.CodeMirror textarea',
                '[contenteditable="true"]',
              ];
              for (const sel of selectors) {
                const el = document.querySelector<HTMLElement>(sel);
                if (el && isEditable(el)) {
                  target = el;
                  break;
                }
              }
            }

            if (!target) return false;
            target.focus();

            if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
              const start = target.selectionStart ?? target.value.length;
              const end = target.selectionEnd ?? target.value.length;
              target.setRangeText(insertText, start, end, 'end');
              target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: insertText }));
              return true;
            }

            if (target.isContentEditable || target.getAttribute('contenteditable') === 'true') {
              const selection = document.getSelection();
              if (selection) {
                const range = document.createRange();
                range.selectNodeContents(target);
                range.collapse(false);
                selection.removeAllRanges();
                selection.addRange(range);
              }
              let inserted = false;
              try {
                inserted = document.execCommand('insertText', false, insertText);
              } catch {
                inserted = false;
              }
              if (!inserted) {
                target.textContent = (target.textContent || '') + insertText;
                inserted = true;
              }
              target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: insertText }));
              return inserted;
            }
            return false;
          },
          args: [text],
        });
        return Boolean(results[0]?.result);
      } catch {
        return false;
      }
    },
    browserAuth: {
      getRedirectURL: (path) => browser.identity.getRedirectURL(path),
      launchWebAuthFlow: ({ url, interactive }) => new Promise((resolve, reject) => {
        browser.identity.launchWebAuthFlow({ url, interactive }, (responseUrl) => {
          const error = browser.runtime.lastError;
          if (error) reject(new Error(error.message));
          else if (responseUrl) resolve(responseUrl);
          else reject(new Error('OAUTH_CALLBACK_MISSING'));
        });
      }),
    },
  });

  browser.runtime.onMessage.addListener((message, sender) => router(message, sender));
  browser.alarms.onAlarm.addListener((alarm) => {
    void lifecycle.handleAlarm(alarm.name);
  });
  browser.runtime.onStartup.addListener(() => {
    void lifecycle.read();
  });
  browser.runtime.onInstalled.addListener(() => {
    void lifecycle.read();
  });
  if (browser.sidePanel?.setPanelBehavior) {
    void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }

  // Session and secret stores are wired here so both entry points use the same
  // storage area; the side panel only ever receives the API key status, never
  // the secret value.
  void secrets;
});
