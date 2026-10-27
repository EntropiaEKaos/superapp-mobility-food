-- Add auditable review metadata. Approval denotes only an accepted application;
-- it does NOT enable dispatch, payouts or a privileged account role.
ALTER TABLE "PartnerApplication" ADD COLUMN "reviewedAt" TIMESTAMP(3);
ALTER TABLE "PartnerApplication" ADD COLUMN "reviewerId" TEXT;
CREATE INDEX "PartnerApplication_reviewerId_idx" ON "PartnerApplication"("reviewerId");
ALTER TABLE "PartnerApplication" ADD CONSTRAINT "PartnerApplication_reviewerId_fkey"
 FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
