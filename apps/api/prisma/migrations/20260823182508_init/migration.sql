-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "MemorySourceType" AS ENUM ('share', 'url', 'image', 'screenshot', 'camera', 'text', 'document_scan');

-- CreateEnum
CREATE TYPE "MemoryType" AS ENUM ('article', 'video', 'post', 'image', 'note', 'document', 'event', 'place', 'product', 'tutorial', 'other');

-- CreateEnum
CREATE TYPE "ProcessingState" AS ENUM ('queued', 'processing', 'understood', 'partial', 'failed');

-- CreateEnum
CREATE TYPE "LifecycleState" AS ENUM ('active', 'archived', 'deleted_pending', 'deleted');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "plan" TEXT NOT NULL DEFAULT 'free',
    "preferences" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "pushToken" TEXT,
    "platform" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memories" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceType" "MemorySourceType" NOT NULL,
    "sourceUri" TEXT,
    "memoryType" "MemoryType",
    "title" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processingState" "ProcessingState" NOT NULL DEFAULT 'queued',
    "lifecycleState" "LifecycleState" NOT NULL DEFAULT 'active',
    "securityScope" TEXT NOT NULL DEFAULT 'private',
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_assets" (
    "id" TEXT NOT NULL,
    "memoryId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "checksum" TEXT,
    "pageIndex" INTEGER,
    "variant" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_inferences" (
    "id" TEXT NOT NULL,
    "memoryId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "valueJson" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "provenance" TEXT,
    "modelVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_inferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_confirmations" (
    "id" TEXT NOT NULL,
    "memoryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "confirmedValue" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "device_sessions_userId_deviceId_key" ON "device_sessions"("userId", "deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "memories_idempotencyKey_key" ON "memories"("idempotencyKey");

-- CreateIndex
CREATE INDEX "memories_userId_lifecycleState_idx" ON "memories"("userId", "lifecycleState");

-- CreateIndex
CREATE INDEX "memories_userId_processingState_idx" ON "memories"("userId", "processingState");

-- CreateIndex
CREATE INDEX "memory_assets_memoryId_idx" ON "memory_assets"("memoryId");

-- CreateIndex
CREATE INDEX "ai_inferences_memoryId_field_idx" ON "ai_inferences"("memoryId", "field");

-- CreateIndex
CREATE INDEX "user_confirmations_memoryId_field_idx" ON "user_confirmations"("memoryId", "field");

-- AddForeignKey
ALTER TABLE "device_sessions" ADD CONSTRAINT "device_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memories" ADD CONSTRAINT "memories_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_assets" ADD CONSTRAINT "memory_assets_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_inferences" ADD CONSTRAINT "ai_inferences_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_confirmations" ADD CONSTRAINT "user_confirmations_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_confirmations" ADD CONSTRAINT "user_confirmations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
