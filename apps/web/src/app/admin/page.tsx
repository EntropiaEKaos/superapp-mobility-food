import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getAuth, authConfigured } from '@/lib/auth';
import { db } from '@superapp/database';
import { PartnerReviewConsole } from '@/components/partner-review-console';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  if (!authConfigured()) redirect('/login');
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect('/login');
  const profile = await db().user.findUnique({
    where: { id: session.user.id }, select: { role: true },
  });
  if (profile?.role !== 'ADMIN') return <main className="wrap interior">
    <div className="panel"><h1>Acesso restrito</h1><p>Somente administradores podem acessar esta área.</p></div>
  </main>;

  const entries = await db().partnerApplication.findMany({
    take: 100, orderBy: { createdAt: 'desc' },
    select: {
      id: true, kind: true, status: true, displayName: true, city: true,
      createdAt: true, reviewedAt: true,
      user: { select: { name: true, email: true } },
    },
  });
  const initial = entries.map(item => ({
    ...item,
    createdAt: item.createdAt.toISOString(),
    reviewedAt: item.reviewedAt?.toISOString() ?? null,
  }));
  return <main className="wrap interior">
    <Link href="/" className="back"><ArrowLeft size={16}/> Início</Link>
    <div className="page-heading">
      <div className="eyebrow muted">CENTRAL DE OPERAÇÕES · ACESSO RESTRITO</div>
      <h1>Análise de parceiros</h1>
      <p>Revise as solicitações dos motoristas, entregadores e estabelecimentos. Cada decisão é registrada no banco com o identificador do administrador.</p>
    </div>
    <PartnerReviewConsole initial={initial}/>
  </main>;
}
