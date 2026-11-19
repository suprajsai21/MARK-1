import type { PriceSnapshot } from '@mark-1/contracts';

export type StoredPriceVersion = {
  id: string;
  productVersionId: string;
  amountPaise: bigint;
  currency: 'INR';
  version: number;
};

export interface PriceDatabase {
  setCurrentPrice(input: {
    productVersionId: string;
    amountPaise: bigint;
    actorId: string;
  }): Promise<StoredPriceVersion>;
  getCurrentPrice(productVersionId: string): Promise<StoredPriceVersion | null>;
}

export class PricingError extends Error {
  constructor(readonly code: 'INVALID_PRICE' | 'UNKNOWN_PRODUCT_VERSION') {
    super(code);
    this.name = 'PricingError';
  }
}

export class PricingService {
  constructor(
    private readonly options: {
      database: PriceDatabase;
      productVersionId: string;
    },
  ) {}

  async setCurrentPrice(input: {
    productVersionId: string;
    amountPaise: number;
    actorId: string;
  }): Promise<PriceSnapshot> {
    if (input.productVersionId !== this.options.productVersionId) {
      throw new PricingError('UNKNOWN_PRODUCT_VERSION');
    }
    if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) {
      throw new PricingError('INVALID_PRICE');
    }

    const stored = await this.options.database.setCurrentPrice({
      productVersionId: input.productVersionId,
      amountPaise: BigInt(input.amountPaise),
      actorId: input.actorId,
    });
    return this.toSnapshot(stored);
  }

  async getCurrentPrice(): Promise<PriceSnapshot | null> {
    const stored = await this.options.database.getCurrentPrice(this.options.productVersionId);
    return stored ? this.toSnapshot(stored) : null;
  }

  private toSnapshot(stored: StoredPriceVersion): PriceSnapshot {
    const amountPaise = Number(stored.amountPaise);
    if (!Number.isSafeInteger(amountPaise)) {
      throw new PricingError('INVALID_PRICE');
    }
    return {
      productVersionId: stored.productVersionId,
      amountPaise,
      currency: stored.currency,
      version: stored.version,
    };
  }
}
