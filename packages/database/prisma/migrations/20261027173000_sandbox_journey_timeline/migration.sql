-- Sprint 07: isolated sandbox journey transitions and append-only timeline.
-- Nullable destinations preserve older sandbox fixture records; new rides populate both.
CREATE TYPE "SandboxRideEventType" AS ENUM (
  'CREATED', 'OFFERED', 'ACCEPTED', 'ARRIVING', 'IN_PROGRESS',
  'LOCATION_UPDATED', 'COMPLETED', 'CANCELED', 'EXPIRED'
);

ALTER TABLE "SandboxRide"
  ADD COLUMN "dropoffLat" DOUBLE PRECISION,
  ADD COLUMN "dropoffLng" DOUBLE PRECISION,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "progressStep" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "trackingLat" DOUBLE PRECISION,
  ADD COLUMN "trackingLng" DOUBLE PRECISION;

CREATE TABLE "SandboxRideEvent" (
  "id" TEXT NOT NULL,
  "rideId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "type" "SandboxRideEventType" NOT NULL,
  "fromStatus" TEXT,
  "toStatus" TEXT,
  "progressStep" INTEGER,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SandboxRideEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SandboxRideEvent_rideId_sequence_key" ON "SandboxRideEvent"("rideId", "sequence");
CREATE INDEX "SandboxRideEvent_rideId_createdAt_idx" ON "SandboxRideEvent"("rideId", "createdAt");
ALTER TABLE "SandboxRideEvent"
  ADD CONSTRAINT "SandboxRideEvent_rideId_fkey"
  FOREIGN KEY ("rideId") REFERENCES "SandboxRide"("id") ON DELETE CASCADE ON UPDATE CASCADE;
