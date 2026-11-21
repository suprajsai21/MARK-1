import type { FastifyInstance } from 'fastify';

export function registerHealthRoutes(app: FastifyInstance, options: {
  checkDatabase: () => Promise<void>;
  checkRequiredDependencies?: () => Promise<void>;
}): void {
  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (_request, reply) => {
    try {
      await options.checkDatabase();
      await options.checkRequiredDependencies?.();
      return { status: 'ready' };
    } catch {
      return reply.code(503).send({ status: 'not_ready' });
    }
  });
}
