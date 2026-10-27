import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { demoRestaurants } from '@superapp/food';
import { DemoCart } from '@/components/demo-cart';
export default async function RestaurantPage({params}:{params:Promise<{id:string}>}){const {id}=await params;const restaurant=demoRestaurants.find(r=>r.id===id);if(!restaurant)notFound();return <main className="wrap interior"><Link className="back" href="/food"><ArrowLeft size={16}/> Restaurantes</Link><div className="restaurant-hero"><div className="restaurant-emoji">{restaurant.emoji}</div><div><div className="eyebrow muted">RESTAURANTE DEMONSTRATIVO</div><h1>{restaurant.name}</h1><p>{restaurant.cuisine} • Entrega ilustrativa: {restaurant.eta}</p></div></div><h2 className="subheading">Cardápio</h2><DemoCart restaurantName={restaurant.name} menu={restaurant.menu}/><div className="info">Carrinho interativo apenas para demonstração. Nenhum pedido é enviado ou cobrado.</div></main>}
