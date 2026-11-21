import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  CompleteMailOAuthInputSchema,
  DisconnectMailAccountInputSchema,
  InitiateMailOAuthInputSchema,
  ReconnectMailAccountInputSchema,
  UpdateMailAccountSettingsInputSchema,
} from '@mark-1/contracts';
import type { AuthUser } from '@mark-1/contracts';
import type { AuthService } from '../auth/service.js';
import { sessionTokenFromRequest } from '../../plugins/auth.js';
import { RateLimitBuckets } from '../../plugins/rate-limit.js';
import { formatError, requestOrigin } from '../../plugins/validation.js';
import { MailError, MailService } from './service.js';

export function registerMailRoutes(
  app: FastifyInstance,
  options: {
    mail: MailService;
    auth: AuthService;
    allowedOrigin: string;
    rateLimit?: { max: number; windowMs: number };
  },
): void {
  const limiter = new RateLimitBuckets(
    options.rateLimit ?? { max: 30, windowMs: 60_000 },
  );

  const actorFor = async (request: FastifyRequest): Promise<AuthUser | null> => {
    const token = sessionTokenFromRequest(request);
    return token ? options.auth.authenticateSession(token) : null;
  };

  const originGuard = (request: FastifyRequest, reply: FastifyReply): boolean => {
    if (!options.allowedOrigin || requestOrigin(request) !== options.allowedOrigin) {
      reply.code(403).send({ code: 'ORIGIN_FORBIDDEN', message: 'Origin forbidden' });
      return false;
    }
    return true;
  };

  const checkRateLimit = (key: string, reply: FastifyReply): boolean => {
    if (!limiter.hit(key)) {
      reply.code(429).send({ code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' });
      return false;
    }
    return true;
  };

  const handleError = (error: unknown, reply: FastifyReply) => {
    if (error instanceof MailError) {
      const status =
        error.code === 'UNAUTHENTICATED'
          ? 401
          : error.code === 'ACCOUNT_NOT_FOUND'
            ? 404
            : error.code === 'ACCOUNT_FORBIDDEN'
              ? 403
              : error.code === 'ACCOUNT_ALREADY_CONNECTED'
                ? 409
                : error.code === 'TOKEN_EXCHANGE_FAILED'
                  ? 502
                  : 400;

      reply.code(status).send({
        code: error.code,
        message: error.message,
      });
      return;
    }

    formatError(error, reply);
  };

  // GET /v1/mail/overview
  app.get('/v1/mail/overview', async (request, reply) => {
    try {
      const actor = await actorFor(request);
      const overview = await options.mail.getOverview(actor);
      return reply.send(overview);
    } catch (error) {
      handleError(error, reply);
    }
  });

  // GET /v1/mail/accounts
  app.get('/v1/mail/accounts', async (request, reply) => {
    try {
      const actor = await actorFor(request);
      const accounts = await options.mail.listAccounts(actor);
      return reply.send({ accounts });
    } catch (error) {
      handleError(error, reply);
    }
  });

  // POST /v1/mail/accounts/connect/start
  app.post('/v1/mail/accounts/connect/start', async (request, reply) => {
    if (!originGuard(request, reply)) return;
    try {
      const actor = await actorFor(request);
      if (!actor) {
        return reply.code(401).send({ code: 'UNAUTHENTICATED', message: 'Authentication required' });
      }

      const clientIp = request.ip || 'ip';
      if (!checkRateLimit(`connect:${actor.id}:${clientIp}`, reply)) return;

      const body = InitiateMailOAuthInputSchema.safeParse(request.body ?? {});
      const redirectUrl = body.success ? body.data.redirectUrl : undefined;

      const result = await options.mail.initiateConnect(actor, redirectUrl);
      return reply.code(201).send(result);
    } catch (error) {
      handleError(error, reply);
    }
  });

  // POST /v1/mail/accounts/connect/callback
  app.post('/v1/mail/accounts/connect/callback', async (request, reply) => {
    if (!originGuard(request, reply)) return;
    try {
      const actor = await actorFor(request);
      if (!actor) {
        return reply.code(401).send({ code: 'UNAUTHENTICATED', message: 'Authentication required' });
      }

      const clientIp = request.ip || 'ip';
      if (!checkRateLimit(`callback:${actor.id}:${clientIp}`, reply)) return;

      const input = CompleteMailOAuthInputSchema.parse(request.body);
      const account = await options.mail.completeCallback(actor, input);
      return reply.send({ account });
    } catch (error) {
      handleError(error, reply);
    }
  });

  // GET /v1/mail/accounts/:accountId
  app.get('/v1/mail/accounts/:accountId', async (request, reply) => {
    try {
      const actor = await actorFor(request);
      const params = request.params as { accountId: string };
      const account = await options.mail.getAccount(actor, params.accountId);
      return reply.send({ account });
    } catch (error) {
      handleError(error, reply);
    }
  });

  // GET /v1/mail/accounts/:accountId/health
  app.get('/v1/mail/accounts/:accountId/health', async (request, reply) => {
    try {
      const actor = await actorFor(request);
      if (!actor) {
        return reply.code(401).send({ code: 'UNAUTHENTICATED', message: 'Authentication required' });
      }

      const params = request.params as { accountId: string };
      if (!checkRateLimit(`health:${actor.id}:${params.accountId}`, reply)) return;

      const health = await options.mail.checkAccountHealth(actor, params.accountId);
      return reply.send(health);
    } catch (error) {
      handleError(error, reply);
    }
  });

  // POST /v1/mail/accounts/:accountId/reconnect/start
  app.post('/v1/mail/accounts/:accountId/reconnect/start', async (request, reply) => {
    if (!originGuard(request, reply)) return;
    try {
      const actor = await actorFor(request);
      if (!actor) {
        return reply.code(401).send({ code: 'UNAUTHENTICATED', message: 'Authentication required' });
      }

      const params = request.params as { accountId: string };
      if (!checkRateLimit(`reconnect:${actor.id}:${params.accountId}`, reply)) return;

      const body = ReconnectMailAccountInputSchema.safeParse(request.body ?? {});
      const redirectUrl = body.success ? body.data.redirectUrl : undefined;

      const result = await options.mail.initiateConnect(actor, redirectUrl, params.accountId);
      return reply.code(201).send(result);
    } catch (error) {
      handleError(error, reply);
    }
  });

  // POST /v1/mail/accounts/:accountId/disconnect
  app.post('/v1/mail/accounts/:accountId/disconnect', async (request, reply) => {
    if (!originGuard(request, reply)) return;
    try {
      const actor = await actorFor(request);
      if (!actor) {
        return reply.code(401).send({ code: 'UNAUTHENTICATED', message: 'Authentication required' });
      }

      const params = request.params as { accountId: string };
      if (!checkRateLimit(`disconnect:${actor.id}:${params.accountId}`, reply)) return;

      const body = DisconnectMailAccountInputSchema.safeParse(request.body ?? {});
      const result = await options.mail.disconnectAccount(
        actor,
        params.accountId,
        body.success ? body.data : undefined,
      );
      return reply.send(result);
    } catch (error) {
      handleError(error, reply);
    }
  });

  // PATCH /v1/mail/accounts/:accountId/settings
  app.patch('/v1/mail/accounts/:accountId/settings', async (request, reply) => {
    if (!originGuard(request, reply)) return;
    try {
      const actor = await actorFor(request);
      if (!actor) {
        return reply.code(401).send({ code: 'UNAUTHENTICATED', message: 'Authentication required' });
      }

      const params = request.params as { accountId: string };
      const input = UpdateMailAccountSettingsInputSchema.parse(request.body);
      const settings = await options.mail.updateSettings(actor, params.accountId, input);
      return reply.send({ settings });
    } catch (error) {
      handleError(error, reply);
    }
  });

  // GET /v1/mail/settings
  app.get('/v1/mail/settings', async (request, reply) => {
    try {
      const actor = await actorFor(request);
      const settings = await options.mail.getMailSettings(actor);
      return reply.send({ settings });
    } catch (error) {
      handleError(error, reply);
    }
  });
}
