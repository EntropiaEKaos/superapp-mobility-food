import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export function GET() {
  return NextResponse.json({ service:'superapp-web', status:'ok', version:'sprint-01', authConfigured: Boolean(process.env.DATABASE_URL && process.env.BETTER_AUTH_SECRET) });
}
