'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, XCircle, LoaderCircle, ShieldCheck } from 'lucide-react';

type Application = {
  id: string;
  kind: 'DRIVER' | 'COURIER' | 'RESTAURANT';
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  displayName: string;
  city: string;
  createdAt: string;
  reviewedAt: string | null;
  user: { name: string; email: string };
};
const kindLabel = { DRIVER: 'Motorista', COURIER: 'Entregador', RESTAURANT: 'Restaurante' };
const statusLabel = { PENDING: 'Aguardando análise', APPROVED: 'Inscrição aprovada', REJECTED: 'Inscrição recusada' };

export function PartnerReviewConsole({ initial }: { initial: Application[] }) {
  const [items, setItems] = useState(initial);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const router = useRouter();
  const waiting = items.filter(item => item.status === 'PENDING');
  const resolved = items.filter(item => item.status !== 'PENDING');

  async function decide(id: string, decision: 'APPROVED' | 'REJECTED') {
    if (activeId) return;
    setActiveId(id);
    setError('');
    try {
      const response = await fetch('/api/admin/partner-applications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, decision }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Não foi possível salvar.');
      setItems(current => current.map(item =>
        item.id === id ? { ...item, status: decision, reviewedAt: result.application.reviewedAt } : item
      ));
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Erro inesperado.');
    } finally {
      setActiveId(null);
    }
  }

  function entry(item: Application) {
    return <article className="review-entry" key={item.id}>
      <div className="review-heading">
        <div>
          <span className="tag">{kindLabel[item.kind]}</span>
          <h3>{item.displayName}</h3>
          <p>{item.city} · {item.user.name} ({item.user.email})</p>
        </div>
        <span className="review-status">{statusLabel[item.status]}</span>
      </div>
      {item.status === 'PENDING' && <div className="review-actions">
        <button type="button" className="btn primary" disabled={Boolean(activeId)}
          onClick={() => decide(item.id, 'APPROVED')}>
          {activeId === item.id ? <LoaderCircle className="spin" size={16}/> : <CheckCircle2 size={16}/>}
          Aprovar inscrição
        </button>
        <button type="button" className="btn secondary" disabled={Boolean(activeId)}
          onClick={() => decide(item.id, 'REJECTED')}>
          <XCircle size={16}/> Recusar
        </button>
      </div>}
    </article>;
  }

  return <div className="review-console">
    <div className="review-kpis">
      <div><span>Pendentes</span><strong>{waiting.length}</strong></div>
      <div><span>Analisadas</span><strong>{resolved.length}</strong></div>
      <div><span>Solicitações exibidas</span><strong>{items.length}</strong></div>
    </div>
    <div className="notice"><ShieldCheck size={17}/> Aprovar uma inscrição não libera corridas, entregas, pagamentos ou permissões administrativas.</div>
    {error && <div className="err" role="alert">{error}</div>}
    <h2>Fila de análise</h2>
    {waiting.length ? <div className="review-list">{waiting.map(entry)}</div>
      : <p className="partner-muted">Nenhuma solicitação pendente.</p>}
    <h2>Histórico recente</h2>
    {resolved.length ? <div className="review-list">{resolved.map(entry)}</div>
      : <p className="partner-muted">Ainda não há decisões registradas.</p>}
  </div>;
}
