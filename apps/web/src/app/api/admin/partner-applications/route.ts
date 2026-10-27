import { NextRequest, NextResponse } from 'next/server';
import { authConfigured, getAuth } from '@/lib/auth';
import { db } from '@superapp/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'private, no-store' };

async function guard(req: NextRequest): Promise<
  { ok: true; userId: string } | { ok: false; response: NextResponse }
> {
  if (!authConfigured()) return { ok: false, response: NextResponse.json({ error: 'Serviço indisponível.' }, { status: 503 }) };
  const session = await getAuth().api.getSession({ headers: req.headers });
  if (!session) return { ok: false, response: NextResponse.json({ error: 'Autenticação necessária.' }, { status: 401 }) };
  const user = await db().user.findUnique({ where: { id: session.user.id }, select: { role: true } });
  if (user?.role !== 'ADMIN') return { ok: false, response: NextResponse.json({ error: 'Acesso proibido.' }, { status: 403 }) };
  return { ok: true, userId: session.user.id };
}

export async function GET(req: NextRequest) {
  try {
    const check = await guard(req);
    if (!check.ok) return check.response;
    const applications = await db().partnerApplication.findMany({
      take: 100,
      orderBy: [{ status: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true, kind: true, status: true, displayName: true, city: true,
        createdAt: true, reviewedAt: true, reviewerId: true,
        user: { select: { name: true, email: true } },
      },
    });
    return NextResponse.json({ applications }, { headers: noStore });
  } catch {
    return NextResponse.json({ error: 'Não foi possível consultar inscrições.' }, { status: 503 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const check = await guard(req);
    if (!check.ok) return check.response;

    // Fail closed: a privileged cookie-authenticated mutation requires matching origin.
    const trusted = process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL;
    const origin = req.headers.get('origin');
    if (!origin || !trusted || new URL(origin).origin !== new URL(trusted).origin) {
      return NextResponse.json({ error: 'Origem não autorizada.' }, { status: 403 });
    }
    if (!req.headers.get('content-type')?.startsWith('application/json')) {
      return NextResponse.json({ error: 'Envie JSON.' }, { status: 415 });
    }
    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Dados inválidos.' }, { status: 422 });
    }
    const input = body as Record<string, unknown>;
    if (typeof input.id !== 'string' || input.id.length < 10 || input.id.length > 80 ||
        (input.decision !== 'APPROVED' && input.decision !== 'REJECTED')) {
      return NextResponse.json({ error: 'Identificador ou decisão inválida.' }, { status: 422 });
    }

    // Single-statement compare-and-set: prevents a second reviewer from overwriting
    // a decision. Neither user.role nor vehicle/restaurant approval is modified.
    const changed = await db().partnerApplication.updateMany({
      where: { id: input.id, status: 'PENDING', userId: { not: check.userId } },
      data: { status: input.decision, reviewedAt: new Date(), reviewerId: check.userId },
    });
    if (changed.count !== 1) {
      return NextResponse.json({ error: 'Inscrição inexistente ou já analisada.' }, { status: 409 });
    }
    const application = await db().partnerApplication.findUnique({
      where: { id: input.id },
      select: { id: true, kind: true, status: true, reviewedAt: true, reviewerId: true },
    });
    return NextResponse.json({ application }, { headers: noStore });
  } catch {
    return NextResponse.json({ error: 'Não foi possível registrar a decisão.' }, { status: 503 });
  }
}
