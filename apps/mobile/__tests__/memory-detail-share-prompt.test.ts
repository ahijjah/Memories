import React from 'react';
import TestRenderer, { act, ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Alert } from 'react-native';
import { useAuth } from '@clerk/clerk-expo';
import * as client from '@/src/api/client';
import { uploadPhotoToExistingMemory } from '@/src/utils/photo-upload';
import MemoryDetailScreen from '@/app/memory/[id]';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// FACEBOOK-SCREENSHOT-UX-03: one-time screenshot prompt after a URL share, and recovery
// ("Analyze screenshot again") for an uploaded screenshot whose analysis never completed.
jest.mock('react-native', () => {
  const mockReact = require('react');
  return {
    View: 'View',
    Text: 'Text',
    ScrollView: 'ScrollView',
    ActivityIndicator: 'ActivityIndicator',
    TouchableOpacity: 'TouchableOpacity',
    Pressable: 'Pressable',
    TextInput: 'TextInput',
    Image: 'Image',
    Modal: ({ visible, children, ...rest }: any) => (visible ? mockReact.createElement('Modal', rest, children) : null),
    Alert: { alert: jest.fn() },
    Linking: { canOpenURL: jest.fn(), openURL: jest.fn() },
    Share: { share: jest.fn() },
    Platform: { OS: 'android' },
  };
});

let mockParams: Record<string, string> = { id: 'mem-1' };
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) }),
}));

jest.mock('@/src/api/client', () => ({
  fetchMemoryDetail: jest.fn(),
  fetchProcessingStatus: jest.fn(),
  listCollections: jest.fn(),
  addMemoryToCollection: jest.fn(),
  lockMemory: jest.fn(),
  createReminder: jest.fn(),
  reprocessMemory: jest.fn(),
  deleteMemory: jest.fn(),
  summarizeMemory: jest.fn(),
  extractKeyPoints: jest.fn(),
}));

const mockLaunchImageLibrary = jest.fn();
jest.mock(
  'expo-image-picker',
  () => ({
    launchImageLibraryAsync: (...args: unknown[]) => mockLaunchImageLibrary(...args),
    MediaTypeOptions: { Images: 'Images' },
  }),
  { virtual: true },
);
jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker', { virtual: true });
jest.mock('expo-calendar/legacy', () => ({}), { virtual: true });
jest.mock('expo-file-system/legacy', () => ({}), { virtual: true });
jest.mock('expo-sharing', () => ({}), { virtual: true });
jest.mock('react-native-view-shot', () => ({ __esModule: true, default: 'ViewShot', captureRef: jest.fn() }), {
  virtual: true,
});
jest.mock('@/src/utils/photo-upload', () => ({ uploadPhotoToExistingMemory: jest.fn() }));
jest.mock('@/src/components/AuthenticatedAssetImage', () => ({ AuthenticatedAssetImage: 'AuthenticatedAssetImage' }));
jest.mock('@/src/components/RelatedMemoriesSection', () => ({ RelatedMemoriesSection: 'RelatedMemoriesSection' }));
jest.mock('@/src/components/memory-cards/ShareCardView', () => ({ ShareCardView: 'ShareCardView' }));
jest.mock('@/src/components/memory-cards/CardHeader', () => ({ CardHeader: 'CardHeader' }));
jest.mock('@/src/components/memory-cards/CardIdentity', () => ({ CardIdentity: 'CardIdentity' }));
jest.mock('@/src/components/memory-cards/GenericCard', () => ({ GenericCard: 'GenericCard' }));
jest.mock('@/src/components/memory-cards/EventCard', () => ({ EventCard: 'EventCard' }));
jest.mock('@/src/components/memory-cards/PlaceCard', () => ({ PlaceCard: 'PlaceCard' }));
jest.mock('@/src/components/memory-cards/ProductCard', () => ({ ProductCard: 'ProductCard' }));
jest.mock('@/src/components/memory-cards/OfferCard', () => ({ OfferCard: 'OfferCard' }));
jest.mock('@/src/components/memory-cards/ArticleLearningCard', () => ({ ArticleLearningCard: 'ArticleLearningCard' }));
jest.mock('@/src/components/memory-cards/VideoSocialCard', () => ({ VideoSocialCard: 'VideoSocialCard' }));
jest.mock('@/src/components/memory-cards/DocumentCard', () => ({ DocumentCard: 'DocumentCard' }));

type State = client.ProcessingStatus['processingState'];
const FB_URL = 'https://www.facebook.com/share/p/SENTINELPATH/';
const SCREENSHOT_ASSET: client.MemoryAsset = {
  id: 'asset-shot',
  memoryId: 'mem-1',
  objectKey: 'k',
  mimeType: 'image/png',
  evidenceRole: 'source_screenshot',
  url: '/assets/asset-shot/content',
  createdAt: '2026-09-28T09:00:00Z',
};

const memoryOf = (overrides: Partial<client.Memory> = {}): client.Memory => ({
  id: 'mem-1',
  userId: 'user-1',
  sourceType: 'url',
  sourceUri: FB_URL,
  title: FB_URL,
  capturedAt: '2026-09-28T09:00:00Z',
  processingState: 'queued',
  lifecycleState: 'active',
  securityScope: 'private',
  idempotencyKey: 'idem-1',
  assets: [],
  aiInferences: [],
  userConfirmations: [],
  resolved: { title: { value: FB_URL, source: 'original', confidence: null } },
  createdAt: '2026-09-28T09:00:00Z',
  updatedAt: '2026-09-28T09:00:00Z',
  ...overrides,
});
const status = (processingState: State, securityScope = 'private') => ({
  id: 'mem-1',
  userId: 'user-1',
  processingState,
  updatedAt: '2026-09-28T09:00:00Z',
  securityScope,
});

const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};
const advance = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  await settle();
};

let renderer: ReactTestRenderer | undefined;
async function render(states: State[], memory: client.Memory = memoryOf()) {
  const statusMock = client.fetchProcessingStatus as jest.Mock;
  states.forEach((s) => statusMock.mockResolvedValueOnce(status(s, memory.securityScope)));
  statusMock.mockResolvedValue(status(states[states.length - 1], memory.securityScope));
  (client.fetchMemoryDetail as jest.Mock).mockResolvedValue(memory);

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(MemoryDetailScreen)),
    );
  });
  await settle();
  return renderer!;
}

const alertMock = () => Alert.alert as jest.Mock;
const sharePrompts = () =>
  alertMock().mock.calls.filter(([title]) => title === "Facebook only shared a link, so we couldn't read the post.");
const pressPromptButton = async (label: string) => {
  const [, , buttons] = sharePrompts()[0];
  await act(async () => {
    buttons.find((b: any) => b.text === label).onPress?.();
  });
  await settle();
};
const byTestId = (root: ReactTestRenderer, testID: string) => root.root.findAll((n) => n.props.testID === testID);

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'Date', 'performance', 'hrtime'] });
  jest.clearAllMocks();
  (client.fetchProcessingStatus as jest.Mock).mockReset();
  (client.fetchMemoryDetail as jest.Mock).mockReset();
  (client.reprocessMemory as jest.Mock).mockReset().mockResolvedValue({ id: 'mem-1', processingState: 'queued' });
  (client.listCollections as jest.Mock).mockResolvedValue([]);
  (useAuth as jest.Mock).mockReturnValue({ getToken: jest.fn().mockResolvedValue('token-1') });
  (uploadPhotoToExistingMemory as jest.Mock).mockResolvedValue(undefined);
  mockLaunchImageLibrary.mockReset().mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///shot.png', mimeType: 'image/png' }] });
  mockParams = { id: 'mem-1', fromShare: '1' };
});

afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined;
  jest.useRealTimers();
});

describe('one-time screenshot prompt after a URL share', () => {
  it.each([['queued'], ['processing']] as const)('%s: no prompt while the first job has not finished', async (state) => {
    await render([state]);
    await advance(9000);

    expect(sharePrompts()).toHaveLength(0);
  });

  it('queued -> partial prompts exactly once, with Not now and Add screenshot', async () => {
    await render(['queued', 'processing', 'partial'], memoryOf());
    expect(sharePrompts()).toHaveLength(0);

    await advance(3000);
    await advance(3000);

    expect(sharePrompts()).toHaveLength(1);
    const [, body, buttons, options] = sharePrompts()[0];
    expect(body).toBe("Add a screenshot and we'll use that to help understand it.");
    expect(buttons.map((b: any) => b.text)).toEqual(['Not now', 'Add screenshot']);
    expect(options).toEqual({ cancelable: true });

    // Later refetches and re-renders while still partial do not prompt again.
    await advance(15000);
    await act(async () => {
      renderer!.update(
        React.createElement(QueryClientProvider, { client: new QueryClient() }, React.createElement(MemoryDetailScreen)),
      );
    });
    await settle();
    expect(sharePrompts()).toHaveLength(1);
  });

  it('already partial when Detail opens (fast first job): prompts once', async () => {
    await render(['partial'], memoryOf({ processingState: 'partial' }));

    expect(sharePrompts()).toHaveLength(1);
  });

  it('Not now uploads nothing and keeps the inline banner', async () => {
    const root = await render(['partial'], memoryOf({ processingState: 'partial' }));

    await pressPromptButton('Not now');

    expect(mockLaunchImageLibrary).not.toHaveBeenCalled();
    expect(uploadPhotoToExistingMemory).not.toHaveBeenCalled();
    expect(client.reprocessMemory).not.toHaveBeenCalled();
    expect(byTestId(root, 'source-screenshot-prompt')).toHaveLength(1);
  });

  it('Add screenshot runs the existing PR29 flow with source_screenshot, then reprocess', async () => {
    await render(['partial'], memoryOf({ processingState: 'partial' }));

    await pressPromptButton('Add screenshot');

    expect(mockLaunchImageLibrary).toHaveBeenCalledTimes(1);
    expect(uploadPhotoToExistingMemory).toHaveBeenCalledWith('token-1', 'mem-1', 'file:///shot.png', 'image/png', undefined, 'source_screenshot');
    expect(client.reprocessMemory).toHaveBeenCalledWith('token-1', 'mem-1');
  });

  it('picker cancel behaves like Not now: nothing uploaded, banner remains', async () => {
    mockLaunchImageLibrary.mockResolvedValue({ canceled: true, assets: [] });
    const root = await render(['partial'], memoryOf({ processingState: 'partial' }));

    await pressPromptButton('Add screenshot');

    expect(uploadPhotoToExistingMemory).not.toHaveBeenCalled();
    expect(client.reprocessMemory).not.toHaveBeenCalled();
    expect(byTestId(root, 'source-screenshot-prompt')).toHaveLength(1);
    // The picker round trip re-renders the screen; the prompt does not come back.
    expect(sharePrompts()).toHaveLength(1);
  });

  it('upload failure keeps the Memory and the banner, and shows an error', async () => {
    (uploadPhotoToExistingMemory as jest.Mock).mockRejectedValue(new Error('Upload failed: 500'));
    const root = await render(['partial'], memoryOf({ processingState: 'partial' }));

    await pressPromptButton('Add screenshot');

    expect(alertMock()).toHaveBeenCalledWith('Error', 'Upload failed: 500');
    expect(client.reprocessMemory).not.toHaveBeenCalled();
    expect(byTestId(root, 'source-screenshot-prompt')).toHaveLength(1);
    expect(sharePrompts()).toHaveLength(1);
  });

  it('no fromShare: no automatic prompt (inline banner only)', async () => {
    mockParams = { id: 'mem-1' };
    const root = await render(['partial'], memoryOf({ processingState: 'partial' }));

    expect(sharePrompts()).toHaveLength(0);
    expect(byTestId(root, 'source-screenshot-prompt')).toHaveLength(1);
  });

  it.each([
    ['understood', memoryOf({ processingState: 'understood' }), ['understood']],
    ['failed', memoryOf({ processingState: 'failed' }), ['failed']],
    ['Vault', memoryOf({ processingState: 'partial', securityScope: 'vault' }), ['partial']],
    ['text Memory', memoryOf({ processingState: 'partial', sourceType: 'text', sourceUri: undefined }), ['partial']],
    ['screenshot already present', memoryOf({ processingState: 'partial', assets: [SCREENSHOT_ASSET] }), ['partial']],
  ] as const)('%s: no prompt', async (_label, memory, states) => {
    await render([...states], memory);
    await advance(6000);

    expect(sharePrompts()).toHaveLength(0);
  });

  it('EVENT Add Photo prompt is unchanged and uploads without a role', async () => {
    mockParams = { id: 'mem-1' };
    const root = await render(
      ['understood'],
      memoryOf({
        processingState: 'understood',
        resolved: { title: { value: 'Jazz', source: 'ai', confidence: 0.9 }, type: { value: 'EVENT', source: 'ai', confidence: 0.9 } },
      }),
    );
    const addPhoto = root.root
      .findAllByType('TouchableOpacity' as any)
      .find((n) => n.findAllByType('Text' as any).some((t) => t.props.children === 'Add Photo'));

    await act(async () => {
      addPhoto!.props.onPress({ nativeEvent: {} });
    });
    await settle();

    expect(uploadPhotoToExistingMemory).toHaveBeenCalledWith('token-1', 'mem-1', 'file:///shot.png', 'image/png', undefined, undefined);
    expect(sharePrompts()).toHaveLength(0);
  });
});

describe('M3 recovery: Analyze screenshot again', () => {
  const withScreenshot = (processingState: State, overrides: Partial<client.Memory> = {}) =>
    memoryOf({ processingState, assets: [SCREENSHOT_ASSET], ...overrides });

  it.each([
    ['partial', "Your screenshot hasn't been analyzed yet."],
    ['failed', "We couldn't analyze your screenshot."],
  ] as const)('%s + screenshot + idle: retry visible, no Add Screenshot prompt', async (state, text) => {
    const root = await render([state], withScreenshot(state));

    expect(byTestId(root, 'reanalyze-source-screenshot')).toHaveLength(1);
    const texts = root.root.findAllByType('Text' as any).map((t) => [t.props.children].flat().join(''));
    expect(texts).toContain(text);
    expect(texts).toContain('Analyze screenshot again');
    expect(byTestId(root, 'source-screenshot-prompt')).toHaveLength(0);
    expect(sharePrompts()).toHaveLength(0);
  });

  it.each([
    ['queued', withScreenshot('queued')],
    ['processing', withScreenshot('processing')],
    ['understood', withScreenshot('understood')],
    ['Vault', withScreenshot('failed', { securityScope: 'vault' })],
    ['no screenshot', memoryOf({ processingState: 'failed' })],
  ] as const)('%s: retry not visible', async (_label, memory) => {
    const root = await render([memory.processingState], memory);

    expect(byTestId(root, 'reanalyze-source-screenshot')).toHaveLength(0);
  });

  it('retry calls reprocess only (no picker, upload or new asset) and resumes polling', async () => {
    const root = await render(['failed'], withScreenshot('failed'));
    (client.fetchProcessingStatus as jest.Mock).mockReset();
    (client.fetchProcessingStatus as jest.Mock)
      .mockResolvedValueOnce(status('queued'))
      .mockResolvedValueOnce(status('processing'))
      .mockResolvedValue(status('understood'));

    await act(async () => {
      byTestId(root, 'reanalyze-source-screenshot')[0].props.onPress();
    });
    await settle();

    expect(client.reprocessMemory).toHaveBeenCalledTimes(1);
    expect(client.reprocessMemory).toHaveBeenCalledWith('token-1', 'mem-1');
    expect(mockLaunchImageLibrary).not.toHaveBeenCalled();
    expect(uploadPhotoToExistingMemory).not.toHaveBeenCalled();

    // The refreshed status (queued) restarts the 3 s poll until the run finishes.
    const before = (client.fetchProcessingStatus as jest.Mock).mock.calls.length;
    await advance(3000);
    await advance(3000);
    expect((client.fetchProcessingStatus as jest.Mock).mock.calls.length).toBeGreaterThan(before);
    expect(byTestId(root, 'reanalyze-source-screenshot')).toHaveLength(0);
  });

  it('retry failure shows an error and stays recoverable (button still there, Memory kept)', async () => {
    (client.reprocessMemory as jest.Mock).mockRejectedValue(new Error('HTTP 500'));
    const root = await render(['failed'], withScreenshot('failed'));

    await act(async () => {
      byTestId(root, 'reanalyze-source-screenshot')[0].props.onPress();
    });
    await settle();

    expect(alertMock()).toHaveBeenCalledWith('Error', 'HTTP 500');
    expect(byTestId(root, 'reanalyze-source-screenshot')).toHaveLength(1);
    expect(byTestId(root, 'reanalyze-source-screenshot')[0].props.disabled).toBe(false);
  });
});
