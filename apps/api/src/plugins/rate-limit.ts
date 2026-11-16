import type { FastifyInstance } from 'fastify';

export function registerAuthRateLimits(
  app: FastifyInstance,
  options: { max: number; windowMs: number },
): void {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/v1/auth/')) {
      return;
    }
    const key = `${request.ip}:${request.url.split('?')[0]}`;
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      return;
    }

    bucket.count += 1;
    if (bucket.count > options.max) {
      reply.code(429).send({ code: 'RATE_LIMITED', message: 'Too many requests' });
    }
  });
}
