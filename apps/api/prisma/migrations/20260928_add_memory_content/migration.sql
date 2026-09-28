-- CreateTable: full user-authored/shared text for a Memory (LOSSLESS-CAPTURE-01).
-- 1:1 with memories; no backfill (legacy Memories keep only their title).
CREATE TABLE "memory_contents" (
    "memoryId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_contents_pkey" PRIMARY KEY ("memoryId"),
    -- Backstop for the API limit (MAX_MEMORY_TEXT): text is never truncated, only rejected.
    CONSTRAINT "memory_contents_text_length_check" CHECK (char_length("text") <= 20000)
);

-- AddForeignKey
ALTER TABLE "memory_contents" ADD CONSTRAINT "memory_contents_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
