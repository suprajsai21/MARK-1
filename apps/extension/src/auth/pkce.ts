/**
 * PKCE helpers for the extension's OAuth flow.
 *
 * The verifier never leaves the extension. Only its S256 challenge goes on the
 * authorization request, and the callback is validated against the same state
 * we generated before the code is exchanged — in the background only.
 */

export type PkcePair = {
  verifier: string;
  challenge: string;
  state: string;
};

const VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;
const STATE_PATTERN = /^[A-Za-z0-9_-]{32,}$/;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomToken(byteLength: number): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return toBase64Url(new Uint8Array(digest));
}

export function isValidVerifier(verifier: string): boolean {
  return VERIFIER_PATTERN.test(verifier);
}

export function isSafeState(state: string | null | undefined): state is string {
  return typeof state === 'string' && STATE_PATTERN.test(state);
}

export async function createPkcePair(): Promise<PkcePair> {
  const verifier = randomToken(48);
  const state = randomToken(32);
  if (!isValidVerifier(verifier)) throw new Error('PKCE_VERIFIER_INVALID');
  if (!isSafeState(state)) throw new Error('OAUTH_STATE_INVALID');

  return {
    verifier,
    challenge: await sha256Base64Url(verifier),
    state,
  };
}

export function buildAuthorizationUrl(input: {
  authorizeUrl: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  pair: PkcePair;
}): string {
  const url = new URL(input.authorizeUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('scope', input.scope);
  url.searchParams.set('state', input.pair.state);
  url.searchParams.set('code_challenge', input.pair.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

function isExtensionCallbackUrl(url: URL): boolean {
  return url.protocol === 'https:' && (
    url.hostname === 'extension.invalid' ||
    url.hostname.endsWith('.chromiumapp.org')
  );
}

/**
 * Validates the OAuth redirect before any network exchange. Rejects a foreign
 * host, a mismatched state, a missing/repeated code, and provider denials.
 */
export function parseCallback(callbackUrl: string, expectedState: string): { code: string } {
  let url: URL;
  try {
    url = new URL(callbackUrl);
  } catch {
    throw new Error('OAUTH_REDIRECT_INVALID');
  }
  if (!isExtensionCallbackUrl(url)) throw new Error('OAUTH_REDIRECT_INVALID');

  const state = url.searchParams.get('state');
  if (state !== expectedState) throw new Error('OAUTH_STATE_MISMATCH');
  if (url.searchParams.has('error')) throw new Error('OAUTH_DENIED');

  const codes = url.searchParams.getAll('code');
  if (codes.length !== 1 || !codes[0] || codes[0].trim() === '') {
    throw new Error('OAUTH_CODE_MISSING');
  }
  return { code: codes[0] };
}
