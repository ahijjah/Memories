-- Drop existing index and add unique constraint on UserConfirmation
DROP INDEX IF EXISTS "user_confirmations_memoryId_field_idx";
ALTER TABLE "user_confirmations" ADD CONSTRAINT "user_confirmations_memoryId_field_key" UNIQUE ("memoryId", "field");
