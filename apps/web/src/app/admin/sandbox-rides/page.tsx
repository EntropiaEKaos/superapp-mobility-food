import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { authConfigured, getAuth } from '@/lib/auth';
import { db } from '@superapp/database';
import { sandboxEnabled } from '@/lib/sandbox-dispatch';
import { sandboxOperationsSnapshot } from '@/lib/sandbox-ops';
import { SandboxRidesConsole } from '@/components/sandbox-rides-console';

export const dynamic = 'force-dynamic';

export default async function SandboxRidesPage() {
  if (!authConfigured()) redirect('/login');
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect('/login');
  const profile = await db().user.findUnique({ where: { id: session.user.id }, select: { role: true } });
  if (profile?.role !== 'ADMIN') return <main className="wrap interior"><h1>Acesso restrito</h1></main>;

  return <main className="wrap interior">
    <Link className="back" href="/admin"><ArrowLeft size={16}/> Administração</Link>
    <div className="page-heading">
      <div className="eyebrow muted">SPRINT 09 · CENTRAL DE OPERAÇÕES</div>
      <h1>Central de operações simuladas</h1>
      <p>Acompanhe corridas fictícias com atualização automática a cada 6 segundos, indicadores, eventos e trajeto ilustrativo. Sem corridas ou GPS reais.</p>
    </div>
    {!sandboxEnabled() ? <div className="notice"><ShieldCheck size={17}/> Recurso desligado por padrão. Use ENABLE_SANDBOX_DISPATCH=true apenas no ambiente isolado de desenvolvimento.</div>
      : <SandboxRidesConsole initial={JSON.parse(JSON.stringify(await sandboxOperationsSnapshot()))}/>}
  </main>;
}
