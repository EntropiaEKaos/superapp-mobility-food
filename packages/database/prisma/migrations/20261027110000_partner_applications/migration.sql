-- Partner onboarding: no automatic permissions, rides, dispatch or payments.
CREATE TYPE "PartnerKind" AS ENUM ('DRIVER', 'COURIER', 'RESTAURANT');
CREATE TYPE "PartnerApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "PartnerApplication" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" "PartnerKind" NOT NULL,
  "status" "PartnerApplicationStatus" NOT NULL DEFAULT 'PENDING',
  "displayName" TEXT NOT NULL,
  "city" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PartnerApplication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PartnerApplication_userId_kind_key" ON "PartnerApplication"("userId", "kind");
CREATE INDEX "PartnerApplication_status_createdAt_idx" ON "PartnerApplication"("status", "createdAt");
ALTER TABLE "PartnerApplication" ADD CONSTRAINT "PartnerApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
