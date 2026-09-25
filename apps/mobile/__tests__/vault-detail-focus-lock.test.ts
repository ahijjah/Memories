import React from 'react';
import TestRenderer, { act, ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-expo';
import * as vaultAuth from '@/src/utils/vault-auth';
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
  // Never resolves: the unlocked screen stays in its loading state, so no content cards render.
  getVaultMemoryDetail: jest.fn(() => new Promise(() => undefined)),
  getVaultProcessingStatus: jest.fn(() => new Promise(() => undefined)),
  listPeople: jest.fn(() => new Promise(() => undefined)),
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

describe('Vault Detail focus lifecycle', () => {
  let root: ReactTestRenderer;
  let blurCleanup: void | (() => void);

  const focus = async () => {
    await act(async () => {
      blurCleanup = focusEffect!();
    });
    await flush();
  };
  const blur = () => {
    act(() => {
      if (typeof blurCleanup === 'function') blurCleanup();
    });
  };
  const screenText = () => textOf(root.root);
  const lastProtection = () => (vaultAuth.useVaultScreenProtection as jest.Mock).mock.calls.at(-1)?.[0];

  beforeEach(async () => {
    jest.clearAllMocks();
    focusEffect = null;
    (useAuth as jest.Mock).mockReturnValue({ getToken: jest.fn().mockResolvedValue('token') });
    (vaultAuth.checkBiometricEnrollment as jest.Mock).mockResolvedValue({ hasHardware: true, isEnrolled: true });
    (vaultAuth.authenticateVault as jest.Mock).mockResolvedValue(true);

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() => {
      root = TestRenderer.create(
        React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(VaultDetailScreen)),
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  const unlock = async () => {
    const button = root.root
      .findAllByType('TouchableOpacity' as any)
      .find((node) => textOf(node) === 'Unlock Vault');
    await act(async () => {
      await button!.props.onPress();
    });
  };

  it('requires authentication when focused (existing behaviour)', async () => {
    await focus();

    expect(vaultAuth.checkBiometricEnrollment).toHaveBeenCalledTimes(1);
    expect(screenText()).toContain('Vault Locked');
    expect(lastProtection()).toBe(false);
  });

  it('unlocks and enables screen-capture protection', async () => {
    await focus();
    await unlock();

    expect(vaultAuth.authenticateVault).toHaveBeenCalledTimes(1);
    expect(screenText()).not.toContain('Vault Locked');
    expect(lastProtection()).toBe(true);
  });

  it('locks again when the screen loses focus', async () => {
    await focus();
    await unlock();
    expect(lastProtection()).toBe(true);

    blur();

    expect(screenText()).toContain('Vault Locked');
    expect(lastProtection()).toBe(false);
  });

  it('requires authentication again when refocused after blur', async () => {
    await focus();
    await unlock();
    blur();
    await focus();

    expect(vaultAuth.checkBiometricEnrollment).toHaveBeenCalledTimes(2);
    expect(screenText()).toContain('Vault Locked');
  });
});
