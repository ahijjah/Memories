-- CreateTable embeddings
CREATE TABLE "embeddings" (
    "id" TEXT NOT NULL,
    "memoryId" TEXT NOT NULL,
    "vector" vector(1024) NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex for unique memoryId
CREATE UNIQUE INDEX "embeddings_memoryId_key" ON "embeddings"("memoryId");

-- CreateIndex for fast similarity search using hnsw
CREATE INDEX "embeddings_vector_idx" ON "embeddings" USING hnsw ("vector" vector_cosine_ops);

-- AddForeignKey
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
