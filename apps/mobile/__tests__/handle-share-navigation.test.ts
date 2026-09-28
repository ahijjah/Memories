import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { useAuth } from '@clerk/clerk-expo';
import { useIncomingShare } from 'expo-sharing';
import { createMemory, reprocessMemory } from '@/src/api/client';
import { uploadPhotoToExistingMemory, uploadPhotoToMemory } from '@/src/utils/photo-upload';
import { resetShareDedupe, SHARE_DEDUPE_TTL_MS } from '@/src/utils/share-dedupe';
import HandleShareScreen from '@/app/handle-share';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// FACEBOOK-SCREENSHOT-UX-03: only URL shares open Detail with fromShare=1.
// LOSSLESS-CAPTURE-01: full text kept, every delivered payload considered, same delivery deduped.
jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  ScrollView: 'ScrollView',
  ActivityIndicator: 'ActivityIndicator',
  TouchableOpacity: 'TouchableOpacity',
}));
const mockRouter = { push: jest.fn(), replace: jest.fn(), navigate: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('expo-sharing', () => ({ useIncomingShare: jest.fn() }));
let mockUuid = 0;
jest.mock('uuid', () => ({ v4: () => `00000000-0000-4000-8000-${String(++mockUuid).padStart(12, '0')}` }));
jest.mock('@/src/api/client', () => ({ createMemory: jest.fn(), reprocessMemory: jest.fn() }));
jest.mock('@/src/utils/photo-upload', () => ({ uploadPhotoToMemory: jest.fn(), uploadPhotoToExistingMemory: jest.fn() }));

const clearSharedPayloads = jest.fn();
const shareAll = (payloads: Record<string, unknown>[]) =>
  (useIncomingShare as jest.Mock).mockReturnValue({
    sharedPayloads: payloads,
    resolvedSharedPayloads: payloads,
    isResolving: false,
    error: null,
    clearSharedPayloads,
  });
const share = (payload: Record<string, unknown>) => shareAll([payload]);

async function render() {
  let root!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    root = TestRenderer.create(React.createElement(HandleShareScreen));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 600)); // past the 500 ms success delay
  });
  return root;
}
async function run() {
  const root = await render();
  act(() => root.unmount());
}
const texts = (root: TestRenderer.ReactTestRenderer) =>
  root.root.findAll((n) => (n.type as any) === 'Text').map((n) => [n.props.children].flat().join(''));

beforeEach(() => {
  jest.clearAllMocks();
  resetShareDedupe();
  (useAuth as jest.Mock).mockReturnValue({ getToken: jest.fn().mockResolvedValue('token-1') });
  (createMemory as jest.Mock).mockResolvedValue({ id: 'mem-1' });
  (reprocessMemory as jest.Mock).mockResolvedValue({ id: 'mem-1', processingState: 'queued' });
  (uploadPhotoToMemory as jest.Mock).mockResolvedValue('mem-img');
  (uploadPhotoToExistingMemory as jest.Mock).mockResolvedValue(undefined);
});

const key = () => (createMemory as jest.Mock).mock.calls[0][2];

describe('handle-share navigation after saving', () => {
  it('bare https URL: a URL Memory as before (no body) and Detail with fromShare=1', async () => {
    const url = 'https://www.facebook.com/share/p/SENTINELPATH/';
    share({ contentType: 'website', value: url });

    await run();

    expect(createMemory).toHaveBeenCalledWith('token-1', 'url', expect.any(String), url, url, undefined, undefined, undefined);
    expect(clearSharedPayloads).toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith('/memory/mem-1?fromShare=1');
  });

  it('bare www URL: normalized to https:// for the source link', async () => {
    share({ contentType: 'website', value: 'www.example.com/article' });

    await run();

    const url = 'https://www.example.com/article';
    expect(createMemory).toHaveBeenCalledWith('token-1', 'url', expect.any(String), url, url, undefined, undefined, undefined);
    expect(mockRouter.replace).toHaveBeenCalledWith('/memory/mem-1?fromShare=1');
  });

  it('text + URL (delivered as one text payload): URL Memory with the full original text as body', async () => {
    const value = 'Interesting post\nhttps://example.com/post';
    share({ contentType: 'text', value });

    await run();

    expect(createMemory).toHaveBeenCalledWith(
      'token-1', 'url', expect.any(String), 'https://example.com/post', 'Interesting post', undefined, undefined, value,
    );
    expect(mockRouter.replace).toHaveBeenCalledWith('/memory/mem-1?fromShare=1');
  });

  it('text share: full text as body (not cut to 100 characters), plain navigation', async () => {
    const value = `${'Buy milk tomorrow and '.repeat(20)}end`;
    share({ contentType: 'text', value });

    await run();

    const [, sourceType, , sourceUri, title, , , body] = (createMemory as jest.Mock).mock.calls[0];
    expect(sourceType).toBe('text');
    expect(sourceUri).toBeUndefined();
    expect(body).toBe(value);
    expect(Array.from(title).length).toBeLessThanOrEqual(100);
    expect(mockRouter.replace).toHaveBeenCalledWith('/memory/mem-1');
  });

  it('text with two links: text Memory, no source link chosen', async () => {
    const value = 'Compare https://a.example/x and https://b.example/y';
    share({ contentType: 'text', value });

    await run();

    expect(createMemory).toHaveBeenCalledWith('token-1', 'text', expect.any(String), undefined, 'Compare and', undefined, undefined, value);
  });

  it('image share: unchanged upload and navigation, with the delivery key', async () => {
    share({ contentType: 'image', contentUri: 'file:///img.jpg', contentMimeType: 'image/jpeg', originalName: 'img.jpg' });

    await run();

    expect(uploadPhotoToMemory).toHaveBeenCalledWith('token-1', 'file:///img.jpg', 'image/jpeg', 'img.jpg', undefined, undefined, expect.any(String));
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

describe('20,000 character limit on shares', () => {
  it('exactly 20,000 characters is saved whole', async () => {
    const value = 'a'.repeat(20_000);
    share({ contentType: 'text', value });

    await run();

    expect((createMemory as jest.Mock).mock.calls[0][7]).toBe(value);
  });

  it('20,001 characters: nothing is created, nothing is cut, and the user sees why', async () => {
    share({ contentType: 'text', value: 'a'.repeat(20_001) });

    const root = await render();

    expect(createMemory).not.toHaveBeenCalled();
    expect(uploadPhotoToMemory).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(texts(root).join(' ')).toContain('This text is too long to save (20,001 characters; the limit is 20,000). Nothing was saved.');
    act(() => root.unmount());
  });

  it('over the limit with an image: the image is not saved either', async () => {
    shareAll([
      { contentType: 'text', value: 'a'.repeat(20_001) },
      { contentType: 'image', contentUri: 'file:///img.jpg', contentMimeType: 'image/jpeg' },
    ]);

    await run();

    expect(createMemory).not.toHaveBeenCalled();
    expect(uploadPhotoToMemory).not.toHaveBeenCalled();
    expect(uploadPhotoToExistingMemory).not.toHaveBeenCalled();
  });
});

describe('every delivered payload is considered', () => {
  it('text + link + image (iOS): one URL Memory with the text as body, the image attached, re-queued', async () => {
    shareAll([
      { contentType: 'text', value: 'Great place for dinner' },
      { contentType: 'website', value: 'https://example.com/place' },
      { contentType: 'image', contentUri: 'file:///img.png', contentMimeType: 'image/png' },
    ]);

    await run();

    expect(createMemory).toHaveBeenCalledTimes(1);
    expect(createMemory).toHaveBeenCalledWith(
      'token-1', 'url', expect.any(String), 'https://example.com/place', 'Great place for dinner', undefined, undefined,
      'Great place for dinner\nhttps://example.com/place',
    );
    expect(uploadPhotoToExistingMemory).toHaveBeenCalledWith('token-1', 'mem-1', 'file:///img.png', 'image/png');
    expect(reprocessMemory).toHaveBeenCalledWith('token-1', 'mem-1');
    expect(mockRouter.replace).toHaveBeenCalledWith('/memory/mem-1?fromShare=1');
  });

  it('text + image: one image Memory with the text as body (the upload starts the analysis)', async () => {
    shareAll([
      { contentType: 'text', value: 'Receipt for the new chair' },
      { contentType: 'image', contentUri: 'file:///r.jpg', contentMimeType: 'image/jpeg' },
    ]);

    await run();

    expect(createMemory).toHaveBeenCalledWith(
      'token-1', 'image', expect.any(String), undefined, 'Receipt for the new chair', undefined, undefined, 'Receipt for the new chair',
    );
    expect(uploadPhotoToExistingMemory).toHaveBeenCalledWith('token-1', 'mem-1', 'file:///r.jpg', 'image/jpeg');
    expect(reprocessMemory).not.toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith('/memory/mem-1');
  });

  it('unsupported payload alongside text: the text is saved and the user is told what was not', async () => {
    shareAll([
      { contentType: 'text', value: 'Watch this later' },
      { contentType: 'video', contentUri: 'file:///v.mp4', contentMimeType: 'video/mp4' },
    ]);

    const root = await render();

    expect(createMemory).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).not.toHaveBeenCalled(); // the user continues by hand
    expect(texts(root).join(' ')).toContain('Not saved: 1 video (not supported yet).');
    act(() => root.root.findByProps({ testID: 'share-open-memory' }).props.onPress());
    expect(mockRouter.replace).toHaveBeenCalledWith('/memory/mem-1');
    act(() => root.unmount());
  });

  it('a second image is reported, not silently dropped', async () => {
    shareAll([
      { contentType: 'image', contentUri: 'file:///1.jpg', contentMimeType: 'image/jpeg' },
      { contentType: 'image', contentUri: 'file:///2.jpg', contentMimeType: 'image/jpeg' },
    ]);

    const root = await render();

    expect(uploadPhotoToMemory).toHaveBeenCalledTimes(1);
    expect(texts(root).join(' ')).toContain('Not saved: 1 image (one image per share is supported).');
    act(() => root.unmount());
  });

  it('only unsupported content: nothing saved, explicit message', async () => {
    share({ contentType: 'file', contentUri: 'file:///doc.pdf', contentMimeType: 'application/pdf' });

    const root = await render();

    expect(createMemory).not.toHaveBeenCalled();
    expect(uploadPhotoToMemory).not.toHaveBeenCalled();
    expect(texts(root).join(' ')).toContain("Nothing was saved: 1 file can't be saved yet.");
    act(() => root.unmount());
  });

  it('image upload fails after the text Memory was created: explicit partial error, open the saved memory', async () => {
    shareAll([
      { contentType: 'text', value: 'Receipt' },
      { contentType: 'image', contentUri: 'file:///r.jpg', contentMimeType: 'image/jpeg' },
    ]);
    (uploadPhotoToExistingMemory as jest.Mock).mockRejectedValue(new Error('network'));

    const root = await render();

    expect(texts(root).join(' ')).toContain('Your text was saved, but the image could not be uploaded.');
    // The image Memory is analyzed from its text instead of staying queued.
    expect(reprocessMemory).toHaveBeenCalledWith('token-1', 'mem-1');
    expect(root.root.findByProps({ testID: 'share-open-memory' })).toBeTruthy();
    act(() => root.unmount());
  });
});

describe('same-delivery dedupe', () => {
  it('the same delivery twice within the window reuses one key and opens the same Memory', async () => {
    share({ contentType: 'text', value: 'Same thing' });
    await run();
    await run();

    // The second delivery reopens the completed save without calling the API again.
    expect(createMemory).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).toHaveBeenNthCalledWith(2, '/memory/mem-1');
  });

  it('a retry after an error reuses the same key (the API returns the Memory if it was created)', async () => {
    share({ contentType: 'text', value: 'Retry me' });
    (createMemory as jest.Mock).mockRejectedValueOnce(new Error('timeout'));
    await run();
    const firstKey = key();

    await run();

    expect((createMemory as jest.Mock).mock.calls[1][2]).toBe(firstKey);
  });

  it('after the 10-minute window the same content can be saved again on purpose', async () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    share({ contentType: 'text', value: 'Save twice' });
    await run();

    now.mockReturnValue(1_000_000 + SHARE_DEDUPE_TTL_MS);
    await run();

    expect(createMemory).toHaveBeenCalledTimes(2);
    expect((createMemory as jest.Mock).mock.calls[1][2]).not.toBe(key());
    now.mockRestore();
  });

  it('a different delivery gets its own key', async () => {
    share({ contentType: 'text', value: 'One' });
    await run();
    share({ contentType: 'text', value: 'Two' });
    await run();

    expect((createMemory as jest.Mock).mock.calls[1][2]).not.toBe(key());
  });

  it('in-flight guard: a second processing of the same delivery while the first runs creates nothing more', async () => {
    let release!: (v: unknown) => void;
    (createMemory as jest.Mock).mockReturnValue(new Promise((resolve) => (release = resolve)));
    share({ contentType: 'text', value: 'Slow' });

    let a!: TestRenderer.ReactTestRenderer;
    let b!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      a = TestRenderer.create(React.createElement(HandleShareScreen));
      b = TestRenderer.create(React.createElement(HandleShareScreen));
    });
    expect(createMemory).toHaveBeenCalledTimes(1);

    await act(async () => {
      release({ id: 'mem-1' });
    });
    act(() => {
      a.unmount();
      b.unmount();
    });
  });
});
