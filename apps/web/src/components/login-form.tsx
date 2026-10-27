 'use client';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
export function LoginForm({disabled}:{disabled:boolean}){
 const [register,setRegister]=useState(false),[name,setName]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function submit(e:React.FormEvent<HTMLFormElement>){e.preventDefault();if(disabled)return;setBusy(true);setError('');try{
 const result=register?await authClient.signUp.email({name,email,password}):await authClient.signIn.email({email,password});
 if(result.error){setError(result.error.message??'Falha na autenticação');return;}
 window.location.assign('/account');
 }catch{setError('Não foi possível autenticar. Confira as configurações do serviço.')}finally{setBusy(false)}}
 return <form className="auth-form" onSubmit={submit}>{register&&<><label htmlFor="name">Nome</label><input id="name" required value={name} onChange={e=>setName(e.target.value)} autoComplete="name" disabled={disabled}/></>}<label htmlFor="email">E-mail</label><input id="email" required type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" disabled={disabled}/><label htmlFor="password">Senha</label><input id="password" required type="password" minLength={8} value={password} onChange={e=>setPassword(e.target.value)} autoComplete={register?'new-password':'current-password'} disabled={disabled}/>{error&&<p className="err" role="alert">{error}</p>}<button type="submit" className="btn primary full" disabled={disabled||busy}>{busy?'Aguarde...':register?'Criar minha conta':'Entrar'}</button><button type="button" className="text-button" onClick={()=>{setRegister(!register);setError('')}} disabled={disabled}>{register?'Já tenho uma conta':'Criar uma conta'}</button></form>
}
