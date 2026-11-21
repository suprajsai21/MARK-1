import { createPrismaClient, PrismaPaymentDatabase } from '@mark-1/db';
import { randomUUID } from 'node:crypto';

/**
 * Seeds the initial active pricing record (₹49.00 INR / 4,900 paise)
 * for productVersionId 'mark1-v1' if not already present.
 */
async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required to seed database.');
    process.exit(1);
  }

  const prisma = createPrismaClient(databaseUrl);
  const paymentDb = new PrismaPaymentDatabase(prisma as never);

  const productVersionId = 'mark1-v1';
  const initialAmountPaise = 4900n; // ₹49.00 INR

  const currentPrice = await paymentDb.getCurrentPrice(productVersionId);

  if (currentPrice) {
    console.log(`Current price already exists for ${productVersionId}:`, {
      amountPaise: currentPrice.amountPaise.toString(),
      currency: currentPrice.currency,
      version: currentPrice.version,
    });
  } else {
    // Generate a system bootstrap actor UUID if no admin user exists yet
    const systemActorId = randomUUID();
    const created = await paymentDb.setCurrentPrice({
      productVersionId,
      amountPaise: initialAmountPaise,
      actorId: systemActorId,
    });

    console.log(`Successfully seeded initial price for ${productVersionId}:`, {
      amountPaise: created.amountPaise.toString(),
      currency: created.currency,
      version: created.version,
    });
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Database seeding failed:', err);
  process.exit(1);
});
