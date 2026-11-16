import { describe, expect, it } from 'vitest';
import { buildSessionCookie, newOpaqueToken, tokenHash } from '../sessions.js';

describe('auth session security', () => {
  it('enforces secure cookie attributes: HttpOnly, Secure, SameSite=Lax, Path=/', () => {
    const cookie = buildSessionCookie('opaque-session-token', { secure: true, maxAgeSeconds: 3600 });
    expect(cookie).toContain('mark1_session=opaque-session-token');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=3600');
  });

  it('generates random opaque tokens with sha256 one-way hashing', () => {
    const t1 = newOpaqueToken();
    const t2 = newOpaqueToken();
    expect(t1).not.toBe(t2);
    expect(t1.length).toBeGreaterThanOrEqual(32);

    const h1 = tokenHash(t1);
    expect(h1).toHaveLength(64);
    expect(h1).not.toBe(t1);
  });
});
