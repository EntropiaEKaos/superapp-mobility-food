'use client';

import { useState } from 'react';
import { CarFront, Clock3, CircleCheck, CircleX, RotateCw } from 'lucide-react';

type Offer = {
  id: string;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED';
  expiresAt: string;
  driver: { label: string };
};
type Ride = {
  id: string;
  pickupLabel: string;
  dropoffLabel: string;
  status: 'REQUESTED' | 'OFFERED' | 'ACCEPTED' | 'EXPIRED' | 'COMPLETED' | 'CANCELED';
  acceptedDriver: { label: string } | null;
  offers: Offer[];
};
type Driver = { id: string; label: string; busy: boolean; active: boolean; lastSeenAt: string };
export type SandboxSnapshot = { demo: true; drivers: Driver[]; rides: Ride[] };

export function SandboxRidesConsole({ initial }: { initial: SandboxSnapshot }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [origin, setOrigin] = useState('boqueirao');
  const [destination, setDestination] = useState('ocian');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function refresh() {
    const response = await fetch('/api/admin/sandbox-rides', { cache: 'no-store' });
    if (!response.ok) throw new Error('Não foi possível atualizar o laboratório.');
    setSnapshot(await response.json());
  }
  async function action(input: Record<string, string | number>) {
    if (working) return;
    setWorking(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/admin/sandbox-rides', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Falha na simulação.');
      await refresh();
      setMessage('Operação simulada registrada com sucesso.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erro inesperado.');
    } finally {
      setWorking(false);
    }
  }

  const labels: Record<Ride['status'], string> = {
    REQUESTED: 'Criada', OFFERED: 'Ofertas enviadas', ACCEPTED: 'Aceita',
    EXPIRED: 'Ofertas expiradas', COMPLETED: 'Concluída', CANCELED: 'Cancelada',
  };
  const locations = [
    ['boqueirao', 'Boqueirão'], ['guilhermina', 'Guilhermina'],
    ['ocian', 'Ocian'], ['caicara', 'Caiçara'],
  ];
  return <div className="sandbox-lab">
    <section className="panel">
      <h2><CarFront size={22}/> Laboratório de ofertas</h2>
      <p className="partner-muted">Dados fictícios em PostgreSQL. Não conecta passageiros, motoristas ou pagamentos reais.</p>
      <div className="sandbox-controls">
        <button className="btn secondary" disabled={working} onClick={() => action({ action: 'seed' })}>
          <RotateCw size={16}/> Preparar veículos fictícios
        </button>
        <label>Origem
          <select value={origin} onChange={e => setOrigin(e.target.value)}>
            {locations.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <label>Destino
          <select value={destination} onChange={e => setDestination(e.target.value)}>
            {locations.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <button className="btn primary" disabled={working || origin === destination}
          onClick={() => action({ action: 'create', origin, destination })}>Criar corrida fictícia</button>
      </div>
      {error && <p className="err" role="alert">{error}</p>}
      {message && <p className="partner-success" role="status">{message}</p>}
    </section>
    <section className="review-kpis">
      <div><span>Veículos fictícios</span><strong>{snapshot.drivers.length}</strong></div>
      <div><span>Veículos livres</span><strong>{snapshot.drivers.filter(d => d.active && !d.busy).length}</strong></div>
      <div><span>Corridas no laboratório</span><strong>{snapshot.rides.length}</strong></div>
    </section>
    <section className="panel">
      <h2>Corridas de teste</h2>
      <div className="review-list">
        {snapshot.rides.map(ride => <article className="review-entry" key={ride.id}>
          <div className="review-heading"><div>
            <span className="tag">{labels[ride.status]}</span>
            <h3>{ride.pickupLabel} → {ride.dropoffLabel}</h3>
            <p>ID: {ride.id.slice(0, 12)} · {ride.acceptedDriver?.label ?? 'Sem veículo reservado'}</p>
          </div><span className="review-status">{ride.status}</span></div>
          <div className="review-actions">
            {ride.status === 'REQUESTED' && <button className="btn primary" disabled={working}
              onClick={() => action({ action: 'offer', rideId: ride.id })}>Gerar ofertas (30 s)</button>}
            {ride.status === 'OFFERED' && <>
              <button className="btn secondary" disabled={working}
                onClick={() => action({ action: 'expire', rideId: ride.id, advanceSeconds: 45 })}>
                <Clock3 size={16}/> Simular expiração +45 s
              </button>
            </>}
            {ride.status === 'ACCEPTED' && <button className="btn primary" disabled={working}
              onClick={() => action({ action: 'complete', rideId: ride.id })}><CircleCheck size={16}/> Finalizar simulação</button>}
          </div>
          {ride.offers.length > 0 && <div className="sandbox-offers">
            {ride.offers.map(offer => <div key={offer.id}>
              <span>{offer.driver.label} · {offer.status}</span>
              {ride.status === 'OFFERED' && offer.status === 'PENDING' &&
                <button type="button" disabled={working} onClick={() => action({ action: 'accept', offerId: offer.id })}>
                  <CircleCheck size={15}/> Aceitar como simulação
                </button>}
            </div>)}
          </div>}
        </article>)}
        {snapshot.rides.length === 0 && <p className="partner-muted">Prepare os veículos e crie uma corrida fictícia para começar.</p>}
      </div>
      <div className="sandbox-reset">
        <button className="btn secondary" disabled={working}
          onClick={() => action({ action: 'reset' })}><CircleX size={16}/> Limpar somente dados do laboratório</button>
      </div>
    </section>
  </div>;
}
