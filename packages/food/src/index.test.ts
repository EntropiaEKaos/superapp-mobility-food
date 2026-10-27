import { describe, expect, it } from 'vitest';
import { calculateCart, demoRestaurants } from './index';
describe('food foundation', () => {
  it('provides demo fixtures', () => expect(demoRestaurants.length).toBe(3));
  it('adds prices in cents', () => expect(calculateCart([{priceCents:2500,quantity:2},{priceCents:300,quantity:1}])).toBe(5300));
  it('rejects illegal quantity', () => expect(()=>calculateCart([{priceCents:200,quantity:0}])).toThrow());
});
