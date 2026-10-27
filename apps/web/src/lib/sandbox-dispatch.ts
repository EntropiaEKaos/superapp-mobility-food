import { db } from '@superapp/database';
import { rankDemoDrivers } from '@superapp/rides';

export class SandboxConflict extends Error {
  readonly status = 409;
}

export const sandboxLocations = {
  boqueirao: { label: 'Boqueirão (simulação)', lat: -24.0057, lng: -46.4126 },
  guilhermina: { label: 'Guilhermina (simulação)', lat: -24.0050, lng: -46.4290 },
  ocian: { label: 'Ocian (simulação)', lat: -24.0282, lng: -46.4756 },
  caicara: { label: 'Caiçara (simulação)', lat: -24.0411, lng: -46.5094 },
} as const;
export type SandboxLocationId = keyof typeof sandboxLocations;

export function validLocation(value: unknown): value is SandboxLocationId {
  return typeof value === 'string' && Object.hasOwn(sandboxLocations, value);
}

export const sandboxDrivers = [
  { id: 'sandbox-alpha', label: 'Veículo Alpha (fictício)', lat: -24.0061, lng: -46.4132 },
  { id: 'sandbox-bravo', label: 'Veículo Bravo (fictício)', lat: -24.0070, lng: -46.4164 },
  { id: 'sandbox-charlie', label: 'Veículo Charlie (fictício)', lat: -24.0100, lng: -46.4212 },
] as const;

/** Feature gate is deliberately OFF unless explicitly opted in. */
export function sandboxEnabled(): boolean {
  return process.env.ENABLE_SANDBOX_DISPATCH === 'true';
}

export async function seedSandbox() {
  const now = new Date();
  for (const fixture of sandboxDrivers) {
    await db().sandboxDriver.upsert({
      where: { id: fixture.id },
      create: { ...fixture, active: true, busy: false, lastSeenAt: now },
      update: { lastSeenAt: now },
    });
  }
  return sandboxDrivers.length;
}

export async function createSandboxRide(origin: SandboxLocationId, destination: SandboxLocationId) {
  if (origin === destination) throw new SandboxConflict('Origem e destino devem ser diferentes.');
  const pickup = sandboxLocations[origin];
  return db().$transaction(async tx => {
    const ride = await tx.sandboxRide.create({
      data: {
        pickupLabel: pickup.label,
        dropoffLabel: sandboxLocations[destination].label,
        pickupLat: pickup.lat,
        pickupLng: pickup.lng,
        dropoffLat: sandboxLocations[destination].lat,
        dropoffLng: sandboxLocations[destination].lng,
        version: 1,
      },
    });
    await tx.sandboxRideEvent.create({
      data: { rideId: ride.id, sequence: 1, type: 'CREATED',
        toStatus: 'REQUESTED', latitude: pickup.lat, longitude: pickup.lng },
    });
    return ride;
  }, { isolationLevel: 'Serializable' });
}

/** Two independent offers per ride, all fictitious, no GPS, money or actual dispatch. */
export async function issueSandboxOffers(rideId: string) {
  const ride = await db().sandboxRide.findUnique({ where: { id: rideId } });
  if (!ride || ride.status !== 'REQUESTED') throw new SandboxConflict('Corrida indisponível para ofertas.');

  const now = new Date();
  const eligible = await db().sandboxDriver.findMany({
    where: { active: true, busy: false, lastSeenAt: { gte: new Date(now.getTime() - 60_000) } },
    take: 100,
  });
  const ranked = rankDemoDrivers(
    { lat: ride.pickupLat, lng: ride.pickupLng },
    eligible.map(d => ({
      id: d.id, label: d.label, point: { lat: d.lat, lng: d.lng },
      online: d.active, approved: true, available: !d.busy, lastSeenAtMs: d.lastSeenAt.getTime(),
    })),
    { nowMs: now.getTime(), maxRadiusKm: 8, maxCandidates: 2 },
  );
  if (!ranked.length) throw new SandboxConflict('Nenhum veículo fictício elegível.');

  try {
    return await db().$transaction(async tx => {
      const changed = await tx.sandboxRide.updateMany({ where: { id: rideId, status: 'REQUESTED' }, data: { status: 'OFFERED', version: { increment: 1 } } });
      if (changed.count !== 1) throw new SandboxConflict('Ofertas já emitidas para esta corrida.');
      await tx.sandboxRideEvent.create({
        data: { rideId, sequence: ride.version + 1, type: 'OFFERED',
          fromStatus: 'REQUESTED', toStatus: 'OFFERED' },
      });
      await tx.sandboxRideOffer.createMany({
        data: ranked.map(driver => ({
          rideId, driverId: driver.id,
          expiresAt: new Date(now.getTime() + 30_000),
        })),
      });
      return tx.sandboxRide.findUnique({ where: { id: rideId }, include: { offers: { include: { driver: true } } } });
    }, { isolationLevel: 'Serializable' });
  } catch {
    throw new SandboxConflict('Emissão concorrente ou inválida; nenhuma oferta duplicada foi criada.');
  }
}

/**
 * Compare-and-set of offer, ride and simulated driver inside ONE serializable transaction.
 * Losing concurrent requests roll back all writes (including the offer status).
 */
export async function acceptSandboxOffer(offerId: string) {
  try {
    return await db().$transaction(async tx => {
      const offer = await tx.sandboxRideOffer.findUnique({ where: { id: offerId } });
      const now = new Date();
      if (!offer || offer.status !== 'PENDING' || offer.expiresAt <= now) {
        throw new SandboxConflict('Oferta inexistente, expirada ou já decidida.');
      }
      const claimOffer = await tx.sandboxRideOffer.updateMany({
        where: { id: offerId, status: 'PENDING', expiresAt: { gt: now } },
        data: { status: 'ACCEPTED' },
      });
      if (claimOffer.count !== 1) throw new SandboxConflict('Oferta já aceita ou expirada.');

      const claimRide = await tx.sandboxRide.updateMany({
        where: { id: offer.rideId, status: 'OFFERED', acceptedDriverId: null },
        data: { status: 'ACCEPTED', acceptedDriverId: offer.driverId,
          trackingLat: null, trackingLng: null, progressStep: 0, version: { increment: 1 } },
      });
      if (claimRide.count !== 1) throw new SandboxConflict('Outra oferta venceu esta corrida.');

      const reserveDriver = await tx.sandboxDriver.updateMany({
        where: { id: offer.driverId, active: true, busy: false, lastSeenAt: { gte: new Date(now.getTime() - 60_000) } },
        data: { busy: true },
      });
      if (reserveDriver.count !== 1) throw new SandboxConflict('Veículo fictício não está livre.');

      await tx.sandboxRide.update({ where: { id: offer.rideId },
        data: { trackingLat: (await tx.sandboxDriver.findUniqueOrThrow({ where: { id: offer.driverId } })).lat,
          trackingLng: (await tx.sandboxDriver.findUniqueOrThrow({ where: { id: offer.driverId } })).lng } });
      const updatedRide = await tx.sandboxRide.findUnique({ where: { id: offer.rideId } });
      await tx.sandboxRideEvent.create({
        data: { rideId: offer.rideId, sequence: updatedRide!.version, type: 'ACCEPTED',
          fromStatus: 'OFFERED', toStatus: 'ACCEPTED',
          latitude: null, longitude: null },
      });
      await tx.sandboxRideOffer.updateMany({
        where: { rideId: offer.rideId, id: { not: offerId }, status: 'PENDING' },
        data: { status: 'DECLINED' },
      });
      return tx.sandboxRide.findUnique({ where: { id: offer.rideId }, include: { offers: true, acceptedDriver: true } });
    }, { isolationLevel: 'Serializable' });
  } catch {
    throw new SandboxConflict('Oferta já decidida, vencida ou em conflito com outra aceitação.');
  }
}

/** Manual virtual-clock expiry, so no background workers are needed in Sprint 06. */
export async function expireSandboxOffers(rideId: string, advanceSeconds = 0) {
  const now = new Date(Date.now() + advanceSeconds * 1000);
  try {
    return await db().$transaction(async tx => {
      const ride = await tx.sandboxRide.findUnique({ where: { id: rideId } });
      if (!ride || ride.status !== 'OFFERED') throw new SandboxConflict('A corrida não tem ofertas pendentes.');
      await tx.sandboxRideOffer.updateMany({
        where: { rideId, status: 'PENDING', expiresAt: { lte: now } },
        data: { status: 'EXPIRED' },
      });
      const pending = await tx.sandboxRideOffer.count({ where: { rideId, status: 'PENDING' } });
      if (pending === 0) {
        const changed = await tx.sandboxRide.updateMany({
          where: { id: rideId, status: 'OFFERED', version: ride.version },
          data: { status: 'EXPIRED', version: { increment: 1 } },
        });
        if (changed.count !== 1) throw new SandboxConflict('Outra atualização foi confirmada.');
        await tx.sandboxRideEvent.create({
          data: { rideId, sequence: ride.version + 1, type: 'EXPIRED',
            fromStatus: 'OFFERED', toStatus: 'EXPIRED' },
        });
      }
      return tx.sandboxRide.findUnique({ where: { id: rideId }, include: { offers: true } });
    }, { isolationLevel: 'Serializable' });
  } catch {
    throw new SandboxConflict('Não foi possível expirar esta corrida.');
  }
}

export async function completeSandboxRide(rideId: string) {
  // Compatibility wrapper: full journey must reach IN_PROGRESS + 5 waypoints.
  const { transitionSandboxJourney } = await import('./sandbox-journey');
  return transitionSandboxJourney(rideId, 'complete');
}

export async function resetSandbox() {
  await db().$transaction(async tx => {
    await tx.sandboxRideOffer.deleteMany();
    await tx.sandboxRide.deleteMany();
    await tx.sandboxDriver.deleteMany();
  }, { isolationLevel: 'Serializable' });
}

export async function sandboxSnapshot() {
  const [drivers, rides] = await Promise.all([
    db().sandboxDriver.findMany({ orderBy: { id: 'asc' } }),
    db().sandboxRide.findMany({
      orderBy: { createdAt: 'desc' }, take: 20,
      include: { offers: { include: { driver: { select: { label: true } } }, orderBy: { createdAt: 'asc' } },
        acceptedDriver: { select: { label: true } },
        events: { orderBy: { sequence: 'asc' } } },
    }),
  ]);
  return { demo: true as const, drivers, rides };
}
