import { describe, expect, it } from 'vitest';
import { rankDemoDrivers, type DemoDriver } from './dispatch';

const nowMs = 1800000000000;
const pickup = { lat: -24.0057, lng: -46.4126 };
const base: DemoDriver = {
  id: 'near', label: 'Motorista fictício 01',
  point: { lat: -24.0058, lng: -46.413 },
  online: true, approved: true, available: true, lastSeenAtMs: nowMs - 1000,
};

describe('prototype dispatch ranking (no assignments)', () => {
  it('sorts eligible candidates by straight-line distance', () => {
    const other = { ...base, id: 'far', point: { lat: -24.02, lng: -46.43 } };
    const ranked = rankDemoDrivers(pickup, [other, base], { nowMs });
    expect(ranked.map(x => x.id)).toEqual(['near', 'far']);
    expect(ranked.every(x => x.simulated)).toBe(true);
  });
  it('rejects ineligible, stale and out-of-radius candidates', () => {
    const drivers = [
      { ...base, id: 'offline', online: false },
      { ...base, id: 'not-approved', approved: false },
      { ...base, id: 'busy', available: false },
      { ...base, id: 'stale', lastSeenAtMs: nowMs - 70_000 },
      { ...base, id: 'future', lastSeenAtMs: nowMs + 1000 },
      { ...base, id: 'far-away', point: { lat: 0, lng: 0 } },
      base,
    ];
    expect(rankDemoDrivers(pickup, drivers, { nowMs }).map(x => x.id)).toEqual(['near']);
  });
  it('limits ranked output and uses stable ID ties', () => {
    const a = { ...base, id: 'a' };
    const z = { ...base, id: 'z' };
    expect(rankDemoDrivers(pickup, [z, a], { nowMs, maxCandidates: 1 })[0].id).toBe('a');
  });
  it('rejects invalid input', () => {
    expect(() => rankDemoDrivers({ lat: 1000, lng: 0 }, [base])).toThrow();
    expect(() => rankDemoDrivers(pickup, [base], { maxRadiusKm: -2 })).toThrow();
  });
});
