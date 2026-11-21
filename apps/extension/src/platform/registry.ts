import type { AdapterRegistry, PlatformAdapter } from './types.js';
import { isIntegrationReady } from './policy.js';

function canonicalOrigin(input: string): string | null {
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function createAdapterRegistry(adapters: readonly PlatformAdapter[]): AdapterRegistry {
  const seen = new Set<string>();
  for (const adapter of adapters) {
    const origin = canonicalOrigin(adapter.origin);
    if (!origin) throw new Error('ADAPTER_ORIGIN_INVALID');
    if (seen.has(origin)) throw new Error('ADAPTER_ORIGIN_DUPLICATE');
    seen.add(origin);
  }
  return { adapters: [...adapters] };
}

export function resolveAdapterForUrl(registry: AdapterRegistry, pageUrl: string): PlatformAdapter | null {
  const origin = canonicalOrigin(pageUrl);
  if (!origin) return null;
  return registry.adapters.find((adapter) => canonicalOrigin(adapter.origin) === origin && isIntegrationReady(adapter)) ?? null;
}
