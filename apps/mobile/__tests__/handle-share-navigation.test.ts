import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { useAuth } from '@clerk/clerk-expo';
import { useIncomingShare } from 'expo-sharing';
import { createMemory } from '@/src/api/client';
import { uploadPhotoToMemory } from '@/src/utils/photo-upload';
import HandleShareScreen from '@/app/handle-share';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// FACEBOOK-SCREENSHOT-UX-03: only URL shares open Detail with fromShare=1.
jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  ScrollView: 'ScrollView',
  ActivityIndicator: 'ActivityIndicator',
}));
const mockRouter = { push: jest.fn(), replace: jest.fn(), navigate: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('expo-sharing', () => ({ useIncomingShare: jest.fn() }));
jest.mock('uuid', () => ({ v4: () => '00000000-0000-4000-8000-000000000000' }));
jest.mock('@/src/api/client', () => ({ createMemory: jest.fn() }));
jest.mock('@/src/utils/photo-upload', () => ({ uploadPhotoToMemory: jest.fn() }));

const clearSharedPayloads = jest.fn();
const share = (payload: Record<string, unknown>) =>
  (useIncomingShare as jest.Mock).mockReturnValue({
    sharedPayloads: [payload],
    resolvedSharedPayloads: [payload],
    isResolving: false,
    error: null,
    clearSharedPayloads,
  });

async function run() {
  let root!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    root = TestRenderer.create(React.createElement(HandleShareScreen));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 600)); // past the 500 ms success delay
  });
  act(() => root.unmount());
}

beforeEach(() => {
  jest.clearAllMocks();
  (useAuth as jest.Mock).mockReturnValue({ getToken: jest.fn().mockResolvedValue('token-1') });
  (createMemory as jest.Mock).mockResolvedValue({ id: 'mem-1' });
  (uploadPhotoToMemory as jest.Mock).mockResolvedValue('mem-img');
});

describe('handle-share navigation after saving', () => {
  it.each([
    ['https URL', 'https://www.facebook.com/share/p/SENTINELPATH/'],
    ['www URL', 'www.example.com/article'],
  ])('%s: creates a URL Memory and opens Detail with fromShare=1', async (_label, value) => {
    share({ contentType: 'website', value });

    await run();

    expect(createMemory).toHaveBeenCalledWith('token-1', 'url', expect.any(String), value, value);
    expect(clearSharedPayloads).toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith('/memory/mem-1?fromShare=1');
  });

  it('text share: unchanged navigation (no fromShare)', async () => {
    share({ contentType: 'text', value: 'Buy milk tomorrow' });

    await run();

    expect(createMemory).toHaveBeenCalledWith('token-1', 'text', expect.any(String), undefined, 'Buy milk tomorrow');
    expect(mockRouter.replace).toHaveBeenCalledWith('/memory/mem-1');
  });

  it('image share: unchanged upload and navigation (no fromShare)', async () => {
    share({ contentType: 'image', contentUri: 'file:///img.jpg', contentMimeType: 'image/jpeg', originalName: 'img.jpg' });

    await run();

    expect(uploadPhotoToMemory).toHaveBeenCalledWith('token-1', 'file:///img.jpg', 'image/jpeg', 'img.jpg');
    expect(createMemory).not.toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith('/memory/mem-img');
  });

  it('a failed save does not navigate', async () => {
    share({ contentType: 'website', value: 'https://example.com/a' });
    (createMemory as jest.Mock).mockRejectedValue(new Error('offline'));

    await run();

    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
});
