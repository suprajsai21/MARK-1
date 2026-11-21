import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { createExtensionMessageRouter } from '../background/message-router.js';
import { createChromeSecretStore, createChromeSessionStore } from '../background/storage.js';
import { createSessionLifecycle } from '../background/session-lifecycle.js';
import { createAdapterRegistry } from '../platform/registry.js';

/**
 * No platform adapters ship enabled. Site support is added deliberately, one
 * origin at a time, after the adapter has been reviewed and tested.
 */
const registry = createAdapterRegistry([]);

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
    apiBaseUrl: values.WXT_API_BASE_URL,
    oauthClientId: values.WXT_OAUTH_CLIENT_ID,
    productVersionId: values.WXT_PRODUCT_VERSION_ID,
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
