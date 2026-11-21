import { createPrismaClient } from '../packages/db/dist/client.js';

async function main() {
  const prisma = createPrismaClient(process.env.DATABASE_URL);
  const rows = await prisma.$queryRaw`SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at ASC`;
  console.log('Applied migrations in Neon:', rows);
  
  // Also check if MailAccount table exists
  const tables = await prisma.$queryRaw`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`;
  console.log('Public tables in Neon:', tables.map(t => t.table_name));
  
  await prisma.$disconnect();
}

main().catch(console.error);
