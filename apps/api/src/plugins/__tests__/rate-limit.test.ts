import { describe, expect, it } from 'vitest';
import { RateLimitBuckets } from '../rate-limit.js';

describe('auth rate limit buckets', () => {
  it('allows requests up to the configured maximum, then rejects', () => {
    const buckets = new RateLimitBuckets({ max: 2, windowMs: 1_000, maxKeys: 10 });
    expect(buckets.hit('client-a', 0)).toBe(true);
    expect(buckets.hit('client-a', 10)).toBe(true);
    expect(buckets.hit('client-a', 20)).toBe(false);
  });

  it('allows the client again once the window elapses', () => {
    const buckets = new RateLimitBuckets({ max: 1, windowMs: 1_000, maxKeys: 10 });
    expect(buckets.hit('client-a', 0)).toBe(true);
    expect(buckets.hit('client-a', 999)).toBe(false);
    expect(buckets.hit('client-a', 1_000)).toBe(true);
  });

  it('keeps distinct clients independent', () => {
    const buckets = new RateLimitBuckets({ max: 1, windowMs: 1_000, maxKeys: 10 });
    expect(buckets.hit('client-a', 0)).toBe(true);
    expect(buckets.hit('client-b', 0)).toBe(true);
    expect(buckets.hit('client-a', 1)).toBe(false);
  });

  it('prunes expired buckets instead of growing without bound', () => {
    const buckets = new RateLimitBuckets({ max: 1, windowMs: 1_000, maxKeys: 2 });
    for (const key of ['a', 'b', 'c', 'd']) {
      buckets.hit(key, 0);
    }
    expect(buckets.size).toBeLessThanOrEqual(2);

    buckets.hit('fresh', 5_000);
    expect(buckets.size).toBe(1);
  });
});
