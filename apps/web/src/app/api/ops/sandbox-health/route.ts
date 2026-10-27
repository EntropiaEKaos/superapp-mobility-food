import { createHash, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { sandboxEnabled } from '@/lib/sandbox-dispatch';
import { sandboxReadiness } from '@/lib/sandbox-monitor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headers = {
  'Cache-Control': 'private, no-store',
  'Vary': 'Authorization',
  'X-Content-Type-Options': 'nosniff',
};

function authorized(req: NextRequest): boolean {
  const expected = process.env.SANDBOX_MONITOR_TOKEN;
  if (!expected || expected.length < 32) return false;
  const raw = req.headers.get('authorization');
  if (!raw || !raw.startsWith('Bearer ') || raw.length > 1024) return false;
  const candidate = raw.slice('Bearer '.length);
  const a = createHash('sha256').update(candidate).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Machine-only health probe. Different secret from Better Auth.
 * Fail closed without explicit configuration; no guest-accessible details.
 */
export async function GET(req: NextRequest) {
  if (!sandboxEnabled() || !process.env.SANDBOX_MONITOR_TOKEN ||
      process.env.SANDBOX_MONITOR_TOKEN.length < 32) {
    return NextResponse.json({ status: 'disabled' }, { status: 503, headers });
  }
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  }
  try {
    const health = await sandboxReadiness();
    return NextResponse.json(health, {
      status: health.status === 'healthy' ? 200 : 503, headers,
    });
  } catch {
    return NextResponse.json({
      service: 'superapp-sandbox-monitor',
      status: 'unhealthy',
      reasons: ['DEPENDENCY_UNAVAILABLE'],
    }, { status: 503, headers });
  }
}
