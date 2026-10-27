CREATE TABLE "SandboxOutboxRequeueAudit" (
  "id" TEXT NOT NULL,
  "outboxId" BIGINT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SandboxOutboxRequeueAudit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SandboxOutboxRequeueAudit_outboxId_createdAt_idx"
  ON "SandboxOutboxRequeueAudit"("outboxId", "createdAt");
CREATE INDEX "SandboxOutboxRequeueAudit_actorUserId_createdAt_idx"
  ON "SandboxOutboxRequeueAudit"("actorUserId", "createdAt");
