import { defineConfig } from 'wxt';
import manifest from './manifest.js';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest,
  manifestVersion: 3,
  webExt: {
    chromiumArgs: ['--disable-dev-shm-usage'],
  },
  vite: () => ({
    define: {
      'import.meta.env.WXT_API_BASE_URL': JSON.stringify(process.env.WXT_API_BASE_URL ?? ''),
      'import.meta.env.WXT_OAUTH_CLIENT_ID': JSON.stringify(process.env.WXT_OAUTH_CLIENT_ID ?? ''),
      'import.meta.env.WXT_PRODUCT_VERSION_ID': JSON.stringify(process.env.WXT_PRODUCT_VERSION_ID ?? 'mark1-v1'),
    },
  }),
});
