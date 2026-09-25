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

const mockRouter = { push: jest.fn(), back: jest.fn() };
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

const buildMemory = (overrides: Partial<client.Memory> = {}, inferences: Inference[] = []): client.Memory => ({
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

  it('Back remains because the memory route has no header back affordance', async () => {
    const s = await renderScreen(buildMemory());
    await s.press('Back');
    expect(mockRouter.back).toHaveBeenCalled();
  });
});
