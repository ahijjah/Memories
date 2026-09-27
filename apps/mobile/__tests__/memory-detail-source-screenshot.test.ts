import React from 'react';
import TestRenderer, { act, ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-expo';
import * as client from '@/src/api/client';
import { uploadPhotoToExistingMemory } from '@/src/utils/photo-upload';
import MemoryDetailScreen from '@/app/memory/[id]';
import {
  isFacebookLink,
  isUnderstandingFromSourceScreenshot,
  shouldOfferSourceScreenshot,
} from '@/src/utils/source-evidence';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// FACEBOOK-USER-EVIDENCE-01: "Add screenshot" for partial link Memories, and the disclosure.
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

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'mem-1' }),
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

const FB_URL = 'https://www.facebook.com/share/p/SENTINELPATH/';

const memoryOf = (overrides: Partial<client.Memory> = {}): client.Memory => ({
  id: 'mem-1',
  userId: 'user-1',
  sourceType: 'url',
  sourceUri: FB_URL,
  title: FB_URL,
  capturedAt: '2026-09-01T10:00:00Z',
  processingState: 'partial',
  lifecycleState: 'active',
  securityScope: 'private',
  idempotencyKey: 'idem-1',
  assets: [],
  aiInferences: [],
  userConfirmations: [],
  resolved: { title: { value: FB_URL, source: 'original', confidence: null } },
  createdAt: '2026-09-01T10:00:00Z',
  updatedAt: '2026-09-01T10:00:00Z',
  ...overrides,
});

const inference = (field: string, provenance: string, createdAt = '2026-09-02T10:00:00Z'): client.AIInference => ({
  id: `${field}-${provenance}-${createdAt}`,
  memoryId: 'mem-1',
  field,
  valueJson: `${field} value`,
  confidence: 0.8,
  provenance,
  modelVersion: 'm',
  createdAt,
});

const screenshotDerived = () =>
  memoryOf({
    processingState: 'understood',
    assets: [
      {
        id: 'asset-shot',
        memoryId: 'mem-1',
        objectKey: 'k',
        mimeType: 'image/png',
        evidenceRole: 'source_screenshot',
        url: '/assets/asset-shot/content',
        createdAt: '2026-09-02T09:00:00Z',
      },
    ],
    aiInferences: [inference('title', 'llm_user_source_screenshot'), inference('summary', 'llm_user_source_screenshot')],
    resolved: {
      title: { value: 'Concert poster', source: 'ai', confidence: 0.8 },
      summary: { value: 'A poster', source: 'ai', confidence: 0.8 },
    },
  });

const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};

async function render(memory: client.Memory): Promise<ReactTestRenderer> {
  (client.fetchMemoryDetail as jest.Mock).mockResolvedValue(memory);
  (client.fetchProcessingStatus as jest.Mock).mockResolvedValue({
    id: 'mem-1',
    userId: 'user-1',
    processingState: memory.processingState,
    updatedAt: '2026-09-01T10:00:00Z',
    securityScope: memory.securityScope,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let root!: ReactTestRenderer;
  await act(async () => {
    root = TestRenderer.create(
      React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(MemoryDetailScreen)),
    );
  });
  await settle();
  return root;
}

const byTestId = (root: ReactTestRenderer, testID: string) => root.root.findAll((n) => n.props.testID === testID);
const textOf = (root: ReactTestRenderer) =>
  root.root
    .findAllByType('Text' as any)
    .map((n) => [n.props.children].flat().filter((c) => typeof c === 'string').join(''))
    .join('\n');

beforeEach(() => {
  jest.clearAllMocks();
  (useAuth as jest.Mock).mockReturnValue({ getToken: jest.fn().mockResolvedValue('token-1') });
  (client.listCollections as jest.Mock).mockResolvedValue([]);
  (client.reprocessMemory as jest.Mock).mockResolvedValue({ id: 'mem-1', processingState: 'queued' });
  (uploadPhotoToExistingMemory as jest.Mock).mockResolvedValue(undefined);
  mockLaunchImageLibrary.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///shot.png', mimeType: 'image/png' }],
  });
});

describe('Memory Detail: source screenshot', () => {
  it('a partial Facebook link shows the screenshot prompt with Facebook copy', async () => {
    const root = await render(memoryOf());

    expect(byTestId(root, 'source-screenshot-prompt')).toHaveLength(1);
    const text = textOf(root);
    expect(text).toContain("Facebook only shared a link, so we couldn't read the post.");
    expect(text).toContain("Add a screenshot and we'll use that to help understand it.");
    expect(text).not.toMatch(/verified by Facebook|from Facebook itself/i);
  });

  it('Add screenshot uploads with evidenceRole source_screenshot, then reprocesses', async () => {
    const root = await render(memoryOf());

    await act(async () => {
      byTestId(root, 'add-source-screenshot')[0].props.onPress();
    });
    await settle();

    expect(uploadPhotoToExistingMemory).toHaveBeenCalledWith(
      'token-1',
      'mem-1',
      'file:///shot.png',
      'image/png',
      undefined,
      'source_screenshot',
    );
    expect(client.reprocessMemory).toHaveBeenCalledWith('token-1', 'mem-1');
  });

  it.each([
    ['an understood link', memoryOf({ processingState: 'understood' })],
    ['a processing link', memoryOf({ processingState: 'processing' })],
    ['a partial text Memory', memoryOf({ sourceType: 'text', sourceUri: undefined })],
    ['a Vault Memory', memoryOf({ securityScope: 'vault' })],
  ])('does not show the prompt for %s', async (_label, memory) => {
    const root = await render(memory);

    expect(byTestId(root, 'source-screenshot-prompt')).toHaveLength(0);
  });

  it('screenshot-derived understanding shows the disclosure and tags the screenshot, and no prompt', async () => {
    const root = await render(screenshotDerived());

    expect(byTestId(root, 'source-screenshot-disclosure')).toHaveLength(1);
    expect(textOf(root)).toContain('Based on a screenshot you added. Not verified with Facebook.');
    expect(byTestId(root, 'source-screenshot-tag')).toHaveLength(1);
    expect(byTestId(root, 'source-screenshot-prompt')).toHaveLength(0);
  });

  it('ordinary understanding shows no disclosure', async () => {
    const memory = screenshotDerived();
    memory.aiInferences = [inference('title', 'llm_extraction'), inference('summary', 'llm_extraction')];
    memory.assets = [];
    const root = await render(memory);

    expect(byTestId(root, 'source-screenshot-disclosure')).toHaveLength(0);
  });

  it('the EVENT "Add Photo" prompt is unchanged and uploads without an evidence role', async () => {
    const root = await render(
      memoryOf({
        processingState: 'understood',
        resolved: { title: { value: 'Jazz Night', source: 'ai', confidence: 0.9 }, type: { value: 'EVENT', source: 'ai', confidence: 0.9 } },
      }),
    );

    expect(textOf(root)).toContain('Want a photo of this for better details?');
    expect(byTestId(root, 'source-screenshot-prompt')).toHaveLength(0);
    const addPhoto = root.root
      .findAllByType('TouchableOpacity' as any)
      .find((n) => textOf({ root: n } as any).includes('Add Photo'));
    await act(async () => {
      addPhoto!.props.onPress({ nativeEvent: {} }); // a press event must not become an evidence role
    });
    await settle();

    expect(uploadPhotoToExistingMemory).toHaveBeenCalledWith('token-1', 'mem-1', 'file:///shot.png', 'image/png', undefined, undefined);
  });
});

describe('source-evidence helpers', () => {
  it.each([
    ['https://www.facebook.com/share/p/x/', true],
    ['https://m.facebook.com/story.php', true],
    ['https://fb.watch/abc/', true],
    ['www.facebook.com/share/p/x/', true],
    ['https://www.facebook.com.example.com/x', false],
    ['https://notfacebook.com/x', false],
    ['https://example.com', false],
    ['', false],
  ])('isFacebookLink(%p) = %p', (url, expected) => {
    expect(isFacebookLink(url)).toBe(expected);
  });

  it('does not offer a second screenshot once one exists', () => {
    const memory = memoryOf({
      assets: [
        { id: 'a', memoryId: 'mem-1', objectKey: 'k', mimeType: 'image/png', evidenceRole: 'source_screenshot', createdAt: 'x' },
      ],
    });
    expect(shouldOfferSourceScreenshot(memory, 'partial')).toBe(false);
  });

  it('still offers it when only ordinary photos exist', () => {
    const memory = memoryOf({
      assets: [{ id: 'a', memoryId: 'mem-1', objectKey: 'k', mimeType: 'image/png', evidenceRole: null, createdAt: 'x' }],
    });
    expect(shouldOfferSourceScreenshot(memory, 'partial')).toBe(true);
  });

  it('uses the newest inference for the field, and only for AI-sourced values', () => {
    const memory = screenshotDerived();
    memory.aiInferences = [
      inference('summary', 'llm_user_source_screenshot', '2026-09-01T00:00:00Z'),
      inference('summary', 'llm_extraction', '2026-09-03T00:00:00Z'),
      inference('title', 'llm_extraction', '2026-09-03T00:00:00Z'),
    ];
    expect(isUnderstandingFromSourceScreenshot(memory)).toBe(false);

    const confirmed = screenshotDerived();
    confirmed.resolved = {
      title: { value: 'Mine', source: 'user', confidence: null },
      summary: { value: 'Mine', source: 'user', confidence: null },
    };
    expect(isUnderstandingFromSourceScreenshot(confirmed)).toBe(false);
  });
});
