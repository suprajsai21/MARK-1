import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { CompleteLinkInputSchema, CreateLinkChallengeInputSchema, UnlinkLinkInputSchema } from '@mark-1/contracts';
import type { AuthUser } from '@mark-1/contracts';
import type { AuthService } from '../auth/service.js';
import { sessionTokenFromRequest } from '../../plugins/auth.js';
import { formatError, requestOrigin } from '../../plugins/validation.js';
import { LinkError, LinkService } from './service.js';

export function registerLinkRoutes(
  app: FastifyInstance,
  options: { links: LinkService; auth: AuthService; allowedOrigin: string },
): void {
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
  const handleError = (error: unknown, reply: FastifyReply) => {
    if (error instanceof LinkError) {
      const status = error.code === 'UNAUTHENTICATED' ? 401 :
        error.code === 'VERIFIER_UNAVAILABLE' ? 503 :
          error.code === 'SUBJECT_SECRET_REQUIRED' ? 503 :
          error.code === 'LINK_CONFLICT' ? 409 :
            error.code === 'CHALLENGE_INVALID' || error.code === 'VERIFICATION_FAILED' ? 400 :
              error.code === 'RELINK_COOLDOWN' ? 429 :
                error.code === 'REVERIFICATION_REQUIRED' ? 403 : 400;
      reply.code(status).send({ code: error.code, message: error.code.replaceAll('_', ' ').toLowerCase() });
      return;
    }
    formatError(error, reply);
  };

  app.post('/v1/links/challenges', async (request, reply) => {
    if (!originGuard(request, reply)) return;
    try {
      const input = CreateLinkChallengeInputSchema.parse(request.body);
      const actor = await actorFor(request);
      return reply.code(201).send(await options.links.createChallenge({ actor, integrationId: input.integrationId }));
    } catch (error) {
      handleError(error, reply);
    }
  });

  app.post('/v1/links/complete', async (request, reply) => {
    if (!originGuard(request, reply)) return;
    try {
      const input = CompleteLinkInputSchema.parse(request.body);
      const actor = await actorFor(request);
      return reply.send(await options.links.complete({ actor, ...input }));
    } catch (error) {
      handleError(error, reply);
    }
  });

  app.get('/v1/links', async (request, reply) => {
    try {
      const actor = await actorFor(request);
      return reply.send({ links: await options.links.list(actor) });
    } catch (error) {
      handleError(error, reply);
    }
  });

  app.delete('/v1/links/:linkId', async (request, reply) => {
    if (!originGuard(request, reply)) return;
    try {
      const actor = await actorFor(request);
      const params = request.params as { linkId: string };
      const body = request.body;
      const parsed = UnlinkLinkInputSchema.safeParse(body);
      if (typeof params.linkId !== 'string' || !parsed.success) {
        return reply.code(400).send({ code: 'REVERIFICATION_REQUIRED', message: 'Re-verification required' });
      }
      return reply.send(await options.links.unlink({ actor, linkId: params.linkId, ...parsed.data }));
    } catch (error) {
      handleError(error, reply);
    }
  });
}
