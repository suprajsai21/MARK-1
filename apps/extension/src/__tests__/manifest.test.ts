import { describe, expect, it } from 'vitest';
import manifest from '../../manifest.js';

describe('extension manifest', () => {
  it('defines a Manifest V3 user-controlled study extension', () => {
    expect(manifest.name).toMatch(/MARK-1/);
    expect(manifest.permissions).toEqual(expect.arrayContaining(['sidePanel', 'storage', 'identity', 'scripting', 'alarms', 'activeTab']));
  });

  it('makes broad host access optional and requests it only after an explicit user action', () => {
    expect('host_permissions' in manifest).toBe(false);
    expect('optional_host_permissions' in manifest).toBe(false);
    expect(manifest.permissions).toContain('activeTab');
  });
});
