import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Alert, Linking } from 'react-native';
import { useAuth } from '@clerk/clerk-expo';
import * as client from '@/src/api/client';
import MemoryDetailScreen from '@/app/memory/[id]';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

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
    Modal: ({ visible, children, ...rest }: any) =>
      visible ? mockReact.createElement('Modal', rest, children) : null,
    Alert: { alert: jest.fn() },
    Linking: { canOpenURL: jest.fn(), openURL: jest.fn() },
    Share: { share: jest.fn() },
    Platform: { OS: 'android' },
  };
});

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'mem-1' }),
  useRouter: () => mockRouter,
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

jest.mock('expo-image-picker', () => ({}), { virtual: true });
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

const baseMemory = (overrides: Partial<client.Memory> = {}): client.Memory => ({
  id: 'mem-1',
  userId: 'user-1',
  sourceType: 'url',
  title: 'https://example.com/raw',
  capturedAt: '2026-09-01T10:00:00Z',
  processingState: 'processing',
  lifecycleState: 'active',
  securityScope: 'private',
  idempotencyKey: 'idem-1',
  assets: [],
  aiInferences: [],
  userConfirmations: [],
  resolved: { title: { value: 'https://example.com/raw', source: 'original', confidence: null } },
  createdAt: '2026-09-01T10:00:00Z',
  updatedAt: '2026-09-01T10:00:00Z',
  ...overrides,
});

const processedMemory = () =>
  baseMemory({
    processingState: 'understood',
    memoryType: 'EVENT',
    resolved: {
      title: { value: 'Jazz Night', source: 'ai', confidence: 0.9 },
      type: { value: 'EVENT', source: 'ai', confidence: 0.9 },
      date: { value: '2026-10-02', source: 'ai', confidence: 0.8 },
    },
  });

type State = client.ProcessingStatus['processingState'];
const status = (processingState: State) => ({
  id: 'mem-1',
  userId: 'user-1',
  processingState,
  updatedAt: '2026-09-01T10:00:00Z',
  securityScope: 'private',
});

// Only the status poll's setInterval is faked (React Query schedules its own work with setTimeout),
// so time can be advanced in 3000 ms poll steps and real ticks let queries and effects settle.
const settle = async () => {
  for (let i = 0; i < 5; i++) {
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

/**
 * Renders Memory Detail with the processing-status endpoint returning `states` in order
 * (the last one repeats). Returns counters for Detail fetches and ['memories'] invalidations.
 */
async function renderWithStatuses(states: State[], detailAfterFirst: client.Memory = processedMemory()) {
  const statusMock = client.fetchProcessingStatus as jest.Mock;
  states.forEach((state) => statusMock.mockResolvedValueOnce(status(state)));
  statusMock.mockResolvedValue(status(states[states.length - 1]));

  const detailMock = client.fetchMemoryDetail as jest.Mock;
  detailMock.mockResolvedValueOnce(baseMemory({ processingState: states[0] }));
  detailMock.mockResolvedValue(detailAfterFirst);

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(MemoryDetailScreen)),
    );
  });
  await advance(0);

  return {
    root: renderer.root,
    unmount: () => act(() => renderer.unmount()),
    detailFetches: () => detailMock.mock.calls.length,
    statusFetches: () => statusMock.mock.calls.length,
    memoriesInvalidations: () =>
      invalidate.mock.calls.filter(([filters]) => JSON.stringify((filters as any)?.queryKey) === JSON.stringify(['memories']))
        .length,
    allInvalidations: () => invalidate.mock.calls.length,
  };
}

describe('Memory Detail refreshes when processing finishes', () => {
  let screen: Awaited<ReturnType<typeof renderWithStatuses>> | undefined;

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'Date', 'performance', 'hrtime'] });
    jest.clearAllMocks();
    (client.fetchMemoryDetail as jest.Mock).mockReset();
    (client.fetchProcessingStatus as jest.Mock).mockReset();
    (client.listCollections as jest.Mock).mockResolvedValue([]);
    (useAuth as jest.Mock).mockReturnValue({ getToken: jest.fn().mockResolvedValue('token') });
  });

  afterEach(() => {
    screen?.unmount();
    screen = undefined;
    jest.useRealTimers();
  });

  it.each([
    ['processing', 'understood'],
    ['queued', 'understood'],
    ['processing', 'partial'],
    ['processing', 'failed'],
  ] as const)('%s -> %s refetches Detail once and invalidates the Memories list once', async (from, to) => {
    screen = await renderWithStatuses([from, to]);
    expect(screen.detailFetches()).toBe(1);
    expect(screen.memoriesInvalidations()).toBe(0);

    await advance(3000); // poll observes the finished state

    expect(screen.detailFetches()).toBe(2);
    expect(screen.memoriesInvalidations()).toBe(1);

    // No further polling, refetching or invalidation afterwards.
    const statusFetches = screen.statusFetches();
    await advance(15000);
    expect(screen.statusFetches()).toBe(statusFetches);
    expect(screen.detailFetches()).toBe(2);
    expect(screen.memoriesInvalidations()).toBe(1);
  });

  it('keeps polling without refreshing while still active, then refreshes once on completion', async () => {
    screen = await renderWithStatuses(['queued', 'processing', 'processing', 'understood']);

    await advance(3000);
    await advance(3000);
    expect(screen.detailFetches()).toBe(1);
    expect(screen.memoriesInvalidations()).toBe(0);

    await advance(3000);
    expect(screen.detailFetches()).toBe(2);
    expect(screen.memoriesInvalidations()).toBe(1);
  });

  it.each(['understood', 'partial', 'failed'] as const)(
    'does not refresh when the first status on mount is already %s',
    async (state) => {
      screen = await renderWithStatuses([state], baseMemory({ processingState: state }));

      await advance(15000);

      expect(screen.detailFetches()).toBe(1);
      expect(screen.memoriesInvalidations()).toBe(0);
      expect(screen.allInvalidations()).toBe(0);
    },
  );

  it('does not refresh again when a finished state is observed repeatedly (understood -> understood)', async () => {
    screen = await renderWithStatuses(['processing', 'understood']);
    await advance(3000);
    expect(screen.detailFetches()).toBe(2);
    expect(screen.memoriesInvalidations()).toBe(1);

    // The Refresh action re-reads the status, which is still 'understood'.
    const textOf = (node: TestRenderer.ReactTestInstance): string =>
      node.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
    await act(async () => {
      screen!.root.findByProps({ accessibilityLabel: 'More actions' }).props.onPress();
    });
    const refresh = screen.root
      .findAll((n) => n.type === ('TouchableOpacity' as any))
      .find((n) => textOf(n) === 'Refresh');
    const statusFetches = screen.statusFetches();
    await act(async () => {
      refresh!.props.onPress();
    });
    await advance(15000);

    expect(screen.statusFetches()).toBe(statusFetches + 1);
    // Refresh itself refetches Detail once; the unchanged finished status adds nothing more.
    expect(screen.detailFetches()).toBe(3);
    expect(screen.memoriesInvalidations()).toBe(1);
  });

  it('renders the newly resolved fields and card from the fresh Detail response', async () => {
    screen = await renderWithStatuses(['processing', 'understood']);
    expect(screen.root.findByType('CardHeader' as any).props.title).toBe('https://example.com/raw');
    expect(screen.root.findAllByType('EventCard' as any)).toHaveLength(0);

    await advance(3000);

    expect(screen.root.findByType('CardHeader' as any).props.title).toBe('Jazz Night');
    expect(screen.root.findByType('EventCard' as any).props.aiDate).toBe('2026-10-02');
  });
});
