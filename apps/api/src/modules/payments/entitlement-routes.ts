import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthUser } from '@mark-1/contracts';

export type EntitlementView = { productVersionId: string; status: 'active' | 'revoked' };

export function registerEntitlementRoutes(app: FastifyInstance, options: {
  authenticate: (request: FastifyRequest) => Promise<AuthUser | null>;
  getForUser: (userId: string) => Promise<EntitlementView[]>;
}): void {
  app.get('/v1/entitlement', async (request, reply) => {
    const actor = await options.authenticate(request);
    if (!actor) return reply.code(401).send({ code: 'UNAUTHENTICATED', message: 'Unauthenticated' });
    const entitlements = await options.getForUser(actor.id);
    return reply.send({ entitlements });
  });
}
