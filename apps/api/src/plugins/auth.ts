import type { FastifyRequest } from 'fastify';
import type { AuthService } from '../modules/auth/service.js';

export function sessionTokenFromRequest(request: FastifyRequest): string | null {
  const cookie = request.headers.cookie;
  if (!cookie) {
    return null;
  }
  const match = /(?:^|;\s*)mark1_session=([^;]+)/.exec(cookie);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export async function authenticatedUser(request: FastifyRequest, auth: AuthService) {
  const token = sessionTokenFromRequest(request);
  return token ? auth.authenticateSession(token) : null;
}
