import Link from 'next/link';
import { ArrowLeft, CarFront, MapPin, ShieldCheck } from 'lucide-react';
import { rankDemoDrivers, type DemoDriver } from '@superapp/rides';

export const dynamic = 'force-dynamic';

export default function DispatchDemoPage() {
  // The addresses below are fictional points for a static engineering demonstration.
  const nowMs = Date.now();
  const pickup = { lat: -24.0057, lng: -46.4126 };
  const drivers: DemoDriver[] = [
    { id: 'sim-a', label: 'Carro Alpha (fictício)', point: { lat: -24.0067, lng: -46.4140 }, online: true, available: true, approved: true, lastSeenAtMs: nowMs - 3000 },
    { id: 'sim-b', label: 'Carro Bravo (fictício)', point: { lat: -24.0110, lng: -46.4240 }, online: true, available: true, approved: true, lastSeenAtMs: nowMs - 15000 },
    { id: 'sim-c', label: 'Carro Charlie (ocupado)', point: { lat: -24.0040, lng: -46.4145 }, online: true, available: false, approved: true, lastSeenAtMs: nowMs - 1000 },
    { id: 'sim-d', label: 'Carro Delta (offline)', point: { lat: -24.0058, lng: -46.4135 }, online: false, available: true, approved: true, lastSeenAtMs: nowMs - 4000 },
    { id: 'sim-e', label: 'Carro Echo (inativo)', point: { lat: -24.0059, lng: -46.4127 }, online: true, available: true, approved: false, lastSeenAtMs: nowMs - 4000 },
    { id: 'sim-f', label: 'Carro Foxtrot (sinal antigo)', point: { lat: -24.0080, lng: -46.4144 }, online: true, available: true, approved: true, lastSeenAtMs: nowMs - 120_000 },
  ];
  const ranked = rankDemoDrivers(pickup, drivers, { nowMs, maxRadiusKm: 8, maxCandidates: 5 });
  return <main className="wrap interior">
    <Link className="back" href="/rides"><ArrowLeft size={17}/> Corridas</Link>
    <div className="page-heading">
      <div className="eyebrow muted">PROTÓTIPO DO MOTOR DE DESPACHO</div>
      <h1>Quem receberia a corrida?</h1>
      <p>Veja como um motor de distribuição poderia classificar veículos fictícios por distância,
      disponibilidade e atualização da localização. Não usa GPS real nem envia chamados.</p>
    </div>
    <div className="review-kpis">
      <div><span>Veículos simulados</span><strong>{drivers.length}</strong></div>
      <div><span>Elegíveis</span><strong>{ranked.length}</strong></div>
      <div><span>Raio de busca</span><strong>8 km</strong></div>
    </div>
    <section className="panel">
      <h2><CarFront size={22}/> Ordem sugerida (simulação)</h2>
      <div className="review-list">
        {ranked.map((driver, index) => <article key={driver.id} className="review-entry">
          <div className="review-heading">
            <div><span className="tag">CANDIDATO {index + 1}</span><h3>{driver.label}</h3>
              <p><MapPin size={15} className="inline"/> {driver.straightLineKm.toFixed(2)} km em linha reta</p>
            </div><span className="review-status">Apenas simulado</span>
          </div>
        </article>)}
      </div>
    </section>
    <div className="info"><ShieldCheck size={18}/> Não há cálculo de tempo de chegada,
    roteamento viário, reserva de motorista ou distribuição efetiva. O algoritmo é puro,
    repetível e será integrado ao sistema transacional apenas depois dos testes de concorrência.</div>
  </main>;
}
