export type GeoPoint = { lat: number; lng: number };
export type RideCategory = 'economy' | 'comfort';
export type RideEstimate = { straightLineKm: number; estimatedFareCents: number; category: RideCategory; demo: true };
export function isGeoPoint(p: unknown): p is GeoPoint {
  if (!p || typeof p !== 'object') return false;
  const v = p as Record<string, unknown>;
  return typeof v.lat === 'number' && Number.isFinite(v.lat) && v.lat >= -90 && v.lat <= 90 &&
    typeof v.lng === 'number' && Number.isFinite(v.lng) && v.lng >= -180 && v.lng <= 180;
}
/** Straight-line Haversine estimate: NOT a real road distance or binding price. */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  if (!isGeoPoint(a) || !isGeoPoint(b)) throw new Error('Invalid geographic coordinates');
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat/2)**2 + Math.cos(a.lat*rad) * Math.cos(b.lat*rad) * Math.sin(dLng/2)**2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
export function estimateRide(origin: GeoPoint, destination: GeoPoint, category: RideCategory = 'economy'): RideEstimate {
  if (category !== 'economy' && category !== 'comfort') throw new Error('Invalid category');
  const km = haversineKm(origin, destination);
  const multiplier = category === 'comfort' ? 1.4 : 1;
  return { straightLineKm: Number(km.toFixed(2)), estimatedFareCents: Math.round((650 + km*280) * multiplier), category, demo: true };
}
