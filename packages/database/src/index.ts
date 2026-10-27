import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

type DBGlobal = typeof globalThis & { __superappPrisma?: PrismaClient };
const cached = globalThis as DBGlobal;

/** Lazy client: the static demo can build without a live database. */
export function db(): PrismaClient {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for persistent features');
  if (!cached.__superappPrisma) {
    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
    cached.__superappPrisma = new PrismaClient({ adapter });
  }
  return cached.__superappPrisma;
}

export type { PrismaClient };
