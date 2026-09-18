-- AddColumn latitude and longitude to memories table for location intelligence
ALTER TABLE "memories" ADD COLUMN "latitude" DOUBLE PRECISION,
ADD COLUMN "longitude" DOUBLE PRECISION;
