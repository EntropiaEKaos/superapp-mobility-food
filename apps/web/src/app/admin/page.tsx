import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuth, authConfigured } from '@/lib/auth';
import { db } from '@superapp/database';
export const dynamic='force-dynamic';
export default async function AdminPage(){if(!authConfigured())redirect('/login');const session=await getAuth().api.getSession({headers:await headers()});if(!session)redirect('/login');const profile=await db().user.findUnique({where:{id:session.user.id},select:{role:true}});if(profile?.role!=='ADMIN')return <main className="wrap interior"><div className="panel"><h1>Acesso restrito</h1><p>Somente administradores podem acessar esta área.</p></div></main>;return <main className="wrap interior"><div className="eyebrow muted">ADMINISTRAÇÃO</div><h1>Central de operações</h1><p>Esqueleto protegido. Mapas, despachos e relatórios serão adicionados nas próximas sprints.</p></main>}
