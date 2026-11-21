export default {
  name: 'MARK-1 Learning Assistant',
  description: 'A user-controlled study assistant for authorized learning workflows.',
  version: '1.0.0',
  permissions: ['sidePanel', 'storage', 'identity', 'scripting', 'alarms', 'activeTab'],
  // `activeTab` grants temporary access only after the user invokes the extension.
  action: {},
  side_panel: {
    default_path: 'sidepanel.html',
  },
  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
  },
};
