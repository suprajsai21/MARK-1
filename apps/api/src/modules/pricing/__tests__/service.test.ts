import { describe, expect, it } from 'vitest';
import { PricingService } from '../service.js';

class MemoryPricingDatabase {
  current: { id: string; productVersionId: string; amountPaise: bigint; currency: 'INR'; version: number } | null = null;
  async setCurrentPrice(input: { productVersionId: string; amountPaise: bigint; actorId: string }) {
    this.current = {
      id: `price-${((this.current?.version ?? 0) + 1)}`,
      productVersionId: input.productVersionId,
      amountPaise: input.amountPaise,
      currency: 'INR',
      version: (this.current?.version ?? 0) + 1,
    };
    return this.current;
  }
  async getCurrentPrice(productVersionId: string) {
    return this.current?.productVersionId === productVersionId ? this.current : null;
  }
}

describe('PricingService', () => {
  it('rejects amounts that are not positive safe-integer paise', async () => {
    const service = new PricingService({ database: new MemoryPricingDatabase(), productVersionId: 'mark1-v1' });
    for (const amountPaise of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN]) {
      await expect(service.setCurrentPrice({ productVersionId: 'mark1-v1', amountPaise, actorId: 'admin-1' }))
        .rejects.toMatchObject({ code: 'INVALID_PRICE' });
    }
  });

  it('appends a new immutable version for each admin price change', async () => {
    const service = new PricingService({ database: new MemoryPricingDatabase(), productVersionId: 'mark1-v1' });
    const first = await service.setCurrentPrice({ productVersionId: 'mark1-v1', amountPaise: 12500, actorId: 'admin-1' });
    const second = await service.setCurrentPrice({ productVersionId: 'mark1-v1', amountPaise: 15000, actorId: 'admin-1' });
    expect(first).toEqual({ productVersionId: 'mark1-v1', amountPaise: 12500, currency: 'INR', version: 1 });
    expect(second).toEqual({ productVersionId: 'mark1-v1', amountPaise: 15000, currency: 'INR', version: 2 });
    expect(await service.getCurrentPrice()).toEqual(second);
  });

  it('refuses to sell a product version other than the configured one', async () => {
    const service = new PricingService({ database: new MemoryPricingDatabase(), productVersionId: 'mark1-v1' });
    await expect(service.setCurrentPrice({ productVersionId: 'other-v9', amountPaise: 100, actorId: 'admin-1' }))
      .rejects.toMatchObject({ code: 'UNKNOWN_PRODUCT_VERSION' });
  });
});
