'use client';

import { useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export type FailedSandboxNotice = {
  id: string;
  attempts: number;
  lastErrorCode: string | null;
  createdAt: string;
};

export function SandboxOutboxRecovery({
  notices, onRequeued,
}: {
  notices: FailedSandboxNotice[];
  onRequeued: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [working, setWorking] = useState(false);
  const [feedback, setFeedback] = useState('');
  async function submit() {
    if (!selected || confirmation !== 'REQUEUE' || working) return;
    setWorking(true);
    setFeedback('');
    try {
      const response = await fetch('/api/admin/sandbox-outbox/requeue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selected, confirmation }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Recuperação indisponível.');
      setSelected(null);
      setConfirmation('');
      await onRequeued();
      setFeedback('Evento fictício devolvido à fila, com registro de auditoria.');
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Falha inesperada.');
    } finally {
      setWorking(false);
    }
  }
  return <section className="panel" aria-label="Recuperação auditada da outbox">
    <h2><AlertTriangle size={20}/> Eventos que exigem intervenção</h2>
    <p className="partner-muted">Até 5 notificações fictícias com tentativas esgotadas. Reabrir não executa corrida ou pagamento; apenas libera nova publicação de aviso.</p>
    {!notices.length && <p className="ops-healthy">Nenhum evento esgotado na amostra recente.</p>}
    {notices.map(notice => <div key={notice.id} className="sandbox-outbox-entry">
      <div>
        <strong>Evento #{notice.id}</strong>
        <small>{notice.attempts} tentativas · {notice.lastErrorCode ?? 'Sem código de falha'} · {new Date(notice.createdAt).toLocaleString('pt-BR')}</small>
      </div>
      <button className="btn secondary" type="button" disabled={working}
        onClick={() => { setSelected(selected === notice.id ? null : notice.id); setConfirmation(''); setFeedback(''); }}>
        <RefreshCw size={15}/> Preparar reprocessamento
      </button>
    </div>)}
    {selected && <div className="sandbox-outbox-confirm">
      <p>Confirme a reabertura do aviso <strong>#{selected}</strong>. A operação é auditada e não pode ser executada duas vezes sem uma nova falha.</p>
      <label>Digite REQUEUE
        <input value={confirmation} onChange={event => setConfirmation(event.target.value)}
          placeholder="REQUEUE" aria-label="Confirmar reprocessamento" autoComplete="off"/>
      </label>
      <div className="sandbox-outbox-actions">
        <button className="btn primary" disabled={working || confirmation !== 'REQUEUE'} onClick={() => { void submit(); }}>
          Confirmar reprocessamento
        </button>
        <button className="btn secondary" disabled={working} onClick={() => { setSelected(null); setConfirmation(''); }}>
          Cancelar
        </button>
      </div>
    </div>}
    {feedback && <p role="status" className="partner-muted">{feedback}</p>}
  </section>;
}
