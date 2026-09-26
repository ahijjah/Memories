import { nanoid } from 'nanoid';

/**
 * Grammar of the object keys issued by POST /assets/create-upload:
 *
 *   memories/{memoryId}/{leaf}
 *
 * where {leaf} is a nanoid of USER_UPLOAD_LEAF_LENGTH characters from nanoid's URL alphabet
 * (A-Z a-z 0-9 _ -). complete-upload accepts only keys of exactly this shape for the requested
 * Memory, so an arbitrary existing object (another Memory's key, a nested/reserved path) can never
 * be registered as a user-uploaded MemoryAsset.
 */
export const USER_UPLOAD_LEAF_LENGTH = 21;

const USER_UPLOAD_LEAF = new RegExp(`^[A-Za-z0-9_-]{${USER_UPLOAD_LEAF_LENGTH}}$`);

export function generateUserUploadObjectKey(memoryId: string): string {
  return `memories/${memoryId}/${nanoid(USER_UPLOAD_LEAF_LENGTH)}`;
}

export function isUserUploadObjectKey(objectKey: string, memoryId: string): boolean {
  if (typeof objectKey !== 'string' || !memoryId) return false;
  const segments = objectKey.split('/');
  return (
    segments.length === 3 &&
    segments[0] === 'memories' &&
    segments[1] === memoryId &&
    USER_UPLOAD_LEAF.test(segments[2])
  );
}
