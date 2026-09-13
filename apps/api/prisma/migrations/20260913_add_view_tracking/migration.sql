-- AddColumn lastViewedAt and viewCount to memories table for tracking view activity
ALTER TABLE "memories" ADD COLUMN "lastViewedAt" TIMESTAMP(3),
ADD COLUMN "viewCount" INTEGER NOT NULL DEFAULT 0;
