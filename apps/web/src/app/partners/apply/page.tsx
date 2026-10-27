import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { authConfigured, getAuth } from '@/lib/auth';
import { db } from '@superapp/database';
import { PartnerApplicationForm } from '@/components/partner-application-form';

export const dynamic = 'force-dynamic';

export default async function ApplyPartnerPage() {
  if (!authConfigured()) {
    return <main className="wrap interior"><Link className="back" href="/partners"><ArrowLeft size={16}/> Parceiros</Link>
      <h1>Solicitar parceria</h1><div className="notice">Cadastro indisponível neste preview. Conecte PostgreSQL e Better Auth para habilitá-lo.</div>
    </main>;
  }

  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect('/login');

  const applications = await db().partnerApplication.findMany({
    where: { userId: session.user.id },
    select: { id: true, kind: true, status: true, displayName: true, city: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  const initialApplications = applications.map(application => ({
    ...application,
    createdAt: application.createdAt.toISOString(),
  }));

  return <main className="wrap interior">
    <Link className="back" href="/partners"><ArrowLeft size={16}/> Parceiros</Link>
    <div className="page-heading"><div className="eyebrow muted">REDE DE PARCEIROS</div>
      <h1>Faça parte da operação.</h1>
      <p>Envie sua solicitação para trabalhar como motorista, entregador ou restaurante. Sua conta continua comum até uma eventual aprovação.</p>
    </div>
    <PartnerApplicationForm initialApplications={initialApplications}/>
  </main>;
}
