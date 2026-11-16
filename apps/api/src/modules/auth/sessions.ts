import { createHash, randomBytes } from 'node:crypto';

export function newOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function buildSessionCookie(
  value: string,
  options: { secure?: boolean; maxAgeSeconds?: number } = {},
): string {
  const secure = options.secure ?? true;
  const maxAgeSeconds = options.maxAgeSeconds ?? 60 * 60 * 24 * 7;
  return `mark1_session=${value}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}; Max-Age=${maxAgeSeconds}`;
}

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
