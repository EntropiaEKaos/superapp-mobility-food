import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { db } from '@superapp/database';

/** Do not initialize when the DB or secret is absent in demo/preview mode. */
export function authConfigured() {
  return Boolean(process.env.DATABASE_URL && process.env.BETTER_AUTH_SECRET && process.env.BETTER_AUTH_SECRET.length >= 32);
}

export function getAuth() {
  if (!authConfigured()) throw new Error('Authentication not configured. Supply DATABASE_URL and BETTER_AUTH_SECRET.');
  return betterAuth({
    database: prismaAdapter(db(), { provider: 'postgresql' }),
    emailAndPassword: { enabled: true, minPasswordLength: 8 },
    user: { modelName: 'User' },
    session: { modelName: 'Session' },
    account: { modelName: 'Account' },
    verification: { modelName: 'Verification' },
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL,
  });
}
