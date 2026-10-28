 'use client';
import { useState } from 'react';
import { CarFront, Sparkles, MapPin, LoaderCircle, ArrowRightLeft, ShieldCheck } from 'lucide-react';
import { brl } from '@/lib/format';
type Estimate = { straightLineKm: number; estimatedFareCents: number; demo: true };
const cityPoints = [
 {label:'Praia Grande • Boqueirão',point:{lat:-24.0057,lng:-46.4126}},
 {label:'Praia Grande • Guilhermina',point:{lat:-24.0050,lng:-46.4290}},
 {label:'Praia Grande • Ocian',point:{lat:-24.0282,lng:-46.4756}},
 {label:'Praia Grande • Caiçara',point:{lat:-24.0411,lng:-46.5094}},
];
export function RideEstimator() {
 const [from,setFrom]=useState(0),[to,setTo]=useState(2),[cat,setCat]=useState<'economy'|'comfort'>('economy');
 const [quote,setQuote]=useState<Estimate|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 function invert() { setFrom(to); setTo(from); setQuote(null); setError(''); }
 async function calculate() {
   setBusy(true);setError('');setQuote(null);
   try {const res=await fetch('/api/rides/estimate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({origin:cityPoints[from].point,destination:cityPoints[to].point,category:cat})});const data=await res.json();if(!res.ok)throw new Error(data.error??'Falha ao calcular');setQuote(data)} catch(e){setError(e instanceof Error?e.message:'Falha inesperada')} finally {setBusy(false)}
 }
 return <div className="panel estimator"><h2><MapPin size={22}/> Monte seu trajeto</h2><p className="sprint21-helper">Escolha bairros de exemplo e descubra um valor ilustrativo.</p><label htmlFor="origin">Origem</label><select id="origin" value={from} onChange={e=>{setFrom(+e.target.value);setQuote(null)}}>{cityPoints.map((p,i)=><option key={i} value={i}>{p.label}</option>)}</select><button className="sprint21-swap" type="button" onClick={invert} aria-label="Inverter origem e destino"><ArrowRightLeft size={17}/> Inverter origem e destino</button><label htmlFor="destination">Destino</label><select id="destination" value={to} onChange={e=>{setTo(+e.target.value);setQuote(null)}}>{cityPoints.map((p,i)=><option key={i} value={i}>{p.label}</option>)}</select><div className="sprint21-field-title">Escolha sua categoria</div><div className="categories"><button className={cat==='economy'?'selected':''} type="button" aria-pressed={cat==='economy'} onClick={()=>{setCat('economy');setQuote(null)}}><CarFront/> Econômico</button><button className={cat==='comfort'?'selected':''} type="button" aria-pressed={cat==='comfort'} onClick={()=>{setCat('comfort');setQuote(null)}}><Sparkles/> Conforto</button></div><button className="btn primary full" onClick={calculate} disabled={from===to||busy}>{busy?<LoaderCircle className="spin" size={18}/>:<CarFront size={18}/>} Calcular estimativa</button>{from===to&&<small role="status">Escolha lugares diferentes.</small>}{error&&<p role="alert" className="err">{error}</p>}{quote&&<div className="result" role="status" aria-live="polite"><span>ESTIMATIVA ILUSTRATIVA</span><strong>{brl(quote.estimatedFareCents)}</strong><p>{quote.straightLineKm} km em linha reta • Não é preço de corrida real.</p></div>}<p className="sprint21-estimator-notice"><ShieldCheck size={15}/> Sem localização ao vivo, sem motorista e sem cobrança real.</p></div>;
}
