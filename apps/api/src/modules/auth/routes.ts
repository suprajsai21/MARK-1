import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { LoginInputSchema, RegisterInputSchema } from '@mark-1/contracts';
import type { AuthService } from './service.js';
import { sessionTokenFromRequest } from '../../plugins/auth.js';
import { formatError, parseBody, requestOrigin } from '../../plugins/validation.js';
import { registerAuthRateLimits } from '../../plugins/rate-limit.js';
import { buildSessionCookie } from './sessions.js';

const verificationSchema = {
  parse(value: unknown): { token: string } {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('Invalid request');
    }
    const record = value as Record<string, unknown>;
    if (
      Object.keys(record).length !== 1 ||
      typeof record.token !== 'string' ||
      record.token.length < 1 ||
      record.token.length > 512
    ) {
      throw new Error('Invalid request');
    }
    return { token: record.token };
  },
};

const emailSchema = {
  parse(value: unknown): { email: string } {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('Invalid request');
    }
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length !== 1 || typeof record.email !== 'string') {
      throw new Error('Invalid request');
    }
    const email = record.email.trim().toLowerCase();
    if (email.length < 3 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('Invalid request');
    }
    return { email };
  },
};

const resetSchema = {
  parse(value: unknown): { token: string; newPassword: string } {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('Invalid request');
    }
    const record = value as Record<string, unknown>;
    if (
      Object.keys(record).length !== 2 ||
      typeof record.token !== 'string' ||
      record.token.length < 1 ||
      record.token.length > 512 ||
      typeof record.newPassword !== 'string' ||
      record.newPassword.length < 12 ||
      record.newPassword.length > 128
    ) {
      throw new Error('Invalid request');
    }
    return { token: record.token, newPassword: record.newPassword };
  },
};

export function registerAuthRoutes(
  app: FastifyInstance,
  options: {
    auth: AuthService;
    allowedOrigin: string;
    rateLimit?: { max: number; windowMs: number };
  },
): void {
  registerAuthRateLimits(app, options.rateLimit ?? { max: 30, windowMs: 60_000 });

  const originGuard = (request: FastifyRequest, reply: FastifyReply): boolean => {
    if (!options.allowedOrigin || requestOrigin(request) !== options.allowedOrigin) {
      reply.code(403).send({ code: 'ORIGIN_FORBIDDEN', message: 'Origin forbidden' });
      return false;
    }
    return true;
  };

  const handleError = (error: unknown, reply: FastifyReply) => formatError(error, reply);

  app.post('/v1/auth/register', async (request, reply) => {
    if (!originGuard(request, reply)) return;
    try {
      const input = parseBody(RegisterInputSchema, request.body);
      const result = await options.auth.register(input);
      return reply.code(201).send(result);
    } catch (error) {
      handleError(error, reply);
    }
  });

  app.post('/v1/auth/login', async (request, reply) => {
    if (!originGuard(request, reply)) return;
    try {
      const input = parseBody(LoginInputSchema, request.body);
      const result = await options.auth.login(input);
      const token = /mark1_session=([^;]+)/.exec(result.sessionCookie)?.[1];
      if (token) {
        reply.header('set-cookie', buildSessionCookie(token));
      }
      return reply.send({ user: result.user });
    } catch (error) {
      handleError(error, reply);
    }
  });

  app.post('/v1/auth/verify-email', async (request, reply) => {
    if (!originGuard(request, reply)) return;
    try {
      const input = parseBody(verificationSchema, request.body);
      return reply.send(await options.auth.verifyEmail(input));
    } catch (error) {
      handleError(error, reply);
    }
  });

  app.post('/v1/auth/verify-email/resend', async (request, reply) => {
    if (!originGuard(request, reply)) return;
    try {
      const input = parseBody(emailSchema, request.body);
      return reply.send(await options.auth.resendVerification(input.email));
    } catch (error) {
      handleError(error, reply);
    }
  });

  app.post('/v1/auth/password/reset/request', async (request, reply) => {
    if (!originGuard(request, reply)) return;
    try {
      const input = parseBody(emailSchema, request.body);
      return reply.send(await options.auth.requestPasswordReset({ email: input.email }));
    } catch (error) {
      handleError(error, reply);
    }
  });

  app.post('/v1/auth/password/reset/complete', async (request, reply) => {
    if (!originGuard(request, reply)) return;
    try {
      const input = parseBody(resetSchema, request.body);
      return reply.send(await options.auth.resetPassword(input));
    } catch (error) {
      handleError(error, reply);
    }
  });

  app.post('/v1/auth/logout', async (request, reply) => {
    if (!originGuard(request, reply)) return;
    const token = sessionTokenFromRequest(request);
    if (token) {
      await options.auth.logout(token);
    }
    reply.header('set-cookie', buildSessionCookie('', { maxAgeSeconds: 0 }));
    return reply.send({ loggedOut: true });
  });

  app.get('/v1/me', async (request, reply) => {
    const token = sessionTokenFromRequest(request);
    const user = token ? await options.auth.authenticateSession(token) : null;
    if (!user || !user.emailVerified) {
      return reply.code(401).send({ code: 'UNAUTHENTICATED', message: 'Sign in required' });
    }
    return reply.send({ user });
  });
}
