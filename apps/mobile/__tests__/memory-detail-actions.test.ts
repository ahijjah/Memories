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

type Inference = [field: string, value: any, confidence?: number];

// The server resolves each field (PR2); fixtures mirror that as AI-sourced values, with legacy
// type names normalized to the canonical taxonomy the way the API does.
const CANONICAL_TYPE: Record<string, string> = { event: 'EVENT', place: 'PLACE', product: 'PRODUCT', article: 'ARTICLE_LEARNING' };
const resolvedFrom = (inferences: Inference[]) =>
  Object.fromEntries(
    inferences.map(([field, value, confidence = 0.95]) => [
      field,
      { value: field === 'type' ? CANONICAL_TYPE[value] ?? value : value, source: 'ai', confidence },
    ]),
  ) as client.Memory['resolved'];

const buildMemory = (overrides: Partial<client.Memory> = {}, inferences: Inference[] = []): client.Memory => ({
  resolved: resolvedFrom(inferences),
  id: 'mem-1',
  userId: 'user-1',
  sourceType: 'text',
  title: 'Test Memory',
  capturedAt: '2026-09-01T10:00:00Z',
  processingState: 'understood',
  lifecycleState: 'active',
  securityScope: 'private',
  idempotencyKey: 'idem-1',
  assets: [],
  userConfirmations: [],
  createdAt: '2026-09-01T10:00:00Z',
  updatedAt: '2026-09-01T10:00:00Z',
  aiInferences: inferences.map(([field, valueJson, confidence = 0.95], i) => ({
    id: `inf-${i}`,
    memoryId: 'mem-1',
    field,
    valueJson,
    confidence,
    modelVersion: 'test',
    createdAt: '2026-09-01T10:00:00Z',
  })),
  ...overrides,
});

const textOf = (node: TestRenderer.ReactTestInstance): string =>
  node.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');

const buttonsIn = (root: TestRenderer.ReactTestInstance) =>
  root.findAll((n) => n.type === 'TouchableOpacity');

const flush = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

async function renderScreen(memory: client.Memory) {
  (client.fetchMemoryDetail as jest.Mock).mockResolvedValue(memory);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(MemoryDetailScreen)),
    );
  });
  await flush();

  const root = renderer.root;
  const directLabels = () => buttonsIn(root).map(textOf);
  const menu = () => root.findAll((n) => n.type === 'Modal' && textOf(n).startsWith('More actions'));
  const openMore = () => {
    const more = root.findByProps({ accessibilityLabel: 'More actions' });
    act(() => more.props.onPress());
    expect(menu()).toHaveLength(1);
  };
  const menuLabels = () => buttonsIn(menu()[0]).map(textOf).filter((l) => l !== 'Cancel');
  const selectInMenu = async (label: string) => {
    const item = buttonsIn(menu()[0]).find((b) => textOf(b) === label);
    expect(item).toBeDefined();
    await act(async () => {
      item!.props.onPress();
    });
    await flush();
  };
  const press = async (label: string) => {
    const matches = buttonsIn(root).filter((b) => textOf(b) === label);
    expect(matches).toHaveLength(1);
    await act(async () => {
      matches[0].props.onPress();
    });
    await flush();
  };

  return { root, directLabels, menu, openMore, menuLabels, selectInMenu, press, queryClient };
}

const QUICK_EXCLUDED = [
  'Call',
  'WhatsApp',
  'Share Card',
  'Share Event',
  'Share Place',
  'Share Copy',
  'Summarize',
  'Key Points',
  'Compare',
  'Add to Collection',
  'Refresh',
  'Move to Vault',
];

describe('Memory Detail action hierarchy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useAuth as jest.Mock).mockReturnValue({ getToken: jest.fn().mockResolvedValue('token') });
    (client.fetchProcessingStatus as jest.Mock).mockResolvedValue({
      id: 'mem-1',
      userId: 'user-1',
      processingState: 'understood',
      updatedAt: '2026-09-01T10:00:00Z',
    });
    (client.listCollections as jest.Mock).mockResolvedValue([]);
    (Linking.canOpenURL as jest.Mock).mockResolvedValue(true);
  });

  describe('A. generic private memory', () => {
    it('shows only Set Reminder and More in the Quick area, Delete and Back outside More', async () => {
      const s = await renderScreen(buildMemory());
      expect(s.directLabels()).toEqual(['Set Reminder', 'More (...)', 'Delete Memory', 'Back']);
      for (const label of QUICK_EXCLUDED) expect(s.directLabels()).not.toContain(label);
    });

    it('puts Share Card, Add to Collection, Move to Vault and Refresh in More', async () => {
      const s = await renderScreen(buildMemory());
      expect(s.menu()).toHaveLength(0);
      s.openMore();
      expect(s.menuLabels()).toEqual(['Share Card', 'Add to Collection', 'Move to Vault', 'Refresh']);
      expect(s.menuLabels()).not.toContain('Delete Memory');
    });

    it('keeps RelatedMemoriesSection rendered', async () => {
      const s = await renderScreen(buildMemory());
      expect(s.root.findAll((n) => n.type === ('RelatedMemoriesSection' as any))).toHaveLength(1);
    });
  });

  describe('B. event with date and location', () => {
    const event = () =>
      buildMemory({ memoryType: 'event' }, [
        ['type', 'event'],
        ['date', '2026-10-01'],
        ['location', 'Main Hall'],
      ]);

    it('shows Add to Calendar as the only contextual Quick action', async () => {
      const s = await renderScreen(event());
      expect(s.directLabels()).toEqual(['Add to Calendar', 'Set Reminder', 'More (...)', 'Delete Memory', 'Back']);
      expect(s.directLabels()).not.toContain('Open Location');
    });

    it('offers Open Location and Share Event in More', async () => {
      const s = await renderScreen(event());
      s.openMore();
      expect(s.menuLabels()).toEqual([
        'Open Location',
        'Share Event',
        'Share Card',
        'Add to Collection',
        'Move to Vault',
        'Refresh',
      ]);
    });

    it('selecting Open Location closes More and opens maps via the existing handler', async () => {
      const s = await renderScreen(event());
      s.openMore();
      await s.selectInMenu('Open Location');
      expect(s.menu()).toHaveLength(0);
      expect(Linking.openURL).toHaveBeenCalledWith(
        'https://www.google.com/maps/search/?api=1&query=Main%20Hall',
      );
    });
  });

  describe('C. place with location', () => {
    it('uses Open Map as contextual Quick and hides Save for Trip', async () => {
      const s = await renderScreen(buildMemory({ memoryType: 'place' }, [['type', 'place'], ['location', 'Cafe Uno']]));
      expect(s.directLabels()).toEqual(['Open Map', 'Set Reminder', 'More (...)', 'Delete Memory', 'Back']);
      s.openMore();
      expect(s.menuLabels()).toContain('Share Place');
      expect(s.menuLabels()).not.toContain('Save for Trip');
      expect(s.directLabels()).not.toContain('Save for Trip');
    });
  });

  describe('D. product', () => {
    const product = () =>
      buildMemory({ memoryType: 'product', sourceUri: 'https://shop.example/p/1' }, [['type', 'product']]);

    it('uses Open Product as contextual Quick; Compare and Add to Collection in More; no Save for Later', async () => {
      const s = await renderScreen(product());
      expect(s.directLabels()).toEqual(['Open Product', 'Set Reminder', 'More (...)', 'Delete Memory', 'Back']);
      s.openMore();
      expect(s.menuLabels()).toEqual(['Compare', 'Share Card', 'Add to Collection', 'Move to Vault', 'Refresh']);
      expect(s.menuLabels()).not.toContain('Save for Later');
    });

    it('Compare navigates via the existing handler', async () => {
      const s = await renderScreen(product());
      s.openMore();
      await s.selectInMenu('Compare');
      expect(mockRouter.push).toHaveBeenCalledWith('/compare/mem-1');
    });

    it('Add to Collection opens the existing Collection Picker', async () => {
      const s = await renderScreen(product());
      s.openMore();
      await s.selectInMenu('Add to Collection');
      const picker = s.root.findAll((n) => n.type === 'Modal' && textOf(n).startsWith('Add to Collection'));
      expect(picker).toHaveLength(1);
    });
  });

  describe('E. article', () => {
    const article = () => buildMemory({ memoryType: 'article' }, [['type', 'article']]);

    it('uses Ask About This as contextual Quick; Summarize and Key Points in More; no Related Memories action', async () => {
      const s = await renderScreen(article());
      expect(s.directLabels()).toEqual(['Ask About This', 'Set Reminder', 'More (...)', 'Delete Memory', 'Back']);
      s.openMore();
      expect(s.menuLabels()).toEqual(['Summarize', 'Key Points', 'Share Card', 'Add to Collection', 'Move to Vault', 'Refresh']);
      expect(s.menuLabels()).not.toContain('Related Memories');
      expect(s.root.findAll((n) => n.type === ('RelatedMemoriesSection' as any))).toHaveLength(1);
    });

    it('Summarize calls the existing summarize endpoint', async () => {
      (client.summarizeMemory as jest.Mock).mockResolvedValue('A summary');
      const s = await renderScreen(article());
      s.openMore();
      await s.selectInMenu('Summarize');
      expect(client.summarizeMemory).toHaveBeenCalledWith('token', 'mem-1');
      expect(Alert.alert).toHaveBeenCalledWith('Summary', 'A summary');
    });
  });

  describe('F/G. More interaction', () => {
    it('Cancel closes More without invoking any action', async () => {
      const s = await renderScreen(buildMemory());
      s.openMore();
      const cancel = buttonsIn(s.menu()[0]).find((b) => textOf(b) === 'Cancel')!;
      await act(async () => cancel.props.onPress());
      expect(s.menu()).toHaveLength(0);
      expect(Alert.alert).not.toHaveBeenCalled();
      expect(client.lockMemory).not.toHaveBeenCalled();
    });

    it('Refresh refetches detail and status', async () => {
      const s = await renderScreen(buildMemory());
      (client.fetchMemoryDetail as jest.Mock).mockClear();
      (client.fetchProcessingStatus as jest.Mock).mockClear();
      s.openMore();
      await s.selectInMenu('Refresh');
      expect(client.fetchMemoryDetail).toHaveBeenCalledTimes(1);
      expect(client.fetchProcessingStatus).toHaveBeenCalledTimes(1);
    });

    it('Move to Vault keeps its confirmation and mutation', async () => {
      (client.lockMemory as jest.Mock).mockResolvedValue({});
      const s = await renderScreen(buildMemory());
      s.openMore();
      await s.selectInMenu('Move to Vault');
      expect(Alert.alert).toHaveBeenCalledWith('Move to Vault?', expect.any(String), expect.any(Array));
      expect(client.lockMemory).not.toHaveBeenCalled();
      const buttons = (Alert.alert as jest.Mock).mock.calls[0][2];
      // Moving to the Vault is not destructive, so it must not use Delete's styling.
      expect(buttons.find((b: any) => b.text === 'Move to Vault').style).toBe('default');
      await act(async () => buttons.find((b: any) => b.text === 'Move to Vault').onPress());
      await flush();
      expect(client.lockMemory).toHaveBeenCalledWith('token', 'mem-1');
    });
  });

  describe('H. Delete', () => {
    it('stays outside More and keeps confirmation, mutation and navigation', async () => {
      (client.deleteMemory as jest.Mock).mockResolvedValue({});
      const s = await renderScreen(buildMemory());
      await s.press('Delete Memory');
      expect(Alert.alert).toHaveBeenCalledWith('Delete Memory?', expect.any(String), expect.any(Array));
      expect(client.deleteMemory).not.toHaveBeenCalled();
      const buttons = (Alert.alert as jest.Mock).mock.calls[0][2];
      expect(buttons.find((b: any) => b.text === 'Delete').style).toBe('destructive');
      await act(async () => buttons.find((b: any) => b.text === 'Delete').onPress());
      await flush();
      expect(client.deleteMemory).toHaveBeenCalledWith('token', 'mem-1');
      expect(mockRouter.push).toHaveBeenCalledWith('/(tabs)/memories');
    });
  });

  describe('I. vault-scoped memory on the private screen', () => {
    it('keeps Share Card, Add to Collection and Move to Vault unavailable', async () => {
      const s = await renderScreen(buildMemory({ securityScope: 'vault' }));
      expect(textOf(s.root)).toContain('Vault content cannot be added to collections');
      s.openMore();
      expect(s.menuLabels()).toEqual(['Refresh']);
    });
  });

  describe('Back (the memory route has no header back affordance)', () => {
    it('goes back when there is history', async () => {
      mockRouter.canGoBack.mockReturnValue(true);
      const s = await renderScreen(buildMemory());
      await s.press('Back');
      expect(mockRouter.back).toHaveBeenCalledTimes(1);
      expect(mockRouter.replace).not.toHaveBeenCalled();
    });

    it('falls back to Home when opened without history (share or deep link)', async () => {
      mockRouter.canGoBack.mockReturnValue(false);
      const s = await renderScreen(buildMemory());
      await s.press('Back');
      expect(mockRouter.back).not.toHaveBeenCalled();
      expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)/');
    });
  });
});

describe('Memory Detail resolved adoption (PR3)', () => {
  const card = (s: Awaited<ReturnType<typeof renderScreen>>, type: string) => s.root.findByType(type as any).props;
  const view = (value: unknown, source: 'user' | 'ai' | 'original', confidence: number | null) => ({
    value,
    source,
    confidence,
  });
  const eventMemory = (overrides: Partial<client.Memory> = {}) =>
    buildMemory({
      memoryType: 'place',
      title: 'https://example.com/raw',
      aiInferences: [
        { id: 'a', memoryId: 'mem-1', field: 'date', valueJson: '1999-01-01', confidence: 0.99, modelVersion: 't', createdAt: '2026-09-01T10:00:00Z' },
        { id: 'b', memoryId: 'mem-1', field: 'location', valueJson: 'Raw Hall', confidence: 0.99, modelVersion: 't', createdAt: '2026-09-01T10:00:00Z' },
        { id: 'c', memoryId: 'mem-1', field: 'type', valueJson: 'PLACE', confidence: 0.99, modelVersion: 't', createdAt: '2026-09-01T10:00:00Z' },
      ],
      userConfirmations: [
        { id: 'uc', memoryId: 'mem-1', userId: 'user-1', field: 'location', confirmedValue: 'Raw Confirmed', createdAt: '2026-09-01T10:00:00Z' },
      ],
      resolved: {
        title: view('Jazz Night', 'ai', 0.9) as any,
        type: view('EVENT', 'ai', 0.9) as any,
        date: view('2026-10-02', 'user', null) as any,
        summary: view('An evening of jazz', 'ai', 0.55) as any,
      },
      ...overrides,
    });

  it('renders resolved values and type, not conflicting raw inferences, confirmations or memoryType', async () => {
    const s = await renderScreen(eventMemory());

    expect(s.root.findAllByType('PlaceCard' as any)).toHaveLength(0);
    const props = card(s, 'EventCard');
    expect(props.aiDate).toBe('2026-10-02');
    expect(props.aiSummary).toBe('An evening of jazz');
    // location exists only in raw data: resolved omits it, so it is unresolved
    expect(props.aiLocation).toBeNull();
    expect(card(s, 'CardHeader').title).toBe('Jazz Night');
  });

  it('is independent of raw inference order', async () => {
    const memory = eventMemory();
    const reversed = { ...memory, aiInferences: [...(memory.aiInferences ?? [])].reverse() };
    const first = card(await renderScreen(memory), 'EventCard');
    const second = card(await renderScreen(reversed), 'EventCard');
    expect(second.aiDate).toBe(first.aiDate);
  });

  it('derives confirmed state and confidence from resolved source/confidence', async () => {
    const confirmed = card(await renderScreen(eventMemory()), 'EventCard');
    expect(confirmed.isDateConfirmed).toBe(true);
    expect(confirmed.dateConfidence).toBeNull();

    const lowConfidence = card(
      await renderScreen(eventMemory({ resolved: { type: view('EVENT', 'ai', 0.9) as any, date: view('2026-10-02', 'ai', 0.4) as any } })),
      'EventCard',
    );
    expect(lowConfidence.isDateConfirmed).toBe(false);
    expect(lowConfidence.dateConfidence).toBe(0.4);
  });

  it('falls back to the raw title only when resolved.title is missing', async () => {
    const s = await renderScreen(eventMemory({ resolved: { type: view('EVENT', 'ai', 0.9) as any } }));
    expect(card(s, 'CardHeader').title).toBe('https://example.com/raw');
  });

  it('renders generic when resolved.type is missing, ignoring raw memoryType', async () => {
    const s = await renderScreen(buildMemory({ memoryType: 'event', resolved: {} }));
    expect(s.root.findAllByType('GenericCard' as any)).toHaveLength(1);
    expect(s.root.findAllByType('EventCard' as any)).toHaveLength(0);
  });

  it('passes resolved (server-decrypted) sensitive fields to DocumentCard', async () => {
    const s = await renderScreen(
      buildMemory({
        resolved: {
          type: view('DOCUMENT', 'ai', 0.9) as any,
          documentNumber: view('P1234567', 'ai', 0.8) as any,
          owner: view('Jane Doe', 'user', null) as any,
        },
      }),
    );
    const props = card(s, 'DocumentCard');
    expect(props.aiDocumentNumber).toBe('P1234567');
    expect(props.aiOwner).toBe('Jane Doe');
    expect(props.fieldConfirmations.owner).toBe(true);
    expect(props.aiIssuer).toBeNull();
  });

  it('no longer shows the raw "AI inferences available" text', async () => {
    const s = await renderScreen(buildMemory({ resolved: {} }, [['category', 'x']]));
    expect(textOf(s.root)).not.toContain('AI inferences available');
  });

  it('after a confirmation, refetches Detail and invalidates the Memories list', async () => {
    const s = await renderScreen(eventMemory());
    const invalidate = jest.spyOn(s.queryClient, 'invalidateQueries');
    const fetchesBefore = (client.fetchMemoryDetail as jest.Mock).mock.calls.length;

    await act(async () => {
      card(s, 'EventCard').onConfirmed();
    });
    await flush();

    expect((client.fetchMemoryDetail as jest.Mock).mock.calls.length).toBeGreaterThan(fetchesBefore);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['memories'] });
  });
});
