-- Strictly isolated demonstration tables. Never connect these to real ride orders.
CREATE TYPE "SandboxRideStatus" AS ENUM ('REQUESTED','OFFERED','ACCEPTED','EXPIRED','COMPLETED','CANCELED');
CREATE TYPE "SandboxOfferStatus" AS ENUM ('PENDING','ACCEPTED','DECLINED','EXPIRED');

CREATE TABLE "SandboxDriver" (
  "id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "lat" DOUBLE PRECISION NOT NULL,
  "lng" DOUBLE PRECISION NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "busy" BOOLEAN NOT NULL DEFAULT false,
  "lastSeenAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SandboxDriver_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SandboxRide" (
  "id" TEXT NOT NULL,
  "pickupLabel" TEXT NOT NULL,
  "dropoffLabel" TEXT NOT NULL,
  "pickupLat" DOUBLE PRECISION NOT NULL,
  "pickupLng" DOUBLE PRECISION NOT NULL,
  "status" "SandboxRideStatus" NOT NULL DEFAULT 'REQUESTED',
  "acceptedDriverId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SandboxRide_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SandboxRideOffer" (
  "id" TEXT NOT NULL,
  "rideId" TEXT NOT NULL,
  "driverId" TEXT NOT NULL,
  "status" "SandboxOfferStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SandboxRideOffer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SandboxDriver_active_busy_lastSeenAt_idx" ON "SandboxDriver"("active","busy","lastSeenAt");
CREATE INDEX "SandboxRide_status_createdAt_idx" ON "SandboxRide"("status","createdAt");
CREATE INDEX "SandboxRide_acceptedDriverId_idx" ON "SandboxRide"("acceptedDriverId");
CREATE UNIQUE INDEX "SandboxRideOffer_rideId_driverId_key" ON "SandboxRideOffer"("rideId","driverId");
CREATE INDEX "SandboxRideOffer_rideId_status_expiresAt_idx" ON "SandboxRideOffer"("rideId","status","expiresAt");
CREATE INDEX "SandboxRideOffer_driverId_status_idx" ON "SandboxRideOffer"("driverId","status");

ALTER TABLE "SandboxRide" ADD CONSTRAINT "SandboxRide_acceptedDriverId_fkey"
  FOREIGN KEY ("acceptedDriverId") REFERENCES "SandboxDriver"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SandboxRideOffer" ADD CONSTRAINT "SandboxRideOffer_rideId_fkey"
  FOREIGN KEY ("rideId") REFERENCES "SandboxRide"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SandboxRideOffer" ADD CONSTRAINT "SandboxRideOffer_driverId_fkey"
  FOREIGN KEY ("driverId") REFERENCES "SandboxDriver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
