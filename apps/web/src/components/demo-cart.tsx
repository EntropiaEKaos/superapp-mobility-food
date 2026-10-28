'use client';

import { useState } from 'react';
import { Minus, Plus, ShoppingBag, ShieldCheck, Trash2, ArrowRight } from 'lucide-react';
import type { DemoMenuItem } from '@superapp/food';
import { calculateCart } from '@superapp/food';
import { brl } from '@/lib/format';

type Props = { restaurantName: string; menu: DemoMenuItem[] };
type Quantities = Record<string, number>;

/** Demonstration only: the cart never calls a backend or collects payment details. */
export function DemoCart({ restaurantName, menu }: Props) {
  const [quantities, setQuantities] = useState<Quantities>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [reviewOpen, setReviewOpen] = useState(false);
  const selected = menu.filter(item => (quantities[item.id] ?? 0) > 0);
  const totalCents = calculateCart(selected.map(item => ({
    priceCents: item.priceCents,
    quantity: quantities[item.id],
  })));
  const totalItems = selected.reduce((sum, item) => sum + quantities[item.id], 0);

  function clearCart() { setQuantities({}); setNotes({}); setReviewOpen(false); }

  function changeQuantity(id: string, delta: number) {
    setQuantities(previous => ({
      ...previous,
      [id]: Math.min(20, Math.max(0, (previous[id] ?? 0) + delta)),
    }));
  }

  return (
    <div className="menu-layout">
      <div className="menu-list" aria-label="Itens do cardápio">
        {menu.map(item => {
          const quantity = quantities[item.id] ?? 0;
          return (
            <article key={item.id} className="menu-item">
              <span className="menu-emoji" aria-hidden="true">{item.emoji}</span>
              <div className="menu-details">
                <h3>{item.name}</h3>
                <p>{item.description}</p>
                <strong>{brl(item.priceCents)}</strong>
                <div className="quantity-controls" role="group" aria-label={`Quantidade de ${item.name}`}>
                  <button type="button" onClick={() => changeQuantity(item.id, -1)} disabled={quantity === 0} aria-label={`Remover uma unidade de ${item.name}`}><Minus size={16}/></button>
                  <span aria-live="polite">{quantity}</span>
                  <button type="button" onClick={() => changeQuantity(item.id, 1)} disabled={quantity >= 20} aria-label={`Adicionar uma unidade de ${item.name}`}><Plus size={16}/></button>
                </div>
                {quantity > 0 && <label className="demo-note-label" htmlFor={`note-${item.id}`}>Observações para {item.name}
                  <textarea id={`note-${item.id}`} maxLength={200} rows={2} placeholder="Ex.: sem cebola (somente simulação)" value={notes[item.id] ?? ''} onChange={e => setNotes(previous => ({...previous, [item.id]:e.target.value}))}/>
                </label>}
              </div>
            </article>
          );
        })}
      </div>
      <aside className="demo-cart" aria-label="Carrinho demonstrativo">
        <div className="cart-heading"><ShoppingBag size={22}/><h2>Meu carrinho</h2>{totalItems > 0 && <span className="sprint21-cart-badge" aria-label={`${totalItems} itens no carrinho`}>{totalItems}</span>}</div>
        <p className="cart-subtitle">{restaurantName} • somente demonstração</p>
        {selected.length === 0 ? (
          <p className="cart-empty">Seu carrinho está vazio. Adicione produtos para simular um pedido.</p>
        ) : (
          <ul className="cart-lines">
            {selected.map(item => (
              <li key={item.id}>
                <span>{quantities[item.id]}× {item.name}{notes[item.id]?.trim() && <small className="demo-cart-note">Obs.: {notes[item.id].trim()}</small>}</span>
                <strong>{brl(item.priceCents * quantities[item.id])}</strong>
              </li>
            ))}
          </ul>
        )}
        <div className="cart-total" aria-live="polite"><span>Subtotal ({totalItems} itens)</span><strong>{brl(totalCents)}</strong></div>{totalItems > 0 && <div className="sprint21-cart-actions"><button className="sprint21-clear" type="button" onClick={clearCart}><Trash2 size={16}/> Limpar carrinho</button><button className="sprint21-fake-checkout" type="button" aria-expanded={reviewOpen} aria-controls="demo-order-review" onClick={() => setReviewOpen(open => !open)}><span>{reviewOpen ? "Ocultar resumo" : "Revisar pedido demo"}</span><ArrowRight size={17}/></button></div>}
        {reviewOpen && totalItems > 0 && <section id="demo-order-review" aria-label="Resumo do pedido demonstrativo" className="demo-order-review">
          <h3>Resumo do pedido — demonstração</h3>
          <p>{restaurantName}</p>
          <ul>{selected.map(item => <li key={item.id}>{quantities[item.id]}× {item.name} — {brl(item.priceCents * quantities[item.id])}{notes[item.id]?.trim() && <small className="demo-cart-note">Obs.: {notes[item.id].trim()}</small>}</li>)}</ul>
          <strong>Total ilustrativo: {brl(totalCents)}</strong>
          <p>Esta é uma prévia local. Nenhum pedido é enviado e nenhum pagamento é solicitado.</p>
        </section>}
        <div className="cart-note"><ShieldCheck size={17}/><span>Valores simulados. Nenhum pedido é enviado, e nenhum pagamento é realizado.</span></div>
      </aside>
    </div>
  );
}
