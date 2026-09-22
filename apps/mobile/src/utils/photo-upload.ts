import * as FileSystem from 'expo-file-system/legacy';
import { v4 as uuidv4 } from 'uuid';
import { createMemory, createUpload, completeUpload } from '@/src/api/client';
import { Alert } from 'react-native';

// Redact sensitive parts of URL/headers for logging
function redactSensitiveData(text: string): string {
  if (!text) return text;
  // Redact the signature part of presigned URLs (everything after X-Amz-Signature=)
  text = text.replace(/X-Amz-Signature=[^&]*/gi, 'X-Amz-Signature=REDACTED');
  // Redact SSE-C key header value
  text = text.replace(/x-amz-sse-c:\s*[^\n]*/gi, 'x-amz-sse-c: REDACTED');
  // Redact SSE-C key MD5 (just log presence)
  text = text.replace(/x-amz-sse-c-key-md5:\s*[^\n]*/gi, 'x-amz-sse-c-key-md5: REDACTED');
  return text;
}

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
    // Enhanced logging for failed uploads
    const sseHeaderNames = ['x-amz-sse-c', 'x-amz-sse-c-alg', 'x-amz-sse-c-key-md5'];
    const sentSSEHeaders = sseHeaderNames.filter((name) => name in headers).length;
    const expectedSSEHeaders = 3;
    const allSSEHeadersSent = sentSSEHeaders === expectedSSEHeaders;

    const errorDetails = {
      status: uploadResult.status,
      contentTypeSent: headers['Content-Type'],
      sseHeadersSent: `${sentSSEHeaders}/${expectedSSEHeaders}`,
      allSSEHeadersSent,
      responseHeaders: uploadResult.headers ? Object.entries(uploadResult.headers).map(([k, v]) => `${k}: ${redactSensitiveData(String(v))}`).join('\n') : 'none',
      responseBody: uploadResult.body ? redactSensitiveData(uploadResult.body) : 'no body',
      requestUrl: redactSensitiveData(uploadTarget.uploadUrl),
    };

    const errorMessage = `Upload failed: ${JSON.stringify(errorDetails, null, 2)}`;
    console.error('[photo-upload] uploadPhotoToMemory error:', errorMessage);
    Alert.alert('Upload Error', `Status ${uploadResult.status}: Check logs for details`);
    throw new Error(errorMessage);
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
    // Enhanced logging for failed uploads
    const sseHeaderNames = ['x-amz-sse-c', 'x-amz-sse-c-alg', 'x-amz-sse-c-key-md5'];
    const sentSSEHeaders = sseHeaderNames.filter((name) => name in headers).length;
    const expectedSSEHeaders = 3;
    const allSSEHeadersSent = sentSSEHeaders === expectedSSEHeaders;

    const errorDetails = {
      status: uploadResult.status,
      contentTypeSent: headers['Content-Type'],
      sseHeadersSent: `${sentSSEHeaders}/${expectedSSEHeaders}`,
      allSSEHeadersSent,
      responseHeaders: uploadResult.headers ? Object.entries(uploadResult.headers).map(([k, v]) => `${k}: ${redactSensitiveData(String(v))}`).join('\n') : 'none',
      responseBody: uploadResult.body ? redactSensitiveData(uploadResult.body) : 'no body',
      requestUrl: redactSensitiveData(uploadTarget.uploadUrl),
    };

    const errorMessage = `Upload failed: ${JSON.stringify(errorDetails, null, 2)}`;
    console.error('[photo-upload] uploadPhotoToExistingMemory error:', errorMessage);
    Alert.alert('Upload Error', `Status ${uploadResult.status}: Check logs for details`);
    throw new Error(errorMessage);
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
