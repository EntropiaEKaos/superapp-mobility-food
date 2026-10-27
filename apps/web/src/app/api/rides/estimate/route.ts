import { NextRequest, NextResponse } from 'next/server';
import { estimateRide, isGeoPoint } from '@superapp/rides';
export async function POST(req: NextRequest) {
  let payload: unknown;
  try { payload = await req.json(); } catch { return NextResponse.json({ error:'JSON inválido' }, {status:400}); }
  if (!payload || typeof payload !== 'object') return NextResponse.json({error:'Dados inválidos'}, {status:400});
  const {origin,destination,category} = payload as Record<string,unknown>;
  if (!isGeoPoint(origin) || !isGeoPoint(destination) || (category !== undefined && category !== 'economy' && category !== 'comfort')) {
    return NextResponse.json({error:'Coordenadas ou categoria inválidas'}, {status:422});
  }
  const estimate = estimateRide(origin,destination,(category ?? 'economy') as 'economy'|'comfort');
  return NextResponse.json({...estimate, disclaimer:'Estimativa demonstrativa por linha reta. Não cria corrida, não usa rotas de ruas.'});
}
