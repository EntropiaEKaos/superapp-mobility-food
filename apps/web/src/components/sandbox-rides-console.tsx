'use client';

import { useEffect, useRef, useState } from 'react';
import { CarFront, Clock3, CircleCheck, CircleX, RotateCw } from 'lucide-react';
import { SandboxOperationsOverview, type SandboxOpsTelemetry } from './sandbox-operations-overview';
import { SandboxRoutePreview } from './sandbox-route-preview';

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
  status: 'REQUESTED' | 'OFFERED' | 'ACCEPTED' | 'ARRIVING' | 'IN_PROGRESS' | 'EXPIRED' | 'COMPLETED' | 'CANCELED';
  progressStep: number;
  trackingLat: number | null;
  trackingLng: number | null;
  events: Array<{ id: string; sequence: number; type: string; createdAt: string; progressStep: number | null; latitude: number | null; longitude: number | null }>;
  acceptedDriver: { label: string } | null;
  offers: Offer[];
};
type Driver = { id: string; label: string; busy: boolean; active: boolean; lastSeenAt: string };
export type SandboxSnapshot = { demo: true; drivers: Driver[]; rides: Ride[] } & SandboxOpsTelemetry;

export function SandboxRidesConsole({ initial }: { initial: SandboxSnapshot }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [origin, setOrigin] = useState('boqueirao');
  const [destination, setDestination] = useState('ocian');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [liveEnabled, setLiveEnabled] = useState(true);
  const [syncState, setSyncState] = useState<'updating' | 'live' | 'paused' | 'hidden' | 'error'>('live');
  const busyRef = useRef(false);

  async function refresh() {
    const response = await fetch('/api/admin/sandbox-rides', {
      cache: 'no-store', signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error('Não foi possível atualizar o laboratório.');
    setSnapshot(await response.json());
  }
  async function action(input: Record<string, string | number>) {
    if (busyRef.current) return;
    busyRef.current = true;
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
      busyRef.current = false;
      setWorking(false);
    }
  }

  async function updateManually() {
    if (busyRef.current) return;
    busyRef.current = true;
    setWorking(true);
    setError('');
    try { await refresh(); setSyncState('live'); } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao atualizar a leitura.');
    } finally { busyRef.current = false; setWorking(false); }
  }

  // Read-only polling uses one timer, aborts stale requests and pauses in hidden tabs.
  // Mutations own the UI while they run; background reads never overwrite them.
  useEffect(() => {
    if (!liveEnabled || working) return;
    let disposed = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: AbortController | undefined;

    const schedule = (delay: number) => {
      timer = setTimeout(() => { void poll(); }, delay);
    };
    async function poll() {
      if (disposed || busyRef.current) return;
      if (document.visibilityState !== 'visible') {
        setSyncState('hidden');
        return;
      }
      pending = new AbortController();
      const timeout = setTimeout(() => pending?.abort(), 8000);
      setSyncState('updating');
      try {
        const response = await fetch('/api/admin/sandbox-rides', {
          cache: 'no-store', signal: pending.signal,
        });
        if (!response.ok) throw new Error('Leitura indisponível');
        const data: SandboxSnapshot = await response.json();
        if (disposed || busyRef.current) return;
        setSnapshot(data);
        failures = 0;
        setSyncState('live');
        schedule(6000);
      } catch {
        if (disposed || pending.signal.aborted && document.visibilityState !== 'visible') return;
        failures += 1;
        setSyncState('error');
        schedule(Math.min(30000, 6000 * 2 ** Math.min(2, failures)));
      } finally {
        clearTimeout(timeout);
        pending = undefined;
      }
    }
    function onVisibility() {
      if (timer) clearTimeout(timer);
      if (document.visibilityState !== 'visible') {
        pending?.abort();
        setSyncState('hidden');
      } else {
        schedule(150);
      }
    }
    document.addEventListener('visibilitychange', onVisibility);
    if (document.visibilityState === 'visible') schedule(6000);
    else schedule(0); // poll callback reports hidden state without synchronous effect update
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      pending?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [liveEnabled, working]);

  const filteredRides = snapshot.rides.filter(ride =>
    (filter === 'ALL' || ride.status === filter) &&
    [ride.id, ride.pickupLabel, ride.dropoffLabel, ride.acceptedDriver?.label ?? '']
      .some(text => text.toLocaleLowerCase('pt-BR').includes(search.trim().toLocaleLowerCase('pt-BR')))
  );

  const labels: Record<Ride['status'], string> = {
    REQUESTED: 'Criada', OFFERED: 'Ofertas enviadas', ACCEPTED: 'Aceita',
    ARRIVING: 'Motorista a caminho', IN_PROGRESS: 'Viagem em andamento',
    EXPIRED: 'Ofertas expiradas', COMPLETED: 'Concluída', CANCELED: 'Cancelada',
  };
  const locations = [
    ['boqueirao', 'Boqueirão'], ['guilhermina', 'Guilhermina'],
    ['ocian', 'Ocian'], ['caicara', 'Caiçara'],
  ];
  return <div className="sandbox-lab">
    <div className="ops-live-status" role="status" aria-live="polite">
      <span className={syncState === 'live' && liveEnabled ? 'ops-live-dot' : 'ops-live-dot paused'}/>
      <strong>{!liveEnabled ? 'Atualização pausada' : syncState === 'hidden' ? 'Aba oculta: sincronização suspensa' :
        syncState === 'error' ? 'Falha na leitura — tentando novamente' : syncState === 'updating' ? 'Buscando alterações' : 'Atualização automática ativa'}</strong>
      <span>Leitura a cada 6 s · sem WebSockets ou GPS real</span>
      <label className="ops-live-switch"><input type="checkbox" checked={liveEnabled}
        onChange={e => { setLiveEnabled(e.target.checked); setSyncState(e.target.checked ? 'updating' : 'paused'); }}/>
        Atualização automática
      </label>
    </div>
    <SandboxOperationsOverview snapshot={snapshot} onRefresh={() => { void updateManually(); }} refreshing={working}/>
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
      <div className="ops-ride-filters">
        <div><h2>Corridas de teste</h2><p>Exibindo {filteredRides.length} das {snapshot.rides.length} viagens mais recentes ({snapshot.recentLimit} no máximo).</p></div>
        <label>Estado
          <select value={filter} onChange={event => setFilter(event.target.value)}>
            <option value="ALL">Todos os estados</option>
            {Object.entries(labels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <label>Buscar
          <input type="search" value={search} onChange={event => setSearch(event.target.value)}
            placeholder="Bairro, motorista ou ID" aria-label="Buscar corridas fictícias" />
        </label>
      </div>
      <div className="review-list">
        {filteredRides.map(ride => <article className="review-entry" key={ride.id}>
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
              onClick={() => action({ action: 'arrive', rideId: ride.id })}><CarFront size={16}/> Motorista a caminho</button>}
            {(ride.status === 'ARRIVING' || ride.status === 'IN_PROGRESS') && ride.progressStep < 5 &&
              <button className="btn secondary" disabled={working}
                onClick={() => action({ action: 'advance', rideId: ride.id })}>
                Avançar posição fictícia ({ride.progressStep + 1}/5)
              </button>}
            {ride.status === 'ARRIVING' && ride.progressStep === 5 &&
              <button className="btn primary" disabled={working}
                onClick={() => action({ action: 'start', rideId: ride.id })}>Iniciar viagem simulada</button>}
            {ride.status === 'IN_PROGRESS' && ride.progressStep === 5 &&
              <button className="btn primary" disabled={working}
                onClick={() => action({ action: 'complete', rideId: ride.id })}><CircleCheck size={16}/> Finalizar simulação</button>}
            {(['REQUESTED','OFFERED','ACCEPTED','ARRIVING'] as string[]).includes(ride.status) &&
              <button className="btn secondary" disabled={working}
                onClick={() => action({ action: 'cancel', rideId: ride.id })}><CircleX size={16}/> Cancelar simulação</button>}
          </div>
          <SandboxRoutePreview ride={ride}/>
          {(ride.status === 'ARRIVING' || ride.status === 'IN_PROGRESS' || ride.status === 'COMPLETED') &&
            <div className="sandbox-tracking">
              <div><strong>{ride.status === 'ARRIVING' ? 'Rumo ao embarque' : 'Rumo ao destino'} — {ride.progressStep}/5</strong>
                <span>Posição ilustrativa, sem GPS</span></div>
              <progress value={ride.progressStep} max={5} aria-label="Progresso fictício da etapa" />
              {ride.trackingLat !== null && ride.trackingLng !== null &&
                <code>{ride.trackingLat.toFixed(5)}, {ride.trackingLng.toFixed(5)}</code>}
            </div>}
          <details className="sandbox-timeline">
            <summary>Histórico da corrida ({ride.events?.length ?? 0} eventos)</summary>
            <ol>{(ride.events ?? []).map(event =>
              <li key={event.id}><strong>#{event.sequence} · {event.type}</strong>
                <span>{new Date(event.createdAt).toLocaleString('pt-BR')}
                  {event.progressStep !== null ? ` · passo ${event.progressStep}/5` : ''}
                </span></li>)}</ol>
          </details>
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
        {filteredRides.length === 0 && <p className="partner-muted">Nenhuma corrida encontrada. Altere os filtros ou crie uma simulação.</p>}
      </div>
      <div className="sandbox-reset">
        <button className="btn secondary" disabled={working}
          onClick={() => action({ action: 'reset' })}><CircleX size={16}/> Limpar somente dados do laboratório</button>
      </div>
    </section>
  </div>;
}
