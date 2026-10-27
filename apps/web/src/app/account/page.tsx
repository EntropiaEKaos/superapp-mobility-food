import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuth, authConfigured } from '@/lib/auth';
import { db } from '@superapp/database';
export const dynamic='force-dynamic';
export default async function AccountPage(){if(!authConfigured())redirect('/login');const session=await getAuth().api.getSession({headers:await headers()});if(!session)redirect('/login');const user=await db().user.findUnique({where:{id:session.user.id},select:{role:true}});return <main className="wrap interior"><div className="panel"><div className="eyebrow muted">ÁREA AUTENTICADA</div><h1>Olá, {session.user.name}!</h1><p>Seu perfil: <strong>{user?.role??'CUSTOMER'}</strong></p><p>O painel transacional será desenvolvido nas próximas sprints.</p><Link href="/" className="btn secondary">Voltar ao início</Link></div></main>}
