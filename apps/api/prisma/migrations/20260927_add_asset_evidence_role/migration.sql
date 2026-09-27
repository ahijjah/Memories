-- CreateEnum: explicit evidence role for user-uploaded assets (FACEBOOK-USER-EVIDENCE-01)
CREATE TYPE "AssetEvidenceRole" AS ENUM ('source_screenshot');

-- AlterTable: nullable, no backfill; existing assets stay ordinary attachments (NULL)
ALTER TABLE "memory_assets" ADD COLUMN "evidenceRole" "AssetEvidenceRole";

-- AlterTable: nullable, no backfill; records which evidence an AI inference was derived from
ALTER TABLE "ai_inferences" ADD COLUMN "evidenceRefs" JSONB;
