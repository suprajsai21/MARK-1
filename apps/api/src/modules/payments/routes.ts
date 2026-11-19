import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthUser } from '@mark-1/contracts';
import { CheckoutError, CheckoutService } from './service.js';
import { sessionTokenFromRequest } from '../../plugins/auth.js';
import { requestOrigin } from '../../plugins/validation.js';

export function registerCheckoutRoutes(
  app: FastifyInstance,
  options: {
    checkout: CheckoutService;
    authenticate: (request: FastifyRequest) => Promise<AuthUser | null>;
    allowedOrigin: string;
  },
): void {
  const sendCheckoutError = (error: unknown, reply: FastifyReply) => {
    if (error instanceof CheckoutError) {
      const status = error.code === 'UNAUTHENTICATED' ? 401
        : error.code === 'EMAIL_NOT_VERIFIED' || error.code === 'LINKED_ACCOUNT_REQUIRED' ? 403
          : error.code === 'PRICE_NOT_CONFIGURED' ? 503 : 400;
      return reply.code(status).send({
        code: error.code,
        message: error.code.replaceAll('_', ' ').toLowerCase(),
      });
    }
    return reply.code(502).send({ code: 'PAYMENT_PROVIDER_UNAVAILABLE', message: 'Payment provider unavailable' });
  };

  app.post('/v1/checkout/orders', async (request, reply) => {
    const actor = await options.authenticate(request);
    if (!actor) return reply.code(401).send({ code: 'UNAUTHENTICATED', message: 'Unauthenticated' });
    if (!options.allowedOrigin || requestOrigin(request) !== options.allowedOrigin) {
      return reply.code(403).send({ code: 'ORIGIN_FORBIDDEN', message: 'Origin forbidden' });
    }
    if (typeof request.body !== 'object' || request.body === null || Array.isArray(request.body)
      || Object.keys(request.body).length !== 0) {
      return reply.code(400).send({ code: 'INVALID_INPUT', message: 'Invalid input' });
    }
    try {
      const order = await options.checkout.createOrder({ actor });
      return reply.code(201).send({ ...order, amountPaise: order.amountPaise.toString() });
    } catch (error) {
      return sendCheckoutError(error, reply);
    }
  });

  app.get<{ Params: { orderId: string } }>('/v1/checkout/orders/:orderId', async (request, reply) => {
    const actor = await options.authenticate(request);
    if (!actor) return reply.code(401).send({ code: 'UNAUTHENTICATED', message: 'Unauthenticated' });
    try {
      const order = await options.checkout.getOrder({ actor, orderId: request.params.orderId });
      if (!order) return reply.code(404).send({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
      return reply.send({ ...order, amountPaise: order.amountPaise.toString() });
    } catch (error) {
      return sendCheckoutError(error, reply);
    }
  });
}

export function checkoutAuthenticator(authenticate: (token: string) => Promise<AuthUser | null>) {
  return async (request: FastifyRequest): Promise<AuthUser | null> => {
    const token = sessionTokenFromRequest(request);
    return token ? authenticate(token) : null;
  };
}
