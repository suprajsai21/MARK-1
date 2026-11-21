import { describe, expect, it } from 'vitest';
import type { PlatformAdapter } from '../types.js';
import { createAdapterRegistry, resolveAdapterForUrl } from '../registry.js';
import { isIntegrationReady } from '../policy.js';

function adapterFor(origin: string, mode: 'capture' | 'manual' = 'manual'): PlatformAdapter {
  return {
    id: `adapter-${origin}`,
    origin,
    mode,
    pageCapture: () => null,
    pageInsert: () => true,
    readiness: {
      linkMethodVerified: true,
      stagingAccessVerified: true,
      approvedWorkflowIds: ['fixture-workflow'],
      allowedActions: ['capture', 'insert'],
      evidenceReference: 'secure://integration-evidence/practice-example',
    },
  };
}

describe('adapter registry', () => {
  it('resolves an adapter only on its exact authorized origin', () => {
    const registry = createAdapterRegistry([adapterFor('https://practice.example')]);

    expect(resolveAdapterForUrl(registry, 'https://practice.example/lesson/1')?.origin)
      .toBe('https://practice.example');
    expect(resolveAdapterForUrl(registry, 'https://practice.example.evil.test/lesson/1')).toBeNull();
    expect(resolveAdapterForUrl(registry, 'https://other.example/lesson/1')).toBeNull();
  });

  it('ignores path, query, and port guessing by comparing full origins', () => {
    const registry = createAdapterRegistry([adapterFor('https://practice.example:8443')]);

    expect(resolveAdapterForUrl(registry, 'https://practice.example/lesson/1')).toBeNull();
    expect(resolveAdapterForUrl(registry, 'https://practice.example:8443/lesson/1')?.origin)
      .toBe('https://practice.example:8443');
  });

  it('refuses non-http(s) URLs', () => {
    const registry = createAdapterRegistry([adapterFor('https://practice.example')]);

    expect(resolveAdapterForUrl(registry, 'javascript:alert(1)')).toBeNull();
    expect(resolveAdapterForUrl(registry, 'chrome-extension://abc/lesson/1')).toBeNull();
  });

  it('is empty until an adapter is explicitly registered', () => {
    const registry = createAdapterRegistry([]);

    expect(resolveAdapterForUrl(registry, 'https://practice.example/lesson/1')).toBeNull();
  });

  it('keeps adapters without verified readiness disabled', () => {
    const unverified = adapterFor('https://practice.example');
    delete unverified.readiness;
    const registry = createAdapterRegistry([unverified]);

    expect(isIntegrationReady(unverified)).toBe(false);
    expect(resolveAdapterForUrl(registry, 'https://practice.example/lesson/1')).toBeNull();
  });

  it('rejects unapproved action declarations including submit', () => {
    const adapter = adapterFor('https://practice.example');
    adapter.readiness = { ...adapter.readiness!, allowedActions: ['capture', 'submit'] };

    expect(isIntegrationReady(adapter)).toBe(false);
  });

  it('does not allow duplicate adapters for the same origin', () => {
    expect(() => createAdapterRegistry([
      adapterFor('https://practice.example'),
      adapterFor('https://practice.example', 'capture'),
    ])).toThrow('ADAPTER_ORIGIN_DUPLICATE');
  });
});
