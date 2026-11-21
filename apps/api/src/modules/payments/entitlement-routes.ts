import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthUser } from '@mark-1/contracts';

export type EntitlementView = { productVersionId: string; status: 'active' | 'revoked' };

export function registerEntitlementRoutes(app: FastifyInstance, options: {
  authenticate: (request: FastifyRequest) => Promise<AuthUser | null>;
  getForUser: (userId: string, productVersionId: string) => Promise<EntitlementView[]>;
}): void {
  app.get('/v1/entitlement', async (request, reply) => {
    const actor = await options.authenticate(request);
    if (!actor) return reply.code(401).send({ code: 'UNAUTHENTICATED', message: 'Unauthenticated' });
    const productVersionId = typeof request.query === 'object' && request.query !== null && 'productVersionId' in request.query && typeof request.query.productVersionId === 'string' ? request.query.productVersionId : '';
    if (!productVersionId) return reply.code(400).send({ code: 'INVALID_REQUEST', message: 'productVersionId is required' });
    const entitlements = await options.getForUser(actor.id, productVersionId);
    return reply.send({ entitlements });
  });
}
