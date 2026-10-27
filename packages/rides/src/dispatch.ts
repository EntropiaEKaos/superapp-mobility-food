import { haversineKm, isGeoPoint, type GeoPoint } from './index';

export type DemoDriver = {
  id: string;
  label: string;
  point: GeoPoint;
  online: boolean;
  approved: boolean;
  available: boolean;
  lastSeenAtMs: number;
};

export type RankedDemoDriver = {
  id: string;
  label: string;
  straightLineKm: number;
  simulated: true;
};
export type DemoDispatchOptions = {
  maxRadiusKm?: number;
  maxCandidates?: number;
  maxLocationAgeMs?: number;
  nowMs?: number;
};

/**
 * Pure candidate-ranking prototype, not dispatch.
 * No mutation, live positioning, ride acceptance or notifications.
 */
export function rankDemoDrivers(
  pickup: GeoPoint,
  candidates: readonly DemoDriver[],
  options: DemoDispatchOptions = {},
): RankedDemoDriver[] {
  if (!isGeoPoint(pickup)) throw new Error('Invalid pickup point');
  const nowMs = options.nowMs ?? Date.now();
  const maxRadiusKm = options.maxRadiusKm ?? 8;
  const maxCandidates = options.maxCandidates ?? 5;
  const maxLocationAgeMs = options.maxLocationAgeMs ?? 60_000;
  if (!Number.isFinite(nowMs) ||
    !Number.isFinite(maxRadiusKm) || maxRadiusKm <= 0 || maxRadiusKm > 100 ||
    !Number.isSafeInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 100 ||
    !Number.isSafeInteger(maxLocationAgeMs) || maxLocationAgeMs < 1000 || maxLocationAgeMs > 300_000) {
    throw new Error('Invalid dispatch options');
  }

  return candidates.filter(driver => (
    driver.online && driver.approved && driver.available &&
    isGeoPoint(driver.point) && Number.isFinite(driver.lastSeenAtMs) &&
    driver.lastSeenAtMs <= nowMs &&
    nowMs - driver.lastSeenAtMs <= maxLocationAgeMs
  )).map(driver => ({
    id: driver.id,
    label: driver.label,
    straightLineKm: haversineKm(pickup, driver.point),
    simulated: true as const,
  }))
    .filter(driver => driver.straightLineKm <= maxRadiusKm)
    .sort((a, b) => a.straightLineKm - b.straightLineKm || a.id.localeCompare(b.id))
    .slice(0, maxCandidates)
    .map(driver => ({ ...driver, straightLineKm: Number(driver.straightLineKm.toFixed(2)) }));
}
