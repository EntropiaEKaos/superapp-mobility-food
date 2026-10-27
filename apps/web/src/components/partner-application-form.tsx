'use client';

import { useState } from 'react';
import { ClipboardCheck, LoaderCircle } from 'lucide-react';
import type { PartnerKind } from '@/lib/partner-application';

type Application = {
  id: string;
  kind: PartnerKind;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  displayName: string;
  city: string;
  createdAt: string;
};
const labelByKind: Record<PartnerKind, string> = {
  DRIVER: 'Motorista',
  COURIER: 'Entregador',
  RESTAURANT: 'Restaurante',
};
const labelByStatus: Record<Application['status'], string> = {
  PENDING: 'Aguardando análise',
  APPROVED: 'Aprovada',
  REJECTED: 'Não aprovada',
};

export function PartnerApplicationForm({ initialApplications }: { initialApplications: Application[] }) {
  const [kind, setKind] = useState<PartnerKind>('DRIVER');
  const [displayName, setDisplayName] = useState('');
  const [city, setCity] = useState('Praia Grande');
  const [applications, setApplications] = useState(initialApplications);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const response = await fetch('/api/partners/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, displayName, city }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Não foi possível enviar.');
      setApplications(previous => [result.application, ...previous]);
      setDisplayName('');
      setNotice('Solicitação recebida! Você ainda não pode aceitar corridas, entregas ou pedidos.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao enviar solicitação.');
    } finally {
      setBusy(false);
    }
  }

  const submittedKinds = new Set(applications.map(application => application.kind));
  return <div className="partner-application-layout">
    <section className="panel">
      <h2><ClipboardCheck size={22}/> Solicitar parceria</h2>
      <p className="partner-muted">Seus dados serão enviados para análise. Nenhum perfil profissional é ativado automaticamente.</p>
      <form onSubmit={submit} className="auth-form">
        <label htmlFor="partner-kind">Quero ser</label>
        <select id="partner-kind" value={kind} onChange={e => setKind(e.target.value as PartnerKind)}>
          <option value="DRIVER">Motorista</option>
          <option value="COURIER">Entregador</option>
          <option value="RESTAURANT">Restaurante</option>
        </select>
        <label htmlFor="partner-name">Nome público / nome do estabelecimento</label>
        <input id="partner-name" required minLength={2} maxLength={80} value={displayName}
          onChange={e => setDisplayName(e.target.value)} placeholder="Como deseja ser identificado?" />
        <label htmlFor="partner-city">Cidade de operação</label>
        <input id="partner-city" required minLength={2} maxLength={80} value={city}
          onChange={e => setCity(e.target.value)} placeholder="Cidade" />
        {submittedKinds.has(kind) && <div className="notice">Você já tem uma solicitação nesta modalidade. O sistema aceita uma por tipo de parceria.</div>}
        {error && <p className="err" role="alert">{error}</p>}
        {notice && <p className="partner-success" role="status">{notice}</p>}
        <button className="btn primary full" type="submit" disabled={busy || submittedKinds.has(kind)}>
          {busy && <LoaderCircle className="spin" size={17}/>}
          Enviar para análise
        </button>
      </form>
    </section>
    <aside className="panel">
      <h2>Minhas solicitações</h2>
      {applications.length === 0
        ? <p className="partner-muted">Você ainda não enviou nenhuma solicitação.</p>
        : <div className="partner-applications">
          {applications.map(application =>
            <article key={application.id}>
              <strong>{labelByKind[application.kind]}</strong>
              <span>{application.displayName} · {application.city}</span>
              <small>{labelByStatus[application.status]}</small>
            </article>
          )}
        </div>
      }
      <p className="partner-muted">A aprovação requer validações e documentos que serão tratados em uma próxima etapa.</p>
    </aside>
  </div>;
}
