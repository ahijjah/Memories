import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Minimal slice of the seed dataset in spec §25. Expand as later epics
// (Vault, Collections, Reminders) land. Never seed real personal documents —
// synthetic data only.
async function main() {
  const user = await prisma.user.upsert({
    where: { email: 'demo@example.com' },
    update: {},
    create: { email: 'demo@example.com', displayName: 'Demo User' },
  });

  await prisma.memory.upsert({
    where: { idempotencyKey: 'seed-istanbul-restaurant' },
    update: {},
    create: {
      userId: user.id,
      sourceType: 'url',
      sourceUri: 'https://example.com/istanbul-restaurant-review',
      title: 'Great kebab place in Istanbul',
      idempotencyKey: 'seed-istanbul-restaurant',
      processingState: 'queued',
    },
  });

  await prisma.memory.upsert({
    where: { idempotencyKey: 'seed-conference-poster' },
    update: {},
    create: {
      userId: user.id,
      sourceType: 'image',
      title: 'Tech Conference 2026 poster',
      idempotencyKey: 'seed-conference-poster',
      processingState: 'queued',
    },
  });

  console.log(`Seeded demo user: ${user.email} (${user.id})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
