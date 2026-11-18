import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  OAuthAuthorizationInputSchema,
  OAuthAuthorizeQuerySchema,
  OAuthRevokeInputSchema,
  OAuthTokenInputSchema,
} from '@mark-1/contracts';
import type { AuthUser } from '@mark-1/contracts';
import { sessionTokenFromRequest } from '../../plugins/auth.js';
import { formatError, requestOrigin } from '../../plugins/validation.js';
import { RateLimitBuckets } from '../../plugins/rate-limit.js';
import { OAuthError, OAuthService } from './service.js';

export function registerOAuthRoutes(app: FastifyInstance, options: {
  oauth: OAuthService;
  allowedOrigin: string;
  authenticate: (request: FastifyRequest) => Promise<AuthUser | null>;
  rateLimit?: { max: number; windowMs: number };
}): void {
  const limits = new RateLimitBuckets(options.rateLimit ?? { max: 30, windowMs: 60_000 });
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/v1/oauth/')) return;
    const key = `${request.ip}:${request.url.split('?')[0]}`;
    if (!limits.hit(key)) reply.code(429).send({ code: 'RATE_LIMITED', message: 'Too many requests' });
  });

  const guardOrigin = (request: FastifyRequest, reply: FastifyReply): boolean => {
    if (!options.allowedOrigin || requestOrigin(request) !== options.allowedOrigin) {
      reply.code(403).send({ code: 'ORIGIN_FORBIDDEN', message: 'Origin forbidden' });
      return false;
    }
    return true;
  };
  const handleError = (error: unknown, reply: FastifyReply): void => {
    if (error instanceof OAuthError) {
      const status = error.code === 'INVALID_CLIENT' || error.code === 'INVALID_REDIRECT_URI' || error.code === 'INVALID_REQUEST' ? 400
        : error.code === 'UNAUTHENTICATED' ? 401
          : error.code === 'FORBIDDEN' ? 403
            : error.code === 'INVALID_GRANT' || error.code === 'CONSENT_REQUIRED' ? 400 : 500;
      reply.code(status).send({ code: error.code, message: status < 500 ? error.code.replaceAll('_', ' ').toLowerCase() : 'Request failed' });
      return;
    }
    formatError(error, reply);
  };

  app.get('/v1/oauth/authorize', async (request, reply) => {
    try {
      const query = OAuthAuthorizeQuerySchema.parse(request.query);
      // Validate before any redirect is constructed; an invalid URI is never reflected.
      options.oauth.validateAuthorizationRequest({ clientId: query.client_id, redirectUri: query.redirect_uri });
      return reply.send({ clientId: query.client_id, redirectUri: query.redirect_uri, consentRequired: true });
    } catch (error) {
      handleError(error, reply);
    }
  });

  app.post('/v1/oauth/authorize', async (request, reply) => {
    if (!guardOrigin(request, reply)) return;
    try {
      const input = OAuthAuthorizationInputSchema.parse(request.body);
      const user = await options.authenticate(request);
      if (!user) throw new OAuthError('UNAUTHENTICATED');
      if (!user.emailVerified || user.role !== 'customer') throw new OAuthError('FORBIDDEN');
      return reply.send(await options.oauth.createAuthorizationCode({
        userId: user.id,
        clientId: input.clientId,
        redirectUri: input.redirectUri,
        codeChallenge: input.codeChallenge,
        consented: true,
        ...(input.state === undefined ? {} : { state: input.state }),
      }));
    } catch (error) {
      handleError(error, reply);
    }
  });

  // The token and revocation endpoints carry no ambient cookie authority: the
  // caller proves possession of the code, PKCE verifier, refresh token, or
  // token itself. Requiring the portal Origin here would break extension
  // clients (their Origin is the extension's own scheme), so the CSRF guard
  // stays on the cookie-authenticated consent POST above.
  app.post('/v1/oauth/token', async (request, reply) => {
    try {
      const input = OAuthTokenInputSchema.parse(request.body);
      if (input.grantType === 'authorization_code') {
        return reply.send(await options.oauth.exchange({
          code: input.code,
          clientId: input.clientId,
          redirectUri: input.redirectUri,
          codeVerifier: input.codeVerifier,
        }));
      }
      return reply.send(await options.oauth.exchangeRefresh({
        refreshToken: input.refreshToken,
        clientId: input.clientId,
      }));
    } catch (error) {
      handleError(error, reply);
    }
  });

  app.post('/v1/oauth/revoke', async (request, reply) => {
    try {
      const input = OAuthRevokeInputSchema.parse(request.body);
      return reply.send(await options.oauth.revoke(input));
    } catch (error) {
      handleError(error, reply);
    }
  });
}

/** Utility for callers that authenticate the portal cookie before OAuth POST. */
export function cookieAuthenticator(authenticateSession: (token: string) => Promise<AuthUser | null>) {
  return async (request: FastifyRequest): Promise<AuthUser | null> => {
    const token = sessionTokenFromRequest(request);
    return token ? authenticateSession(token) : null;
  };
}
