import { db } from '@superapp/database';
import { SandboxConflict } from './sandbox-dispatch';

export type SandboxJourneyAction = 'arrive' | 'start' | 'complete' | 'cancel';

const transitionRules = {
  arrive: { from: ['ACCEPTED'], to: 'ARRIVING', event: 'ARRIVING' },
  start: { from: ['ARRIVING'], to: 'IN_PROGRESS', event: 'IN_PROGRESS' },
  complete: { from: ['IN_PROGRESS'], to: 'COMPLETED', event: 'COMPLETED' },
  cancel: { from: ['REQUESTED', 'OFFERED', 'ACCEPTED', 'ARRIVING'], to: 'CANCELED', event: 'CANCELED' },
} as const;

/**
 * Explicit state machine inside a Serializable transaction.
 * Uses a version compare-and-set before inserting an event with an immutable sequence.
 * In this lab, all actions are admin-only through the guarded API.
 */
export async function transitionSandboxJourney(rideId: string, action: SandboxJourneyAction) {
  try {
    return await db().$transaction(async tx => {
      const ride = await tx.sandboxRide.findUnique({ where: { id: rideId } });
      const rule = transitionRules[action];
      if (!ride || !rule.from.some(from => from === ride.status)) {
        throw new SandboxConflict('Transição inválida para o estado atual.');
      }
      // A simulated stage must reach its final waypoint before changing stages.
      if ((action === 'start' || action === 'complete') && ride.progressStep !== 5) {
        throw new SandboxConflict('Complete os cinco passos da etapa simulada antes de avançar.');
      }
      const driver = ride.acceptedDriverId
        ? await tx.sandboxDriver.findUnique({ where: { id: ride.acceptedDriverId } }) : null;
      if (action !== 'cancel' && !driver) throw new SandboxConflict('Veículo fictício não reservado.');

      const tracking = action === 'start'
        ? { trackingLat: ride.pickupLat, trackingLng: ride.pickupLng, progressStep: 0 }
        : action === 'complete'
        ? { trackingLat: ride.dropoffLat, trackingLng: ride.dropoffLng, progressStep: 5 }
        : action === 'arrive'
        ? { trackingLat: ride.trackingLat ?? driver!.lat, trackingLng: ride.trackingLng ?? driver!.lng, progressStep: 0 }
        : {};

      const updated = await tx.sandboxRide.updateMany({
        where: { id: rideId, status: ride.status, version: ride.version },
        data: { status: rule.to, version: { increment: 1 }, ...tracking },
      });
      if (updated.count !== 1) throw new SandboxConflict('Outra transição já foi confirmada.');

      if (action === 'cancel') {
        await tx.sandboxRideOffer.updateMany({
          where: { rideId, status: 'PENDING' },
          data: { status: 'DECLINED' },
        });
      }
      if ((action === 'cancel' || action === 'complete') && ride.acceptedDriverId) {
        await tx.sandboxDriver.update({ where: { id: ride.acceptedDriverId }, data: { busy: false } });
      }
      await tx.sandboxRideEvent.create({
        data: {
          rideId, sequence: ride.version + 1, type: rule.event,
          fromStatus: ride.status, toStatus: rule.to,
          progressStep: 'progressStep' in tracking ? tracking.progressStep : ride.progressStep,
          latitude: 'trackingLat' in tracking ? tracking.trackingLat : ride.trackingLat,
          longitude: 'trackingLng' in tracking ? tracking.trackingLng : ride.trackingLng,
        },
      });
      return tx.sandboxRide.findUnique({
        where: { id: rideId },
        include: { events: { orderBy: { sequence: 'asc' } }, acceptedDriver: true },
      });
    }, { isolationLevel: 'Serializable' });
  } catch {
    throw new SandboxConflict('Transição rejeitada: estado inválido ou operação concorrente.');
  }
}

const lerp = (a: number, b: number, fraction: number) =>
  Number((a + (b - a) * fraction).toFixed(7));

/** One deterministic waypoint per call. Never reads or writes actual GPS coordinates. */
export async function advanceSandboxTracking(rideId: string) {
  try {
    return await db().$transaction(async tx => {
      const ride = await tx.sandboxRide.findUnique({ where: { id: rideId } });
      if (!ride || (ride.status !== 'ARRIVING' && ride.status !== 'IN_PROGRESS') ||
          !ride.acceptedDriverId || ride.progressStep >= 5) {
        throw new SandboxConflict('Esta etapa não admite novos passos.');
      }
      const driver = await tx.sandboxDriver.findUnique({ where: { id: ride.acceptedDriverId } });
      if (!driver) throw new SandboxConflict('Veículo fictício não encontrado.');
      if (ride.status === 'IN_PROGRESS' && (ride.dropoffLat === null || ride.dropoffLng === null)) {
        throw new SandboxConflict('Destino não georreferenciado no laboratório.');
      }

      const nextStep = ride.progressStep + 1;
      const portion = nextStep / 5;
      const startLat = ride.status === 'ARRIVING' ? driver.lat : ride.pickupLat;
      const startLng = ride.status === 'ARRIVING' ? driver.lng : ride.pickupLng;
      const targetLat = ride.status === 'ARRIVING' ? ride.pickupLat : ride.dropoffLat!;
      const targetLng = ride.status === 'ARRIVING' ? ride.pickupLng : ride.dropoffLng!;
      const lat = lerp(startLat, targetLat, portion);
      const lng = lerp(startLng, targetLng, portion);

      const changed = await tx.sandboxRide.updateMany({
        where: { id: rideId, status: ride.status, version: ride.version, progressStep: ride.progressStep },
        data: { progressStep: nextStep, trackingLat: lat, trackingLng: lng, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new SandboxConflict('Outro avanço de localização venceu.');
      await tx.sandboxRideEvent.create({
        data: {
          rideId, sequence: ride.version + 1, type: 'LOCATION_UPDATED',
          fromStatus: ride.status, toStatus: ride.status,
          progressStep: nextStep, latitude: lat, longitude: lng,
        },
      });
      return tx.sandboxRide.findUnique({
        where: { id: rideId },
        include: { events: { orderBy: { sequence: 'asc' } } },
      });
    }, { isolationLevel: 'Serializable' });
  } catch {
    throw new SandboxConflict('Passo rejeitado: etapa concluída ou atualização concorrente.');
  }
}
