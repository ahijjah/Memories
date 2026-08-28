import * as FileSystem from 'expo-file-system/legacy';
import { v4 as uuidv4 } from 'uuid';
import { createMemory, createUpload, completeUpload } from '@/src/api/client';

export async function uploadPhotoToMemory(
  token: string,
  fileUri: string,
  mimeType: string,
  title?: string,
): Promise<string> {
  const idempotencyKey = uuidv4();

  const memory = await createMemory(
    token,
    'camera',
    idempotencyKey,
    undefined,
    title || `Photo ${new Date().toLocaleString()}`,
  );

  const uploadTarget = await createUpload(token, memory.id, mimeType);

  const uploadResult = await FileSystem.uploadAsync(uploadTarget.uploadUrl, fileUri, {
    httpMethod: 'PUT',
    headers: {
      'Content-Type': mimeType,
    },
  });

  if (uploadResult.status !== 200) {
    throw new Error(`Upload failed with status ${uploadResult.status}`);
  }

  const fileInfo = await FileSystem.getInfoAsync(fileUri, { md5: true });
  const checksum = fileInfo.exists ? fileInfo.md5 : undefined;

  await completeUpload(
    token,
    memory.id,
    uploadTarget.objectKey,
    uploadTarget.mimeType,
    checksum,
  );

  return memory.id;
}
