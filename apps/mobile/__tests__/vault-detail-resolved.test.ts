import React from 'react';
import TestRenderer, { act, ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-expo';
import * as vaultAuth from '@/src/utils/vault-auth';
import * as client from '@/src/api/client';
import VaultDetailScreen from '@/app/vault/[id]';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native', () => {
  const mockReact = require('react');
  return {
    View: 'View',
    Text: 'Text',
    ScrollView: 'ScrollView',
    ActivityIndicator: 'ActivityIndicator',
    TouchableOpacity: 'TouchableOpacity',
    TextInput: 'TextInput',
    Image: 'Image',
    FlatList: 'FlatList',
    Modal: ({ visible, children }: any) => (visible ? mockReact.createElement('Modal', null, children) : null),
    Alert: { alert: jest.fn() },
    Linking: { openURL: jest.fn(), canOpenURL: jest.fn() },
    Share: { share: jest.fn() },
    Platform: { OS: 'android' },
  };
});

// useFocusEffect is driven by the test: focus() runs the effect, blur() runs its cleanup,
// matching React Navigation's focus/blur lifecycle.
let focusEffect: (() => void | (() => void)) | null = null;
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'vault-1' }),
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    focusEffect = effect;
  },
}));
jest.mock('@clerk/clerk-expo', () => ({ useAuth: jest.fn() }));
jest.mock('@/src/utils/vault-auth', () => ({
  checkBiometricEnrollment: jest.fn(),
  authenticateVault: jest.fn(),
  useVaultAutoLock: jest.fn(),
  useVaultScreenProtection: jest.fn(),
}));
jest.mock('@/src/api/client', () => ({
  getVaultMemoryDetail: jest.fn(),
  getVaultProcessingStatus: jest.fn(() => Promise.resolve({ processingState: 'understood' })),
  listPeople: jest.fn(() => Promise.resolve([])),
}));
jest.mock('expo-image-picker', () => ({}), { virtual: true });
jest.mock('expo-calendar/legacy', () => ({}), { virtual: true });
jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker', { virtual: true });
jest.mock('@/src/utils/photo-upload', () => ({}));
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
jest.mock('@/src/components/AuthenticatedAssetImage', () => ({ AuthenticatedAssetImage: 'AuthenticatedAssetImage' }));
jest.mock('@/src/components/RelatedMemoriesSection', () => ({ RelatedMemoriesSection: 'RelatedMemoriesSection' }));

function textOf(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('');
}

const flush = () => act(async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
});

const view = (value: unknown, source: 'user' | 'ai' | 'original', confidence: number | null): any => ({
  value,
  source,
  confidence,
});

const vaultMemory = (overrides: Record<string, unknown> = {}) => ({
  id: 'vault-1',
  userId: 'user-1',
  sourceType: 'url',
  title: 'Raw scan',
  memoryType: 'event',
  capturedAt: '2026-09-01T10:00:00Z',
  processingState: 'understood',
  lifecycleState: 'active',
  securityScope: 'vault',
  idempotencyKey: 'idem',
  assets: [],
  aiInferences: [
    { id: 'a', memoryId: 'vault-1', field: 'documentNumber', valueJson: 'RAW-NUMBER', confidence: 0.99, modelVersion: 't', createdAt: '2026-09-01T10:00:00Z' },
  ],
  userConfirmations: [
    { id: 'n', memoryId: 'vault-1', userId: 'user-1', field: 'notes', confirmedValue: 'Keep in the safe', createdAt: '2026-09-01T10:00:00Z' },
    { id: 'o', memoryId: 'vault-1', userId: 'user-1', field: 'owner', confirmedValue: 'Raw Owner', createdAt: '2026-09-01T10:00:00Z' },
  ],
  resolved: {
    title: view('Passport', 'ai', 0.9),
    type: view('DOCUMENT', 'ai', 0.9),
    documentNumber: view('P7654321', 'ai', 0.8),
    owner: view('Jane Doe', 'user', null),
  },
  createdAt: '2026-09-01T10:00:00Z',
  updatedAt: '2026-09-01T10:00:00Z',
  ...overrides,
});

describe('Vault Detail resolved adoption (PR3)', () => {
  let root: ReactTestRenderer;

  const renderUnlocked = async (memory: ReturnType<typeof vaultMemory>) => {
    (client.getVaultMemoryDetail as jest.Mock).mockResolvedValue(memory);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() => {
      root = TestRenderer.create(
        React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(VaultDetailScreen)),
      );
    });
    await act(async () => {
      focusEffect!();
    });
    await flush();
    const unlock = root.root.findAllByType('TouchableOpacity' as any).find((node) => textOf(node) === 'Unlock Vault');
    await act(async () => {
      await unlock!.props.onPress();
    });
    await flush();
  };

  beforeEach(() => {
    jest.clearAllMocks();
    focusEffect = null;
    (useAuth as jest.Mock).mockReturnValue({ getToken: jest.fn().mockResolvedValue('token') });
    (vaultAuth.checkBiometricEnrollment as jest.Mock).mockResolvedValue({ hasHardware: true, isEnrolled: true });
    (vaultAuth.authenticateVault as jest.Mock).mockResolvedValue(true);
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  it('renders resolved fields and type, including server-decrypted sensitive values', async () => {
    await renderUnlocked(vaultMemory());

    expect(root.root.findAllByType('EventCard' as any)).toHaveLength(0);
    const props = root.root.findByType('DocumentCard' as any).props;
    expect(props.aiDocumentNumber).toBe('P7654321');
    expect(props.aiOwner).toBe('Jane Doe');
    expect(props.aiIssuer).toBeNull();
    expect(root.root.findByType('CardHeader' as any).props.title).toBe('Passport');
  });

  it('keeps reading notes from the raw notes confirmation', async () => {
    await renderUnlocked(vaultMemory());
    expect(textOf(root.root)).toContain('Keep in the safe');
  });

  it('never shows the photo prompt for Vault content, including canonical EVENT', async () => {
    await renderUnlocked(vaultMemory({ resolved: { type: view('EVENT', 'ai', 0.9) } }));
    expect(root.root.findAllByType('EventCard' as any)).toHaveLength(1);
    expect(textOf(root.root)).not.toContain('Want a photo of this for better details?');
  });

  it('renders generic when resolved.type is missing, ignoring raw memoryType', async () => {
    await renderUnlocked(vaultMemory({ resolved: {} }));
    expect(root.root.findAllByType('GenericCard' as any)).toHaveLength(1);
    expect(root.root.findAllByType('EventCard' as any)).toHaveLength(0);
  });
});
