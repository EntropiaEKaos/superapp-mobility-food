import { NextRequest, NextResponse } from 'next/server';
import { toNextJsHandler } from 'better-auth/next-js';
import { authConfigured, getAuth } from '@/lib/auth';
export const runtime = 'nodejs';
const unavailable = async () => NextResponse.json({ error: 'Authentication is not configured on this environment.' }, { status: 503 });
async function handle(request: NextRequest, verb: 'GET' | 'POST') {
  if (!authConfigured()) return unavailable();
  try {
    const handler = toNextJsHandler(getAuth());
    return handler[verb](request);
  } catch {
    return NextResponse.json({ error: 'Authentication unavailable.' }, { status: 503 });
  }
}
export const GET = (req: NextRequest) => handle(req,'GET');
export const POST = (req: NextRequest) => handle(req,'POST');
