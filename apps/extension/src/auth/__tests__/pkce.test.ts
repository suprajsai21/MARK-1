import { describe, expect, it } from 'vitest';
import { createPkcePair, isSafeState, isValidVerifier, parseCallback } from '../pkce.js';

describe('PKCE pair', () => {
  it('produces a verifier the server accepts and an S256 challenge', async () => {
    const pair = await createPkcePair();

    expect(pair.verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
    expect(isValidVerifier(pair.verifier)).toBe(true);
    expect(pair.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pair.state).toMatch(/^[A-Za-z0-9_-]{32,}$/);
  });

  it('never repeats a verifier or state', async () => {
    const first = await createPkcePair();
    const second = await createPkcePair();

    expect(first.verifier).not.toBe(second.verifier);
    expect(first.state).not.toBe(second.state);
  });

  it('rejects short, empty, or ill-charactered verifiers', () => {
    expect(isValidVerifier('')).toBe(false);
    expect(isValidVerifier('a'.repeat(42))).toBe(false);
    expect(isValidVerifier(`${'a'.repeat(42)}!`)).toBe(false);
  });
});

describe('callback parsing', () => {
  const valid = {
    state: 's'.repeat(40),
    code: 'authorization-code-1',
  };

  it('accepts a matching state and single code', () => {
    const result = parseCallback(
      `https://extension.invalid/oauth/callback?state=${valid.state}&code=${valid.code}`,
      valid.state,
    );

    expect(result).toEqual({ code: valid.code });
  });

  it('accepts chrome identity chromiumapp.org callback url', () => {
    const result = parseCallback(
      `https://abcdefghijklmnop.chromiumapp.org/oauth/callback?state=${valid.state}&code=${valid.code}`,
      valid.state,
    );

    expect(result).toEqual({ code: valid.code });
  });

  it('rejects a state mismatch even when the code is well-formed', () => {
    expect(() => parseCallback(
      `https://extension.invalid/oauth/callback?state=${'x'.repeat(40)}&code=${valid.code}`,
      valid.state,
    )).toThrow('OAUTH_STATE_MISMATCH');
  });

  it('rejects missing, empty, or repeated codes', () => {
    expect(() => parseCallback(
      `https://extension.invalid/oauth/callback?state=${valid.state}`,
      valid.state,
    )).toThrow('OAUTH_CODE_MISSING');

    expect(() => parseCallback(
      `https://extension.invalid/oauth/callback?state=${valid.state}&code=`,
      valid.state,
    )).toThrow('OAUTH_CODE_MISSING');

    expect(() => parseCallback(
      `https://extension.invalid/oauth/callback?state=${valid.state}&code=a&code=b`,
      valid.state,
    )).toThrow('OAUTH_CODE_MISSING');
  });

  it('rejects a non-loopback-non-extension callback host', () => {
    expect(() => parseCallback(
      `https://evil.example/oauth/callback?state=${valid.state}&code=${valid.code}`,
      valid.state,
    )).toThrow('OAUTH_REDIRECT_INVALID');
  });

  it('rejects provider error callbacks and does not throw a network error', () => {
    expect(() => parseCallback(
      `https://extension.invalid/oauth/callback?state=${valid.state}&error=access_denied`,
      valid.state,
    )).toThrow('OAUTH_DENIED');
  });
});

describe('state safety', () => {
  it('only accepts opaque high-entropy state values', () => {
    expect(isSafeState('a'.repeat(43))).toBe(true);
    expect(isSafeState('short')).toBe(false);
    expect(isSafeState('')).toBe(false);
    expect(isSafeState(null)).toBe(false);
  });
});
