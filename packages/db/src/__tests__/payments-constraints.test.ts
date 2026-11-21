import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');
const migrationUrl = new URL('../../prisma/migrations/20261120000000_payments_entitlements/migration.sql', import.meta.url);
const migration = existsSync(migrationUrl) ? readFileSync(migrationUrl, 'utf8') : '';

describe('payment and entitlement persistence', () => {
  it('persists checkout price snapshots as INR paise and product versions', () => {
    expect(schema).toMatch(/model PaymentOrder\s*\{[\s\S]*?productVersionId\s+String[\s\S]*?amountPaise\s+BigInt[\s\S]*?currency\s+String[\s\S]*?priceVersion\s+Int/);
    expect(migration).toMatch(/"amountPaise" BIGINT NOT NULL/);
    expect(migration).toMatch(/"productVersionId" VARCHAR\(64\) NOT NULL/);
    expect(migration).toMatch(/"currency" VARCHAR\(3\) NOT NULL/);
    expect(migration).not.toMatch(/cardNumber|cvv/i);
  });

  it('enforces one purchase per provider payment and one entitlement per purchase', () => {
    expect(schema).toMatch(/model Purchase\s*\{[\s\S]*?providerPaymentId\s+String\s+@unique/);
    expect(schema).toMatch(/model Entitlement\s*\{[\s\S]*?purchaseId\s+String\s+@unique/);
    expect(migration).toMatch(/CREATE UNIQUE INDEX "Purchase_providerPaymentId_key"/);
    expect(migration).toMatch(/CREATE UNIQUE INDEX "Entitlement_purchaseId_key"/);
  });

  it('enforces globally unique provider event IDs for replay protection', () => {
    expect(schema).toMatch(/model PaymentEvent\s*\{[\s\S]*?providerEventId\s+String\s+@unique/);
    expect(migration).toMatch(/CREATE UNIQUE INDEX "PaymentEvent_providerEventId_key"/);
  });

  it('defines explicit order and entitlement state enums', () => {
    expect(schema).toMatch(/enum PaymentOrderStatus\s*\{\s*created\s+paid\s+failed\s+refunded\s+charged_back\s*\}/);
    expect(schema).toMatch(/enum EntitlementStatus\s*\{\s*active\s+revoked\s*\}/);
    expect(migration).toMatch(/CREATE TYPE "PaymentOrderStatus"/);
    expect(migration).toMatch(/CREATE TYPE "EntitlementStatus"/);
  });
});
