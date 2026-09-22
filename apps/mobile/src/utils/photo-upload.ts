import * as FileSystem from 'expo-file-system/legacy';
import { v4 as uuidv4 } from 'uuid';
import { createMemory, createUpload, completeUpload } from '@/src/api/client';
import { Alert } from 'react-native';

export async function uploadPhotoToMemory(
  token: string,
  fileUri: string,
  mimeType: string,
  title?: string,
  latitude?: number,
  longitude?: number,
): Promise<string> {
  const idempotencyKey = uuidv4();

  const memory = await createMemory(
    token,
    'camera',
    idempotencyKey,
    undefined,
    title || `Photo ${new Date().toLocaleString()}`,
    latitude,
    longitude,
  );

  const uploadTarget = await createUpload(token, memory.id, mimeType);

  const headers = {
    'Content-Type': mimeType,
    ...uploadTarget.uploadHeaders,
  };

  const uploadResult = await FileSystem.uploadAsync(uploadTarget.uploadUrl, fileUri, {
    httpMethod: 'PUT',
    headers,
  });

  if (uploadResult.status !== 200) {
    const bodyText = uploadResult.body || '(empty)';
    console.error(`[photo-upload] Asset upload failed: status=${uploadResult.status}, body=${bodyText}`);
    Alert.alert('Upload Error', `Status ${uploadResult.status}: Check logs for details`);
    throw new Error(`Asset upload failed: status=${uploadResult.status}`);
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

export async function uploadPhotoToExistingMemory(
  token: string,
  memoryId: string,
  fileUri: string,
  mimeType: string,
  pageIndex?: number,
): Promise<void> {
  const uploadTarget = await createUpload(token, memoryId, mimeType);

  const headers = {
    'Content-Type': mimeType,
    ...uploadTarget.uploadHeaders,
  };

  const uploadResult = await FileSystem.uploadAsync(uploadTarget.uploadUrl, fileUri, {
    httpMethod: 'PUT',
    headers,
  });

  if (uploadResult.status !== 200) {
    const bodyText = uploadResult.body || '(empty)';
    console.error(`[photo-upload] Asset upload failed: status=${uploadResult.status}, body=${bodyText}`);
    Alert.alert('Upload Error', `Status ${uploadResult.status}: Check logs for details`);
    throw new Error(`Asset upload failed: status=${uploadResult.status}`);
  }

  const fileInfo = await FileSystem.getInfoAsync(fileUri, { md5: true });
  const checksum = fileInfo.exists ? fileInfo.md5 : undefined;

  await completeUpload(
    token,
    memoryId,
    uploadTarget.objectKey,
    uploadTarget.mimeType,
    checksum,
    pageIndex,
  );
}
