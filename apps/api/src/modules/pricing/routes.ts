import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthUser } from '@mark-1/contracts';
import { PriceSnapshotSchema } from '@mark-1/contracts';
import { authorizeAdmin } from '../admin/authorization.js';
import { sessionTokenFromRequest } from '../../plugins/auth.js';
import { requestOrigin } from '../../plugins/validation.js';
import { PricingError, PricingService } from './service.js';

export function registerPricingRoutes(
  app: FastifyInstance,
  options: {
    pricing: PricingService;
    authenticate: (request: FastifyRequest) => Promise<AuthUser | null>;
    allowedOrigin: string;
  },
): void {
  const admin = async (request: FastifyRequest, reply: FastifyReply): Promise<AuthUser | null> => {
    try {
      return authorizeAdmin(await options.authenticate(request));
    } catch (error) {
      const code = (error as { code?: string }).code ?? 'ADMIN_REQUIRED';
      reply.code(code === 'UNAUTHENTICATED' ? 401 : 403).send({ code, message: code.replaceAll('_', ' ').toLowerCase() });
      return null;
    }
  };
  const originAllowed = (request: FastifyRequest) =>
    Boolean(options.allowedOrigin) && requestOrigin(request) === options.allowedOrigin;
  const handleError = (error: unknown, reply: FastifyReply) => {
    if (error instanceof PricingError) {
      reply.code(error.code === 'INVALID_PRICE' ? 400 : 404)
        .send({ code: error.code, message: error.code.replaceAll('_', ' ').toLowerCase() });
      return;
    }
    reply.code(400).send({ code: 'INVALID_INPUT', message: 'Invalid input' });
  };

  app.get('/v1/pricing/current', async (_request, reply) => {
    const price = await options.pricing.getCurrentPrice();
    return reply.send({ price });
  });

  app.put('/v1/admin/pricing/current', async (request, reply) => {
    const actor = await admin(request, reply);
    if (!actor) return;
    if (!originAllowed(request)) {
      return reply.code(403).send({ code: 'ORIGIN_FORBIDDEN', message: 'Origin forbidden' });
    }
    const body = request.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return reply.code(400).send({ code: 'INVALID_INPUT', message: 'Invalid input' });
    }
    const record = body as Record<string, unknown>;
    if (Object.keys(record).length !== 2 || typeof record.productVersionId !== 'string' || typeof record.amountPaise !== 'number') {
      return reply.code(400).send({ code: 'INVALID_INPUT', message: 'Invalid input' });
    }
    try {
      const price = await options.pricing.setCurrentPrice({
        productVersionId: record.productVersionId,
        amountPaise: record.amountPaise,
        actorId: actor.id,
      });
      return reply.send(PriceSnapshotSchema.parse(price));
    } catch (error) {
      handleError(error, reply);
    }
  });
}

export function pricingAuthenticator(authenticate: (token: string) => Promise<AuthUser | null>) {
  return async (request: FastifyRequest): Promise<AuthUser | null> => {
    const token = sessionTokenFromRequest(request);
    return token ? authenticate(token) : null;
  };
}
