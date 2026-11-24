import { createPrismaClient } from '../packages/db/dist/client.js';

const prisma = createPrismaClient(process.env.DATABASE_URL);

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, role: true, emailVerifiedAt: true },
  });
  console.log('USERS IN DB:', users);

  const entitlements = await prisma.entitlement.findMany();
  console.log('ENTITLEMENTS IN DB:', entitlements);

  const pricing = await prisma.price.findMany();
  console.log('PRICING IN DB:', pricing);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
