import { NextRequest, NextResponse } from 'next/server';
import { advanceSandboxTracking, transitionSandboxJourney } from '@/lib/sandbox-journey';
import { authConfigured, getAuth } from '@/lib/auth';
import { db } from '@superapp/database';
import {
  acceptSandboxOffer, createSandboxRide,
  expireSandboxOffers, issueSandboxOffers, resetSandbox, sandboxEnabled,
  sandboxSnapshot, seedSandbox, validLocation, SandboxConflict,
} from '@/lib/sandbox-dispatch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'private, no-store' };

async function authorize(req: NextRequest) {
  if (!sandboxEnabled() || !authConfigured()) return NextResponse.json({ error: 'Laboratório desabilitado.' }, { status: 503 });
  const session = await getAuth().api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: 'Login necessário.' }, { status: 401 });
  const user = await db().user.findUnique({ where: { id: session.user.id }, select: { role: true } });
  if (user?.role !== 'ADMIN') return NextResponse.json({ error: 'Acesso reservado ao administrador.' }, { status: 403 });
  return null;
}

export async function GET(req: NextRequest) {
  try {
    const denied = await authorize(req);
    if (denied) return denied;
    return NextResponse.json(await sandboxSnapshot(), { headers: noStore });
  } catch {
    return NextResponse.json({ error: 'Laboratório indisponível.' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const denied = await authorize(req);
    if (denied) return denied;
    const trusted = process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL;
    const origin = req.headers.get('origin');
    if (!origin || !trusted || new URL(origin).origin !== new URL(trusted).origin) {
      return NextResponse.json({ error: 'Origem não autorizada.' }, { status: 403 });
    }
    if (!req.headers.get('content-type')?.startsWith('application/json')) {
      return NextResponse.json({ error: 'Conteúdo deve ser JSON.' }, { status: 415 });
    }
    const payload: unknown = await req.json().catch(() => null);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return NextResponse.json({ error: 'Requisição inválida.' }, { status: 422 });
    }
    const input = payload as Record<string, unknown>;
    let result: unknown;
    switch (input.action) {
      case 'seed':
        result = { createdOrUpdated: await seedSandbox() }; break;
      case 'reset':
        await resetSandbox(); result = { reset: true }; break;
      case 'create':
        if (!validLocation(input.origin) || !validLocation(input.destination)) {
          return NextResponse.json({ error: 'Selecione os pontos de demonstração.' }, { status: 422 });
        }
        result = await createSandboxRide(input.origin, input.destination); break;
      case 'offer':
        if (typeof input.rideId !== 'string') return NextResponse.json({ error: 'Corrida inválida.' }, { status: 422 });
        result = await issueSandboxOffers(input.rideId); break;
      case 'accept':
        if (typeof input.offerId !== 'string') return NextResponse.json({ error: 'Oferta inválida.' }, { status: 422 });
        result = await acceptSandboxOffer(input.offerId); break;
      case 'expire':
        if (typeof input.rideId !== 'string' ||
          (input.advanceSeconds !== undefined && (typeof input.advanceSeconds !== 'number' ||
          !Number.isInteger(input.advanceSeconds) || input.advanceSeconds < 0 || input.advanceSeconds > 120))) {
          return NextResponse.json({ error: 'Expiração inválida.' }, { status: 422 });
        }
        result = await expireSandboxOffers(input.rideId, typeof input.advanceSeconds === 'number' ? input.advanceSeconds : 0); break;
      case 'arrive':
      case 'start':
      case 'complete':
      case 'cancel':
        if (typeof input.rideId !== 'string' || input.rideId.length > 80) {
          return NextResponse.json({ error: 'Corrida inválida.' }, { status: 422 });
        }
        result = await transitionSandboxJourney(input.rideId, input.action); break;
      case 'advance':
        if (typeof input.rideId !== 'string' || input.rideId.length > 80) {
          return NextResponse.json({ error: 'Corrida inválida.' }, { status: 422 });
        }
        result = await advanceSandboxTracking(input.rideId); break;
      default:
        return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 422 });
    }
    return NextResponse.json({ demo: true, result }, { headers: noStore });
  } catch (error) {
    if (error instanceof SandboxConflict) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: 'Operação de simulação indisponível.' }, { status: 503 });
  }
}
