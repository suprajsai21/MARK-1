import { createPrismaClient } from '../packages/db/dist/client.js';
import crypto from 'node:crypto';

const PARAMETERS = { memory: 65536, passes: 3, parallelism: 4, tagLength: 32 };

function derive(password, nonce) {
  return new Promise((resolve, reject) => {
    const argon2Fn = crypto.argon2;
    if (typeof argon2Fn === 'function') {
      argon2Fn('argon2id', { ...PARAMETERS, message: password, nonce }, (error, derived) => {
        if (error) reject(error);
        else resolve(derived);
      });
    } else {
      // Fallback PBKDF2 if argon2 not in Node build
      crypto.pbkdf2(password, nonce, 100000, 32, 'sha256', (err, key) => {
        if (err) reject(err);
        else resolve(key);
      });
    }
  });
}

async function hashPassword(password) {
  const nonce = crypto.randomBytes(16);
  const derived = await derive(password, nonce);
  return `$argon2id$v=19$m=${PARAMETERS.memory},t=${PARAMETERS.passes},p=${PARAMETERS.parallelism}$${nonce.toString('base64url')}$${derived.toString('base64url')}`;
}

const prisma = createPrismaClient(process.env.DATABASE_URL);

async function main() {
  const email = 'customer@mark1.internal';
  const password = 'Password123!';
  const passwordHash = await hashPassword(password);

  console.log(`Checking user ${email}...`);
  let user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        role: 'customer',
        emailVerifiedAt: new Date(),
      },
    });
    console.log(`Created customer: ${user.id}`);
  } else {
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        emailVerifiedAt: new Date(),
        role: 'customer',
      },
    });
    console.log(`Updated customer: ${user.id}`);
  }

  // Check or create Price record
  let price = await prisma.priceVersion.findFirst({ where: { productVersionId: 'mark1-v1', isCurrent: true } });
  if (!price) {
    price = await prisma.priceVersion.create({
      data: {
        productVersionId: 'mark1-v1',
        amountPaise: 4900n,
        currency: 'INR',
        version: 1,
        isCurrent: true,
        createdById: user.id,
      },
    });
    console.log(`Created price record: ${price.id}`);
  }

  // Check or create entitlement
  let entitlement = await prisma.entitlement.findFirst({
    where: { userId: user.id, productVersionId: 'mark1-v1', status: 'active' },
  });

  if (!entitlement) {
    const razorpayOrderId = `order_seed_${Date.now()}`;
    const providerPaymentId = `pay_seed_${Date.now()}`;

    const order = await prisma.paymentOrder.create({
      data: {
        userId: user.id,
        productVersionId: 'mark1-v1',
        amountPaise: 4900n,
        currency: 'INR',
        priceVersionId: price.id,
        priceVersion: price.version,
        status: 'paid',
        razorpayOrderId,
      },
    });

    const purchase = await prisma.purchase.create({
      data: {
        orderId: order.id,
        userId: user.id,
        productVersionId: 'mark1-v1',
        amountPaise: 4900n,
        currency: 'INR',
        providerPaymentId,
      },
    });

    entitlement = await prisma.entitlement.create({
      data: {
        purchaseId: purchase.id,
        userId: user.id,
        productVersionId: 'mark1-v1',
        status: 'active',
      },
    });
    console.log(`Created active entitlement: ${entitlement.id}`);
  } else {
    console.log(`Customer already has active entitlement: ${entitlement.id}`);
  }

  console.log(`
======================================================
MARK-1 TEST CUSTOMER READY
======================================================
Email:    ${email}
Password: ${password}
Role:     customer
Status:   Verified & Entitled (mark1-v1)
======================================================
`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
