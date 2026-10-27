-- Sprint 14: retry metadata and dead-letter state for the fictitious sandbox outbox.
ALTER TYPE "SandboxOutboxStatus" ADD VALUE 'DEAD';
ALTER TABLE "SandboxEventOutbox"
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "lastErrorCode" TEXT;
CREATE INDEX "SandboxEventOutbox_status_nextAttemptAt_id_idx"
  ON "SandboxEventOutbox"("status", "nextAttemptAt", "id");
