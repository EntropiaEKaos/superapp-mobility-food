import { db } from '@superapp/database';
import { sandboxSnapshot } from './sandbox-dispatch';
import { getSandboxStreamHealth } from './sandbox-stream-capacity';
import { getRedisSandboxStreamHealth } from './sandbox-redis-transport';

export const SANDBOX_RIDE_STATUSES = [
  'REQUESTED', 'OFFERED', 'ACCEPTED', 'ARRIVING',
  'IN_PROGRESS', 'COMPLETED', 'CANCELED', 'EXPIRED',
] as const;

export type SandboxStatus = (typeof SANDBOX_RIDE_STATUSES)[number];
export type Diagnostic = {
  code: 'OVERDUE_OFFER' | 'MISSING_WINNER' | 'EVENT_GAP' | 'STUCK_RIDE';
  rideId: string;
  message: string;
  severity: 'warning' | 'critical';
};

type RideForDiagnostics = {
  id: string;
  status: SandboxStatus;
  createdAt: Date | string;
  acceptedDriverId: string | null;
  version: number;
  events: readonly { sequence: number }[];
  offers: readonly { status: string; expiresAt: Date | string }[];
};

/** Deterministic read-only checks against the visible recent-ride sample. */
export function findSandboxDiagnostics(
  rides: readonly RideForDiagnostics[], nowMs: number,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const currentlyAssigned = new Set<SandboxStatus>(['ACCEPTED', 'ARRIVING', 'IN_PROGRESS']);
  for (const ride of rides) {
    if (currentlyAssigned.has(ride.status) && !ride.acceptedDriverId) {
      diagnostics.push({
        code: 'MISSING_WINNER', rideId: ride.id, severity: 'critical',
        message: 'Corrida ativa sem veículo vencedor',
      });
    }
    if (ride.status === 'OFFERED' && ride.offers.some(offer =>
      offer.status === 'PENDING' && new Date(offer.expiresAt).getTime() < nowMs
    )) {
      diagnostics.push({
        code: 'OVERDUE_OFFER', rideId: ride.id, severity: 'warning',
        message: 'Oferta pendente com prazo encerrado — executar expiração',
      });
    }
    if (ride.events.length > 0 && (
      ride.events[0].sequence !== 1 ||
      ride.events.some((event, index) => event.sequence !== index + 1) ||
      ride.events[ride.events.length - 1].sequence !== ride.version
    )) {
      diagnostics.push({
        code: 'EVENT_GAP', rideId: ride.id, severity: 'critical',
        message: 'Inconsistência entre sequência de eventos e versão da corrida',
      });
    }
    if (currentlyAssigned.has(ride.status) &&
        nowMs - new Date(ride.createdAt).getTime() > 30 * 60_000) {
      diagnostics.push({
        code: 'STUCK_RIDE', rideId: ride.id, severity: 'warning',
        message: 'Corrida simulada ativa há mais de 30 minutos',
      });
    }
  }
  return diagnostics;
}

export async function sandboxOperationsSnapshot() {
  const snapshot = await sandboxSnapshot();
  const now = new Date();
  const staleBefore = new Date(now.getTime() - 60_000);
  // Metrics cover all sandbox records, unlike the bounded list of recent rides.
  const [statusGroups, totalDrivers, freeDrivers, busyDrivers, staleDrivers,
    pendingOffers, overdueOffers, eventCount, recentEvents] = await Promise.all([
    db().sandboxRide.groupBy({ by: ['status'], _count: { _all: true } }),
    db().sandboxDriver.count(),
    db().sandboxDriver.count({ where: { active: true, busy: false, lastSeenAt: { gte: staleBefore } } }),
    db().sandboxDriver.count({ where: { busy: true } }),
    db().sandboxDriver.count({ where: { active: true, lastSeenAt: { lt: staleBefore } } }),
    db().sandboxRideOffer.count({ where: { status: 'PENDING' } }),
    db().sandboxRideOffer.count({ where: { status: 'PENDING', expiresAt: { lt: now } } }),
    db().sandboxRideEvent.count(),
    db().sandboxRideEvent.findMany({
      take: 12, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, sequence: true, type: true, createdAt: true,
        ride: { select: { id: true, pickupLabel: true, dropoffLabel: true } } },
    }),
  ]);
  const counts = Object.fromEntries(
    SANDBOX_RIDE_STATUSES.map(status => [
      status, statusGroups.find(group => group.status === status)?._count._all ?? 0,
    ]),
  ) as Record<SandboxStatus, number>;
  const totalRides = Object.values(counts).reduce((sum, quantity) => sum + quantity, 0);
  const streamHealth = process.env.SANDBOX_EVENT_TRANSPORT === 'redis'
    ? await getRedisSandboxStreamHealth()
    : { ...(await getSandboxStreamHealth()), transport: 'postgres' as const };

  return {
    ...snapshot,
    generatedAt: now.toISOString(),
    streamHealth,
    recentLimit: 20,
    metrics: {
      ridesByStatus: counts,
      totalRides,
      activeRides: counts.ACCEPTED + counts.ARRIVING + counts.IN_PROGRESS,
      waitingRides: counts.REQUESTED + counts.OFFERED,
      completedRides: counts.COMPLETED,
      totalDrivers, freeDrivers, busyDrivers, staleDrivers,
      pendingOffers, overdueOffers, eventCount,
    },
    diagnostics: findSandboxDiagnostics(snapshot.rides, now.getTime()),
    recentEvents,
  };
}

export type SandboxOperationsSnapshot = Awaited<ReturnType<typeof sandboxOperationsSnapshot>>;
