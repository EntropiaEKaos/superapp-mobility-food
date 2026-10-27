export type DemoMenuItem = { id: string; name: string; description: string; priceCents: number; emoji: string };
export type DemoRestaurant = { id: string; name: string; cuisine: string; eta: string; emoji: string; menu: DemoMenuItem[] };
/** Fixture only. Not an actual connected merchant or real order catalog. */
export const demoRestaurants: DemoRestaurant[] = [
 { id: 'demo-bistro', name: 'Bistrô da Praça (demo)', cuisine: 'Brasileira', eta: '25–35 min', emoji: '🍲', menu: [
   {id:'rice-beans', name:'Prato caseiro', description:'Arroz, feijão, proteína e acompanhamentos', priceCents:2490, emoji:'🍛'},
   {id:'fresh-juice', name:'Suco natural', description:'Copo de 300 ml', priceCents:890, emoji:'🥤'}
 ]},
 { id: 'demo-pizza', name: 'Pizza Central (demo)', cuisine: 'Pizza', eta: '35–45 min', emoji: '🍕', menu: [
   {id:'pizza-margherita', name:'Pizza margherita', description:'Molho, queijo e manjericão', priceCents:4690, emoji:'🍕'},
   {id:'soda', name:'Refrigerante lata', description:'350 ml', priceCents:690, emoji:'🥫'}
 ]},
 { id: 'demo-burger', name: 'Burger Estação (demo)', cuisine: 'Lanches', eta: '20–30 min', emoji: '🍔', menu: [
   {id:'classic-burger', name:'Hambúrguer clássico', description:'Carne, queijo e molho', priceCents:2990, emoji:'🍔'}
 ]}
];
export function calculateCart(items: Array<{priceCents: number; quantity: number}>): number {
  return items.reduce((sum,item) => {
    if (!Number.isSafeInteger(item.priceCents) || item.priceCents < 0 || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) throw new Error('Invalid cart item');
    return sum + item.priceCents * item.quantity;
  }, 0);
}
