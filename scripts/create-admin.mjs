import { createPrismaClient } from '../packages/db/dist/client.js';
import { hashPassword } from '../apps/api/dist/modules/auth/passwords.js';

/**
 * Bootstrap an admin account directly into the database.
 * Usage:
 *   node --env-file=.env scripts/create-admin.mjs <email> <password>
 */
async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const password = process.argv[3];

  if (!email || !password) {
    console.error('Usage: node --env-file=.env scripts/create-admin.mjs <email> <password>');
    process.exit(1);
  }

  if (password.length < 12) {
    console.error('Password must be at least 12 characters.');
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is not configured.');
    process.exit(1);
  }

  const prisma = createPrismaClient(databaseUrl);

  const existing = await prisma.user.findUnique({
    where: { email },
  });

  const passwordHash = await hashPassword(password);

  if (existing) {
    const updated = await prisma.user.update({
      where: { email },
      data: {
        role: 'admin',
        passwordHash,
        emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
      },
    });
    console.log(`Updated existing user ${updated.email} to verified admin role.`);
  } else {
    const created = await prisma.user.create({
      data: {
        email,
        passwordHash,
        role: 'admin',
        emailVerifiedAt: new Date(),
      },
    });
    console.log(`Successfully created verified admin user ${created.email} (ID: ${created.id}).`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Admin creation failed:', err);
  process.exit(1);
});
