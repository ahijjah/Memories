import React from 'react';
import TestRenderer, { act, ReactTestRenderer } from 'react-test-renderer';
import { useAuth } from '@clerk/clerk-expo';
import { useIncomingShare } from 'expo-sharing';
import { createMemory } from '@/src/api/client';
import { uploadPhotoToMemory } from '@/src/utils/photo-upload';
import { SHARE_DIAG_PREFIX, logShareDiag } from '@/src/diagnostics/share-diag';
import { redirectSystemPath } from '@/app/+native-intent';
import HandleShareScreen from '@/app/handle-share';
import { RootLayoutNav } from '@/app/_layout';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  ScrollView: 'ScrollView',
  ActivityIndicator: 'ActivityIndicator',
}));
jest.mock('../global.css', () => ({}));
jest.mock('expo-secure-store', () => ({}));
const mockRouter = { push: jest.fn(), replace: jest.fn(), navigate: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => {
  const mockReact = require('react');
  const Stack = (props: any) => mockReact.createElement('Stack', props);
  Stack.Protected = (props: any) => mockReact.createElement('Protected', props);
  Stack.Screen = (props: any) => mockReact.createElement('Screen', props);
  return { Stack, useRouter: () => mockRouter };
});
jest.mock('@clerk/clerk-expo', () => ({ ClerkProvider: ({ children }: any) => children, useAuth: jest.fn() }));
jest.mock('expo-sharing', () => ({ useIncomingShare: jest.fn() }));
jest.mock('uuid', () => ({ v4: () => '00000000-0000-4000-8000-000000000000' }));
jest.mock('@/src/api/client', () => ({ createMemory: jest.fn() }));
jest.mock('@/src/utils/photo-upload', () => ({ uploadPhotoToMemory: jest.fn() }));

// Sentinels that must never appear in a diagnostic line.
const SENTINEL_URL = 'https://www.facebook.com/share/p/SENTINELSHARETOKEN/?mibextid=SENTINELQUERY';
const SENTINEL_TEXT = `SENTINELCAPTION ${SENTINEL_URL}`;
const SENTINEL_TOKEN = 'SENTINELBEARERTOKEN';
const FORBIDDEN = /SENTINEL|facebook|https?:|share\/p|mibextid|cloud\.ai970|memories:\/\/|content:\/\/|user_|@/i;

let infoSpy: jest.SpyInstance;
const diagLines = () =>
  infoSpy.mock.calls.filter((call) => call[0] === SHARE_DIAG_PREFIX).map((call) => call.slice(1).join(' '));
const diagEvents = () => diagLines().map((line) => JSON.parse(line));

function expectPrivacySafe() {
  for (const line of diagLines()) {
    expect(line).not.toMatch(FORBIDDEN);
    const parsed = JSON.parse(line);
    for (const value of Object.values(parsed)) {
      expect(['string', 'boolean', 'number']).toContain(typeof value);
      if (typeof value === 'string') expect(value).toMatch(/^[a-z_]+$/);
      if (typeof value === 'number') expect(value).toBeLessThanOrEqual(99);
    }
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => infoSpy.mockRestore());

// The pre-diagnostics implementation, verbatim, to prove the routing result is unchanged.
async function baseRedirect({ path }: { path: string; initial: boolean }) {
  try {
    if (new URL(path).hostname === 'expo-sharing') return '/handle-share';
    return path;
  } catch {
    return '/';
  }
}

describe('+native-intent diagnostics', () => {
  const SHARE_URI = 'cloud.ai970.memories://expo-sharing';
  const cases: [string, string, string, boolean][] = [
    ['share URI', SHARE_URI, 'expo_sharing', true],
    ['share URI with trailing slash', `${SHARE_URI}/`, 'expo_sharing', true],
    ['unrelated https link', SENTINEL_URL, 'passthrough', false],
    ['app deep link', 'cloud.ai970.memories:///memory/SENTINELID', 'passthrough', false],
    ['marker in path but not hostname', 'cloud.ai970.memories://host/expo-sharing', 'passthrough', true],
    ['unparseable input', `SENTINEL not a url ${SENTINEL_TEXT}`, 'parse_error', false],
    ['empty input', '', 'parse_error', false],
  ];

  it.each(cases)('%s -> same result as before, outcome enum only', async (_label, path, outcome, marker) => {
    for (const initial of [true, false]) {
      infoSpy.mockClear();
      await expect(redirectSystemPath({ path, initial })).resolves.toBe(await baseRedirect({ path, initial }));
      expect(diagEvents()).toEqual([{ event: 'native_intent', initial, outcome, expoSharingMarker: marker }]);
      expectPrivacySafe();
    }
  });

  it('a throwing console cannot change the routing result', async () => {
    infoSpy.mockImplementation(() => {
      throw new Error('console broken');
    });
    for (const [, path] of cases) {
      await expect(redirectSystemPath({ path, initial: true })).resolves.toBe(await baseRedirect({ path, initial: true }));
    }
  });
});

describe('logShareDiag', () => {
  it('writes one prefixed JSON line and bounds counts', () => {
    logShareDiag({ event: 'share_hook_state', isResolving: false, hasError: false, sharedCount: 1000, resolvedCount: -3 });
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(diagEvents()).toEqual([
      { event: 'share_hook_state', isResolving: false, hasError: false, sharedCount: 99, resolvedCount: 0 },
    ]);
  });

  it('never throws', () => {
    infoSpy.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(() => logShareDiag({ event: 'handle_share_mount' })).not.toThrow();
  });
});

describe('RootLayoutNav diagnostics', () => {
  function render(auth: Record<string, unknown>) {
    (useAuth as jest.Mock).mockReturnValue(auth);
    let root!: ReactTestRenderer;
    act(() => {
      root = TestRenderer.create(React.createElement(RootLayoutNav));
    });
    return root;
  }

  it('logs auth-gate transitions only, without identity, and does not navigate', () => {
    // Identity fields present on the auth object must never be logged.
    const identity = { userId: 'user_SENTINELUSER', sessionId: 'sess_SENTINEL', orgId: 'org_SENTINEL' };
    const root = render({ isLoaded: false, isSignedIn: undefined, ...identity });
    expect(root.toJSON()).toBeNull();

    act(() => root.update(React.createElement(RootLayoutNav))); // same state: no new line
    (useAuth as jest.Mock).mockReturnValue({ isLoaded: true, isSignedIn: true, ...identity });
    act(() => root.update(React.createElement(RootLayoutNav)));
    act(() => root.update(React.createElement(RootLayoutNav))); // same state again

    expect(diagEvents()).toEqual([
      { event: 'root_auth_state', clerkLoaded: false, signedIn: false },
      { event: 'root_auth_state', clerkLoaded: true, signedIn: true },
    ]);
    expectPrivacySafe();
    expect(root.root.findAllByType('Protected' as any).map((group) => group.props.guard)).toEqual([true, false]);
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockRouter.navigate).not.toHaveBeenCalled();
  });
});

describe('handle-share diagnostics', () => {
  const clear = jest.fn();
  const hook = (overrides: Record<string, unknown>) => ({
    sharedPayloads: [],
    resolvedSharedPayloads: [],
    isResolving: false,
    error: null,
    clearSharedPayloads: clear,
    refreshSharePayloads: jest.fn(),
    ...overrides,
  });
  const urlPayload = {
    value: SENTINEL_URL,
    shareType: 'url',
    mimeType: 'text/plain',
    contentType: 'website',
    contentUri: SENTINEL_URL,
    contentMimeType: 'text/html',
    originalName: 'SENTINELNAME',
    contentSize: 1,
  };

  beforeEach(() => {
    (useAuth as jest.Mock).mockReturnValue({ getToken: jest.fn().mockResolvedValue(SENTINEL_TOKEN) });
    (createMemory as jest.Mock).mockResolvedValue({ id: 'mem-1' });
  });

  async function renderShare() {
    let root!: ReactTestRenderer;
    await act(async () => {
      root = TestRenderer.create(React.createElement(HandleShareScreen));
    });
    return root;
  }

  it('empty share: logs mount and a zero-count hook state, makes no request and does not navigate', async () => {
    (useIncomingShare as jest.Mock).mockReturnValue(hook({}));

    await renderShare();

    expect(diagEvents()).toEqual([
      { event: 'handle_share_mount' },
      { event: 'share_hook_state', isResolving: false, hasError: false, sharedCount: 0, resolvedCount: 0 },
    ]);
    expect(createMemory).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('URL share: logs counts only; creates the Memory exactly as before', async () => {
    (useIncomingShare as jest.Mock).mockReturnValue(
      hook({ sharedPayloads: [{ value: SENTINEL_URL, shareType: 'url', mimeType: 'text/plain' }], resolvedSharedPayloads: [urlPayload] }),
    );

    await renderShare();

    expect(createMemory).toHaveBeenCalledTimes(1);
    expect(createMemory).toHaveBeenCalledWith(
      SENTINEL_TOKEN,
      'url',
      '00000000-0000-4000-8000-000000000000',
      SENTINEL_URL,
      SENTINEL_URL,
    );
    expect(diagEvents()).toEqual([
      { event: 'handle_share_mount' },
      { event: 'share_hook_state', isResolving: false, hasError: false, sharedCount: 1, resolvedCount: 1 },
    ]);
    expectPrivacySafe();
  });

  it('resolving then error: logs transitions with hasError only, never the error message', async () => {
    const hookState = { current: hook({ isResolving: true, sharedPayloads: [{ value: SENTINEL_TEXT, shareType: 'text', mimeType: 'text/plain' }] }) };
    (useIncomingShare as jest.Mock).mockImplementation(() => hookState.current);
    const root = await renderShare();

    hookState.current = hook({
      isResolving: false,
      sharedPayloads: [{ value: SENTINEL_TEXT, shareType: 'text', mimeType: 'text/plain' }],
      error: new Error(`Failed to resolve shared data: ${SENTINEL_URL}`),
    });
    await act(async () => root.update(React.createElement(HandleShareScreen)));
    await act(async () => root.update(React.createElement(HandleShareScreen))); // unchanged: no new line

    expect(diagEvents()).toEqual([
      { event: 'handle_share_mount' },
      { event: 'share_hook_state', isResolving: true, hasError: false, sharedCount: 1, resolvedCount: 0 },
      { event: 'share_hook_state', isResolving: false, hasError: true, sharedCount: 1, resolvedCount: 0 },
    ]);
    expectPrivacySafe();
    expect(createMemory).not.toHaveBeenCalled();
    expect(uploadPhotoToMemory).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
  });
});
