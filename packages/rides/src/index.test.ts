import { describe, expect, it } from 'vitest';
import { estimateRide, haversineKm, isGeoPoint } from './index';
describe('rides foundation', () => {
  it('rejects invalid coordinates', () => expect(isGeoPoint({lat: 120,lng: 0})).toBe(false));
  it('calculates zero distance', () => expect(haversineKm({lat: 0,lng: 0},{lat: 0,lng: 0})).toBe(0));
  it('prices comfort above economy', () => {
    const a={lat:-24.01,lng:-46.42}, b={lat:-24.03,lng:-46.43};
    expect(estimateRide(a,b,'comfort').estimatedFareCents).toBeGreaterThan(estimateRide(a,b).estimatedFareCents);
  });
});
