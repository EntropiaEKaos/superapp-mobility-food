import { Activity, AlertTriangle, CarFront, CheckCircle2, Clock3, Gauge, RefreshCw } from 'lucide-react';

export type SandboxOpsTelemetry = {
  generatedAt: string;
  recentLimit: number;
  deadSamples: Array<{ id: string; attempts: number; lastErrorCode: string | null; createdAt: string }>;
  workerHealth: { activeConnections: number; averagePublishLagSeconds: number | null; sampleSize: number };
  outboxHealth: { pending: number; published: number; dead: number; retrying: number; oldestDeadAgeSeconds: number | null; oldestPendingAgeSeconds: number | null; deliveryGuarantee: 'at-least-once-to-broker' };
  streamHealth: { activeConnections: number; capacity: number; availableSlots: number; utilizationPercent: number; transport: 'postgres' | 'redis' };
  metrics: {
    totalRides: number;
    activeRides: number;
    waitingRides: number;
    completedRides: number;
    totalDrivers: number;
    freeDrivers: number;
    busyDrivers: number;
    staleDrivers: number;
    pendingOffers: number;
    overdueOffers: number;
    eventCount: number;
    ridesByStatus: Record<
      'REQUESTED' | 'OFFERED' | 'ACCEPTED' | 'ARRIVING' |
      'IN_PROGRESS' | 'COMPLETED' | 'CANCELED' | 'EXPIRED',
      number
    >;
  };
  diagnostics: Array<{
    code: string;
    rideId: string;
    severity: 'warning' | 'critical';
    message: string;
  }>;
  recentEvents: Array<{
    id: string;
    sequence: number;
    type: string;
    createdAt: string;
    ride: { id: string; pickupLabel: string; dropoffLabel: string };
  }>;
};

const statusLabels: Array<{ id: keyof SandboxOpsTelemetry['metrics']['ridesByStatus']; label: string }> = [
  { id: 'REQUESTED', label: 'Criadas' },
  { id: 'OFFERED', label: 'Ofertas abertas' },
  { id: 'ACCEPTED', label: 'Aceitas' },
  { id: 'ARRIVING', label: 'A caminho' },
  { id: 'IN_PROGRESS', label: 'Em viagem' },
  { id: 'COMPLETED', label: 'Concluídas' },
  { id: 'CANCELED', label: 'Canceladas' },
  { id: 'EXPIRED', label: 'Expiradas' },
];
const eventLabels: Record<string, string> = {
  CREATED: 'Corrida criada', OFFERED: 'Ofertas emitidas',
  ACCEPTED: 'Motorista fictício reservado', ARRIVING: 'Motorista a caminho',
  IN_PROGRESS: 'Viagem iniciada', LOCATION_UPDATED: 'Posição fictícia atualizada',
  COMPLETED: 'Simulação concluída', CANCELED: 'Corrida cancelada',
  EXPIRED: 'Ofertas expiradas',
};

export function SandboxOperationsOverview({
  snapshot, onRefresh, refreshing,
}: {
  snapshot: SandboxOpsTelemetry;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const m = snapshot.metrics;
  const cards = [
    { label: 'Corridas fictícias', value: m.totalRides, icon: <CarFront size={21}/> },
    { label: 'Em andamento', value: m.activeRides, icon: <Activity size={21}/> },
    { label: 'Aguardando', value: m.waitingRides, icon: <Clock3 size={21}/> },
    { label: 'Concluídas', value: m.completedRides, icon: <CheckCircle2 size={21}/> },
    { label: 'Veículos disponíveis', value: m.freeDrivers, icon: <Gauge size={21}/> },
    { label: 'Ofertas vencidas', value: m.overdueOffers, icon: <AlertTriangle size={21}/> },
  ];
  const maxCount = Math.max(1, ...Object.values(m.ridesByStatus));
  return <section className="ops-overview" aria-label="Indicadores do laboratório">
    <div className="ops-toolbar">
      <div>
        <div className="eyebrow muted">MONITORAMENTO DO LABORATÓRIO</div>
        <h2>Visão geral da operação</h2>
        <p>Última leitura: {new Date(snapshot.generatedAt).toLocaleString('pt-BR')} · Apenas dados de simulação.</p>
      </div>
      <button className="btn secondary" type="button" disabled={refreshing} onClick={onRefresh}>
        <RefreshCw size={16}/> Atualizar indicadores
      </button>
    </div>
    <div className="ops-kpis">
      {cards.map(card => <div key={card.label} className="ops-kpi">
        <span className="ops-kpi-icon">{card.icon}</span>
        <span>{card.label}</span>
        <strong>{card.value}</strong>
      </div>)}
    </div>
    <div className="ops-substats" aria-label="Disponibilidade e histórico">
      <span>Veículos fictícios: <b>{m.totalDrivers}</b></span>
      <span>Ocupados: <b>{m.busyDrivers}</b></span>
      <span>Posição antiga: <b>{m.staleDrivers}</b></span>
      <span>Ofertas pendentes: <b>{m.pendingOffers}</b></span>
      <span>Eventos registrados: <b>{m.eventCount}</b></span>
    </div>
    <section className="ops-stream-health" aria-label="Saúde das transmissões">
      <div className="ops-stream-health-heading">
        <strong><Activity size={18}/> Conexões em tempo real</strong>
        <span>{snapshot.streamHealth.activeConnections} de {snapshot.streamHealth.capacity} canais SSE · {snapshot.streamHealth.transport === 'redis' ? 'Redis' : 'PostgreSQL'}</span>
      </div>
      <div className="ops-stream-meter" role="progressbar"
        aria-label="Utilização de conexões SSE" aria-valuenow={snapshot.streamHealth.activeConnections}
        aria-valuemin={0} aria-valuemax={snapshot.streamHealth.capacity}>
        <div style={{ width: `${Math.min(100, snapshot.streamHealth.utilizationPercent)}%` }}/>
      </div>
      <p>Capacidade disponível: <b>{snapshot.streamHealth.availableSlots}</b> · Máximo de uma conexão por administrador.
        Quando o limite é atingido, o painel pode usar consultas periódicas como alternativa.</p>
    </section>
    <section className="ops-outbox-health" aria-label="Saúde da fila durável de eventos">
      <div className="ops-stream-health-heading">
        <strong><Activity size={18}/> Eventos duráveis · Outbox</strong>
        <span>Entrega ao broker com possível repetição</span>
      </div>
      <p>Workers ativos no PostgreSQL: <strong>{snapshot.workerHealth.activeConnections}</strong> ·
        Atraso médio de publicação: <strong>{snapshot.workerHealth.averagePublishLagSeconds === null
          ? 'Sem amostra' : `${snapshot.workerHealth.averagePublishLagSeconds}s`}</strong>
        · Amostra de {snapshot.workerHealth.sampleSize} avisos publicados.</p>
      <div className="ops-outbox-stats">
        <span>Pendentes <strong>{snapshot.outboxHealth.pending}</strong></span>
        <span>Publicados <strong>{snapshot.outboxHealth.published}</strong></span>
        <span>Em nova tentativa <strong>{snapshot.outboxHealth.retrying}</strong></span>
        <span>Intervenção necessária <strong>{snapshot.outboxHealth.dead}</strong></span>
        <span>Evento pendente mais antigo <strong>{snapshot.outboxHealth.oldestPendingAgeSeconds === null
          ? 'Nenhum' : `${snapshot.outboxHealth.oldestPendingAgeSeconds}s`}</strong></span>
      </div>
      {snapshot.outboxHealth.dead > 0 && <div className="ops-alert">
        <AlertTriangle size={17}/> Há {snapshot.outboxHealth.dead} eventos com tentativas esgotadas. Revisão administrativa necessária; nenhuma republicação automática.
      </div>}
      {snapshot.outboxHealth.oldestPendingAgeSeconds !== null && snapshot.outboxHealth.oldestPendingAgeSeconds > 15 &&
        <div className="ops-alert"><AlertTriangle size={17}/>
          A ponte pode estar indisponível: há eventos ainda não publicados há mais de 15 segundos.
        </div>}
      <p>Os registros da outbox persistem no PostgreSQL. O Redis Pub/Sub não oferece replay de notificações a clientes desconectados.</p>
    </section>
    <div className="ops-columns">
      <section className="panel">
        <h3>Estados das corridas</h3>
        <p className="ops-help">Totais em todo o banco de testes, não só nas viagens exibidas.</p>
        <div className="ops-status-bars">
          {statusLabels.map(item => {
            const value = m.ridesByStatus[item.id];
            return <div key={item.id} className="ops-status-row">
              <span>{item.label}</span>
              <div className="ops-track"><div style={{ width: `${(value / maxCount) * 100}%` }}/></div>
              <strong>{value}</strong>
            </div>;
          })}
        </div>
      </section>
      <section className="panel">
        <h3>Diagnóstico de integridade</h3>
        <p className="ops-help">Análise limitada às {snapshot.recentLimit} corridas mais recentes; contadores globais acima.</p>
        {m.overdueOffers > 0 && <div className="ops-alert">
          <AlertTriangle size={18}/> Existem {m.overdueOffers} ofertas vencidas ainda pendentes no laboratório.
        </div>}
        {snapshot.diagnostics.length === 0
          ? <p className="ops-healthy"><CheckCircle2 size={18}/> Nenhuma anomalia identificada na amostra recente.</p>
          : <ul className="ops-issues">
            {snapshot.diagnostics.map((issue, index) => <li key={`${issue.rideId}-${issue.code}-${index}`}>
              <AlertTriangle size={17}/><span>{issue.message}<small>Corrida {issue.rideId.slice(0, 12)} · {issue.severity === 'critical' ? 'Crítico' : 'Atenção'}</small></span>
            </li>)}
          </ul>}
      </section>
    </div>
    <section className="panel ops-activity">
      <div className="ops-activity-heading"><h3>Eventos recentes</h3><span>12 últimas alterações registradas</span></div>
      {snapshot.recentEvents.length ? <ol>
        {snapshot.recentEvents.map(event => <li key={event.id}>
          <div className="ops-event-mark"><Activity size={16}/></div>
          <div className="ops-event-detail">
            <strong>{eventLabels[event.type] ?? event.type}</strong>
            <span>{event.ride.pickupLabel} → {event.ride.dropoffLabel}</span>
            <small>#{event.sequence} · {event.ride.id.slice(0, 12)}</small>
          </div>
          <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString('pt-BR')}</time>
        </li>)}
      </ol> : <p className="partner-muted">Ainda não há eventos no laboratório.</p>}
    </section>
  </section>;
}
