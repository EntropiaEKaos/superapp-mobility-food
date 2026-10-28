'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, Clock3, ArrowUpRight } from 'lucide-react';
import type { DemoRestaurant } from '@superapp/food';
const clean = (s: string) => s.normalize('NFD').replace(/[^a-zA-Z0-9 ]/g, '').toLowerCase();
export function FoodDiscovery({restaurants}:{restaurants:DemoRestaurant[]}) {
 const [search,setSearch]=useState('');
 const [kind,setKind]=useState('Todas');
 const [sort,setSort]=useState('default');
 const kinds=['Todas',...new Set(restaurants.map(r=>r.cuisine))];
 const items=useMemo(()=>{
  const found=restaurants.filter(r=>(kind==='Todas'||r.cuisine===kind)&&clean([r.name,r.cuisine,...r.menu.map(m=>m.name)].join(' ')).includes(clean(search)));
  return sort==='name'?[...found].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')):found;
 },[restaurants,search,kind,sort]);
 const reset=()=>{setSearch('');setKind('Todas');setSort('default')};
 return <section aria-label="Descobrir restaurantes">
  <div className="sprint22-controls">
   <label htmlFor="food-search">Buscar restaurante ou prato
    <input id="food-search" type="search" placeholder="Pizza, burger, prato caseiro" value={search} onChange={e=>setSearch(e.target.value)}/>
   </label>
   <label htmlFor="food-sort">Ordenar por
    <select id="food-sort" value={sort} onChange={e=>setSort(e.target.value)}><option value="default">Sugestões</option><option value="name">Nome A–Z</option></select>
   </label>
  </div>
  <div className="sprint22-chips" role="group" aria-label="Filtrar por culinária">
   {kinds.map(cuisine=><button type="button" key={cuisine} aria-pressed={kind===cuisine} onClick={()=>setKind(cuisine)}>{cuisine}</button>)}
  </div>
  <div className="sprint22-summary" role="status" aria-live="polite">{items.length} {items.length===1?'restaurante encontrado':'restaurantes encontrados'}
   {(search||kind!=='Todas'||sort!=='default')&&<button type="button" onClick={reset}>Limpar filtros</button>}
  </div>
  {items.length===0?<div className="sprint22-empty"><Search size={26}/><h3>Nenhum restaurante encontrado</h3><p>Tente outro prato ou remova os filtros.</p><button type="button" onClick={reset}>Ver todos os restaurantes</button></div>:
   <div className="restaurant-grid sprint21-restaurants">{items.map(r=><Link href={'/food/'+r.id} key={r.id} className="restaurant">
    <div className="restaurant-cover"><span aria-hidden="true">{r.emoji}</span></div>
    <div className="restaurant-info"><span className="tag">{r.cuisine}</span><h2>{r.name}</h2><p><Clock3 size={15}/> {r.eta} • demonstração</p><span className="read">Explorar cardápio <ArrowUpRight size={17}/></span></div>
   </Link>)}</div>}
 </section>;
}
