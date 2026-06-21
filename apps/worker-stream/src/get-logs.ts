import { prisma } from './services/db.js';

async function main() {
  const logs = await prisma.streamLog.findMany({
    orderBy: {
      createdAt: 'desc'
    },
    take: 50
  });
  console.log("LAST 50 LOGS:");
  for (const log of logs.reverse()) {
    console.log(`[${log.createdAt.toISOString()}] [${log.type}] [${log.level}] ${log.message}`);
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
