import { describe, expect, it } from 'vitest';
import { PriceSnapshotSchema } from '../payments.js';

describe('PriceSnapshot', () => {
  it('accepts only positive safe integer paise amounts in INR', () => {
    expect(PriceSnapshotSchema.parse({
      productVersionId: 'mark1-v1', amountPaise: 100, currency: 'INR', version: 1,
    })).toEqual({ productVersionId: 'mark1-v1', amountPaise: 100, currency: 'INR', version: 1 });
    for (const amountPaise of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN]) {
      expect(PriceSnapshotSchema.safeParse({
        productVersionId: 'mark1-v1', amountPaise, currency: 'INR', version: 1,
      }).success).toBe(false);
    }
    expect(PriceSnapshotSchema.safeParse({
      productVersionId: 'mark1-v1', amountPaise: 100, currency: 'USD', version: 1,
    }).success).toBe(false);
  });

  it('rejects unknown fields so checkout cannot smuggle card data', () => {
    expect(PriceSnapshotSchema.safeParse({
      productVersionId: 'mark1-v1', amountPaise: 100, currency: 'INR', version: 1, cardNumber: '4111111111111111',
    }).success).toBe(false);
  });
});
