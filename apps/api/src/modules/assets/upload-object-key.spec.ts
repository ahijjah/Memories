import {
  generateUserUploadObjectKey,
  isUserUploadObjectKey,
  USER_UPLOAD_LEAF_LENGTH,
} from './upload-object-key';

describe('user upload object key grammar', () => {
  const memoryId = '0b7a4f1e-3c2d-4e5f-8a9b-0c1d2e3f4a5b';
  const otherMemoryId = '9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f';
  const leaf = 'V1StGXR8_Z5jdHi6B-myT'; // 21 chars from the nanoid URL alphabet

  it('generates keys that the validator accepts for the same Memory only', () => {
    for (let i = 0; i < 50; i++) {
      const key = generateUserUploadObjectKey(memoryId);
      expect(key).toMatch(new RegExp(`^memories/${memoryId}/[A-Za-z0-9_-]{${USER_UPLOAD_LEAF_LENGTH}}$`));
      expect(isUserUploadObjectKey(key, memoryId)).toBe(true);
      expect(isUserUploadObjectKey(key, otherMemoryId)).toBe(false);
    }
  });

  it('accepts the exact issued shape', () => {
    expect(isUserUploadObjectKey(`memories/${memoryId}/${leaf}`, memoryId)).toBe(true);
  });

  it.each([
    ['another Memory id', `memories/${otherMemoryId}/${leaf}`],
    ['extra path segment', `memories/${memoryId}/${leaf}/x`],
    ['nested evidence key', `memories/${memoryId}/evidence/og-image/${leaf}`],
    ['evidence leaf', `memories/${memoryId}/evidence`],
    ['empty leaf', `memories/${memoryId}/`],
    ['short leaf', `memories/${memoryId}/${leaf.slice(1)}`],
    ['long leaf', `memories/${memoryId}/${leaf}a`],
    ['leaf with dot', `memories/${memoryId}/${leaf.slice(2)}..`],
    ['leaf with extension', `memories/${memoryId}/${leaf.slice(4)}.jpg`],
    ['traversal', `memories/${memoryId}/../${otherMemoryId}/${leaf}`],
    ['leading slash', `/memories/${memoryId}/${leaf}`],
    ['wrong prefix', `uploads/${memoryId}/${leaf}`],
    ['missing prefix', `${memoryId}/${leaf}`],
    ['memory id prefix only', `memories/${memoryId.slice(0, -1)}/${leaf}`],
    ['double slash', `memories//${memoryId}/${leaf}`],
    ['arbitrary key', 'some/other/object.png'],
    ['empty key', ''],
  ])('rejects %s', (_label, key) => {
    expect(isUserUploadObjectKey(key, memoryId)).toBe(false);
  });

  it('rejects when memoryId is empty', () => {
    expect(isUserUploadObjectKey(`memories//${leaf}`, '')).toBe(false);
  });
});
