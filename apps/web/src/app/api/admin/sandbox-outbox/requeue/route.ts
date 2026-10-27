import { NextRequest, NextResponse } from 'next/server';
import { authConfigured, getAuth } from '@/lib/auth';
import { sandboxEnabled } from '@/lib/sandbox-dispatch';
import { db } from '@superapp/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'private, no-store' };

/**
 * Manual, single-item admin requeue. Never processes a ride or payment.
 * A successful CAS update and its audit record commit together.
 */
export async function POST(req: NextRequest) {
  if (!sandboxEnabled() || !authConfigured())
    return NextResponse.json({ error: 'Laboratório desabilitado.' }, { status: 503, headers: noStore });
  try {
    const session = await getAuth().api.getSession({ headers: req.headers });
    if (!session) return NextResponse.json({ error: 'Login necessário.' }, { status: 401, headers: noStore });
    const role = await db().user.findUnique({ where: { id: session.user.id }, select: { role: true } });
    if (role?.role !== 'ADMIN')
      return NextResponse.json({ error: 'Acesso restrito.' }, { status: 403, headers: noStore });

    const trusted = process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL;
    const origin = req.headers.get('origin');
    if (!origin || !trusted || new URL(origin).origin !== new URL(trusted).origin)
      return NextResponse.json({ error: 'Origem não autorizada.' }, { status: 403, headers: noStore });
    if (!req.headers.get('content-type')?.startsWith('application/json'))
      return NextResponse.json({ error: 'Envie JSON.' }, { status: 415, headers: noStore });
    const data: unknown = await req.json().catch(() => null);
    if (!data || typeof data !== 'object' || Array.isArray(data))
      return NextResponse.json({ error: 'Payload inválido.' }, { status: 422, headers: noStore });
    const input = data as Record<string, unknown>;
    if (typeof input.id !== 'string' || !/^[1-9][0-9]{0,18}$/.test(input.id) ||
        input.confirmation !== 'REQUEUE')
      return NextResponse.json({ error: 'Confirme REQUEUE e selecione o ID.' }, { status: 422, headers: noStore });
    const id = BigInt(input.id);
    if (id > 9_223_372_036_854_775_807n)
      return NextResponse.json({ error: 'ID fora do intervalo.' }, { status: 422, headers: noStore });

    const result = await db().$transaction(async tx => {
      const changed = await tx.sandboxEventOutbox.updateMany({
        where: { id, status: 'DEAD' },
        data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(),
          publishedAt: null, lastErrorCode: null },
      });
      if (changed.count !== 1) return false;
      await tx.sandboxOutboxRequeueAudit.create({
        data: { outboxId: id, actorUserId: session.user.id },
      });
      return true;
    }, { isolationLevel: 'Serializable' });
    if (!result) return NextResponse.json({ error: 'Evento não encontrado ou já reprocessado.' },
      { status: 409, headers: noStore });
    return NextResponse.json({ demo: true, id: input.id, status: 'PENDING' }, { headers: noStore });
  } catch {
    return NextResponse.json({ error: 'Reprocessamento indisponível.' }, { status: 503, headers: noStore });
  }
}
