import type { FastifyInstance, FastifyRequest } from 'fastify';

export type WebhookProcessor = (input: { rawBody: Buffer; signature: string }) => Promise<unknown>;

export function registerWebhookRoutes(app: FastifyInstance, options: {
  secret: string;
  process: WebhookProcessor;
}): void {
  app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => {
      done(null, body);
    });
    scope.post('/v1/webhooks/razorpay', async (request: FastifyRequest, reply) => {
      if (!options.secret) return reply.code(503).send({ code: 'WEBHOOK_NOT_CONFIGURED' });
      if (!Buffer.isBuffer(request.body)) return reply.code(400).send({ code: 'INVALID_WEBHOOK_PAYLOAD' });
      const signatureHeader = request.headers['x-razorpay-signature'];
      const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
      if (!signature) return reply.code(400).send({ code: 'INVALID_WEBHOOK_SIGNATURE' });
      try {
        const result = await options.process({ rawBody: request.body, signature });
        return reply.send(result);
      } catch (error) {
        const code = error instanceof Error ? error.message : '';
        const clientError = ['INVALID_WEBHOOK_SIGNATURE', 'INVALID_WEBHOOK_PAYLOAD', 'UNSUPPORTED_WEBHOOK_EVENT'].includes(code);
        return reply.code(clientError ? 400 : 500).send({ code: clientError ? code : 'WEBHOOK_PROCESSING_FAILED' });
      }
    });
  });
}
