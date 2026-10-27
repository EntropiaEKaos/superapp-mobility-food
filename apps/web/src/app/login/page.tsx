import Link from 'next/link';
import { ArrowLeft, LockKeyhole } from 'lucide-react';
import { authConfigured } from '@/lib/auth';
import { LoginForm } from '@/components/login-form';
export const dynamic='force-dynamic';
export default function LoginPage(){const configured=authConfigured();return <main className="wrap interior auth-shell"><Link className="back" href="/"><ArrowLeft size={16}/> Início</Link><div className="panel auth-card"><LockKeyhole className="text-accent"/><h1>Sua conta, todos os serviços.</h1><p>Entre ou crie uma conta de teste.</p>{!configured&&<div className="notice">Login desabilitado nesta demonstração. Configure DATABASE_URL e BETTER_AUTH_SECRET para ativar.</div>}<LoginForm disabled={!configured}/></div></main>}
