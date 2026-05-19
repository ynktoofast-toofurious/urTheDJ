import { PrismaClient } from '@/generated/prisma/client/client';
import { PrismaPg } from '@prisma/adapter-pg';

function makePrisma() {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL ?? '',
  });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as typeof globalThis & { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? makePrisma();

if (process.env.NODE_ENV !== 'production') { globalForPrisma.prisma = prisma; }


if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
