import { NextRequest, NextResponse } from 'next/server';
import { db } from '@superapp/database';
import { authConfigured, getAuth } from '@/lib/auth';
import { validatePartnerRequest } from '@/lib/partner-application';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function currentUser(req: NextRequest): Promise<string | null> {
  const session = await getAuth().api.getSession({ headers: req.headers });
  return session?.user?.id ?? null;
}

const unavailable = () => NextResponse.json({ error: 'Cadastro indisponível neste ambiente.' }, { status: 503 });

export async function GET(req: NextRequest) {
  if (!authConfigured()) return unavailable();
  try {
    const userId = await currentUser(req);
    if (!userId) return NextResponse.json({ error: 'Entre na sua conta.' }, { status: 401 });
    const applications = await db().partnerApplication.findMany({
      where: { userId },
      select: { id: true, kind: true, status: true, displayName: true, city: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ applications }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ error: 'Não foi possível consultar solicitações.' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  if (!authConfigured()) return unavailable();
  const allowedOrigin = process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  const receivedOrigin = req.headers.get('origin');
  if (receivedOrigin && allowedOrigin) {
    try {
      if (new URL(receivedOrigin).origin !== new URL(allowedOrigin).origin) {
        return NextResponse.json({ error: 'Origem não autorizada.' }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: 'Origem inválida.' }, { status: 403 });
    }
  }
  if (!req.headers.get('content-type')?.startsWith('application/json')) {
    return NextResponse.json({ error: 'Envie JSON válido.' }, { status: 415 });
  }
  let payload: unknown;
  try { payload = await req.json(); }
  catch { return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 }); }

  const parsed = validatePartnerRequest(payload);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });

  try {
    const userId = await currentUser(req);
    if (!userId) return NextResponse.json({ error: 'Entre na sua conta.' }, { status: 401 });

    const application = await db().partnerApplication.create({
      data: { userId, ...parsed.data },
      select: { id: true, kind: true, status: true, displayName: true, city: true, createdAt: true },
    });
    return NextResponse.json({ application }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      return NextResponse.json({ error: 'Você já enviou uma solicitação para essa modalidade.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Não foi possível registrar a solicitação.' }, { status: 503 });
  }
}
