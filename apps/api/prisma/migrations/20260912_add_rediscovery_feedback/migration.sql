-- CreateTable
CREATE TABLE "rediscovery_feedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "memoryId" TEXT NOT NULL,
    "feedback" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rediscovery_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rediscovery_feedback_userId_memoryId_key" ON "rediscovery_feedback"("userId", "memoryId");

-- CreateIndex
CREATE INDEX "rediscovery_feedback_userId_feedback_idx" ON "rediscovery_feedback"("userId", "feedback");

-- AddForeignKey
ALTER TABLE "rediscovery_feedback" ADD CONSTRAINT "rediscovery_feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rediscovery_feedback" ADD CONSTRAINT "rediscovery_feedback_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
