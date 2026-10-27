-- Durable sandbox change notices, inserted atomically with fictitious sandbox writes.
CREATE TYPE "SandboxOutboxStatus" AS ENUM ('PENDING', 'PUBLISHED');

CREATE TABLE "SandboxEventOutbox" (
  "id" BIGSERIAL NOT NULL,
  "status" "SandboxOutboxStatus" NOT NULL DEFAULT 'PENDING',
  "sourceTable" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedAt" TIMESTAMP(3),
  CONSTRAINT "SandboxEventOutbox_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SandboxEventOutbox_status_id_idx" ON "SandboxEventOutbox"("status", "id");
CREATE INDEX "SandboxEventOutbox_createdAt_idx" ON "SandboxEventOutbox"("createdAt");

-- Keep the existing PostgreSQL SSE signal and insert a durable PENDING row.
-- Statement-level trigger fires only after an actual INSERT/UPDATE/DELETE statement,
-- but both the outbox insert and original data modification roll back together.
CREATE OR REPLACE FUNCTION "notify_sandbox_change"()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "SandboxEventOutbox" ("sourceTable", "operation")
  VALUES (TG_TABLE_NAME, TG_OP);
  PERFORM pg_notify('superapp_sandbox_changed', 'changed');
  RETURN NULL;
END;
$$;
