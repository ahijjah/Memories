-- CreateTable collections
CREATE TABLE "collections" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable collection_memories
CREATE TABLE "collection_memories" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "memoryId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_memories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex for userId lookup
CREATE INDEX "collections_userId_idx" ON "collections"("userId");

-- CreateIndex for unique collection-memory pair
CREATE UNIQUE INDEX "collection_memories_collectionId_memoryId_key" ON "collection_memories"("collectionId", "memoryId");

-- AddForeignKey for collections.userId -> users.id
ALTER TABLE "collections" ADD CONSTRAINT "collections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey for collection_memories.collectionId -> collections.id
ALTER TABLE "collection_memories" ADD CONSTRAINT "collection_memories_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey for collection_memories.memoryId -> memories.id
ALTER TABLE "collection_memories" ADD CONSTRAINT "collection_memories_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
