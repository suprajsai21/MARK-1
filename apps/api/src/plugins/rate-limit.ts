import type { FastifyInstance } from 'fastify';

type RateLimitOptions = {
  max: number;
  windowMs: number;
  /** Upper bound on tracked clients so a spray of distinct keys cannot exhaust memory. */
  maxKeys?: number;
};

type Bucket = { count: number; resetAt: number };

/**
 * Fixed-window counters keyed per client. Bounded and self-pruning so a hostile
 * client spraying unique keys cannot grow the map without limit. This is a
 * single-process limiter: a multi-instance deployment must also enforce limits
 * at its shared edge, because counters do not cross process boundaries.
 */
export class RateLimitBuckets {
  private readonly buckets = new Map<string, Bucket>();
  private readonly max: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;

  constructor(options: RateLimitOptions) {
    this.max = options.max;
    this.windowMs = options.windowMs;
    this.maxKeys = options.maxKeys ?? 10_000;
  }

  get size(): number {
    return this.buckets.size;
  }

  /** Records one request; returns false when the client is over its limit. */
  hit(key: string, now: number = Date.now()): boolean {
    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      this.prune(now);
      if (this.buckets.size >= this.maxKeys) {
        return false;
      }
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    existing.count += 1;
    return existing.count <= this.max;
  }

  private prune(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
  }
}

export function registerAuthRateLimits(app: FastifyInstance, options: RateLimitOptions): void {
  const limiter = new RateLimitBuckets(options);

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/v1/auth/')) {
      return;
    }
    const key = `${request.ip}:${request.url.split('?')[0]}`;
    if (!limiter.hit(key)) {
      reply.code(429).send({ code: 'RATE_LIMITED', message: 'Too many requests' });
    }
  });
}
