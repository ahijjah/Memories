import React from 'react';
import TestRenderer, { act, ReactTestRenderer } from 'react-test-renderer';
import { requireOptionalNativeModule } from 'expo';
import { useAuth } from '@clerk/clerk-expo';
import { useIncomingShare } from 'expo-sharing';
import { createMemory } from '@/src/api/client';
import {
  MAX_CLIP_ITEMS,
  MAX_OTHER_EXTRAS,
  SHARE_DIAG_PREFIX,
  logShareIntentShape,
  sanitizeShareIntentShape,
} from '@/modules/share-intent-diag';
import HandleShareScreen from '@/app/handle-share';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn() }));
jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  ScrollView: 'ScrollView',
  ActivityIndicator: 'ActivityIndicator',
}));
const mockRouter = { push: jest.fn(), replace: jest.fn(), navigate: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@clerk/clerk-expo', () => ({ useAuth: jest.fn() }));
jest.mock('expo-sharing', () => ({ useIncomingShare: jest.fn() }));
jest.mock('uuid', () => ({ v4: () => '00000000-0000-4000-8000-000000000000' }));
jest.mock('@/src/api/client', () => ({ createMemory: jest.fn() }));
jest.mock('@/src/utils/photo-upload', () => ({ uploadPhotoToMemory: jest.fn() }));

const SENTINEL_URL = 'https://www.facebook.com/share/p/SENTINELTOKEN/?mibextid=SENTINELQUERY';
const SENTINEL_VALUES = [
  SENTINEL_URL,
  'content://com.facebook.katana.provider/SENTINELURI/1234567890123',
  'SENTINEL caption for post 1234567890123 by user@example.com',
  'Bearer SENTINEL.eyJhbGciOi.SENTINEL',
  '<a href="https://SENTINELHOST">SENTINELHTML</a>',
  'SENTINEL\n\r\u0000‮',
];
const FORBIDDEN = /SENTINEL|facebook|https?:|content:|@|Bearer|eyJ|1234567890123|mibextid|\n|\r|\u0000|‮/i;

const VALID = {
  action: 'send',
  typeCategory: 'text',
  hasText: true,
  hasSubject: true,
  hasTitle: false,
  hasHtml: false,
  hasStream: false,
  textLenBucket: '1-100',
  textIsSingleUrl: true,
  subjectLenBucket: '101-500',
  htmlLenBucket: '0',
  clipItemCount: 1,
  clipItems: [{ hasText: true, hasUri: false, hasHtml: false }],
  clipTextMatchesExtraText: true,
  otherExtraCount: 2,
};
const ALLOWED_KEYS = Object.keys(VALID).sort();

let infoSpy: jest.SpyInstance;
const diagLines = () =>
  infoSpy.mock.calls.filter((call) => call[0] === SHARE_DIAG_PREFIX).map((call) => call.slice(1).join(' '));
const diagEvents = () => diagLines().map((line) => JSON.parse(line));
const nativeReturning = (impl: () => unknown) =>
  (requireOptionalNativeModule as jest.Mock).mockReturnValue({ getShareIntentShape: jest.fn(impl) });
// The native module returns a fixed-status envelope; `ok` carries the shape.
const nativeOk = (shape: unknown) => nativeReturning(() => ({ status: 'ok', shape }));

function expectEnumOnly(event: Record<string, unknown>) {
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (value && typeof value === 'object') return Object.values(value).forEach(walk);
    if (typeof value === 'string') expect(value).toMatch(/^([a-z_]+|0|1-100|101-500|>500)$/);
    else if (typeof value === 'number') expect(value).toBeLessThanOrEqual(MAX_OTHER_EXTRAS);
    else expect(typeof value).toBe('boolean');
  };
  walk(event);
}

beforeEach(() => {
  jest.clearAllMocks();
  infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => infoSpy.mockRestore());

describe('sanitizeShareIntentShape (allowlist contract)', () => {
  it('passes a valid summary through unchanged', () => {
    expect(sanitizeShareIntentShape(VALID)).toEqual(VALID);
  });

  it('drops keys that are not in the contract', () => {
    const result = sanitizeShareIntentShape({ ...VALID, text: SENTINEL_URL, extras: { k: SENTINEL_URL }, __proto__x: 1 });
    expect(result && Object.keys(result).sort()).toEqual(ALLOWED_KEYS);
    expect(JSON.stringify(result)).not.toMatch(FORBIDDEN);
  });

  it.each(SENTINEL_VALUES)('rejects a raw string in any enum/boolean field: %j', (value) => {
    for (const key of Object.keys(VALID)) {
      if (key === 'clipItems') continue;
      expect(sanitizeShareIntentShape({ ...VALID, [key]: value })).toBeNull();
    }
    expect(sanitizeShareIntentShape({ ...VALID, clipItems: [{ hasText: value, hasUri: false, hasHtml: false }] })).toBeNull();
    expect(sanitizeShareIntentShape({ ...VALID, clipItems: value })).toBeNull();
  });

  it('drops extra clip-item fields and caps clip items and counts', () => {
    const clipItems = Array.from({ length: 40 }, () => ({ hasText: true, hasUri: true, hasHtml: false, text: SENTINEL_URL }));
    const result = sanitizeShareIntentShape({ ...VALID, clipItems, clipItemCount: 40, otherExtraCount: 100000 });
    expect(result?.clipItems).toHaveLength(MAX_CLIP_ITEMS);
    expect(result?.clipItems[0]).toEqual({ hasText: true, hasUri: true, hasHtml: false });
    expect(result?.clipItemCount).toBe(MAX_CLIP_ITEMS);
    expect(result?.otherExtraCount).toBe(MAX_OTHER_EXTRAS);
    expect(JSON.stringify(result)).not.toMatch(FORBIDDEN);
  });

  it.each([-1, 1.5, NaN, Infinity, '3'])('rejects invalid counts: %p', (count) => {
    expect(sanitizeShareIntentShape({ ...VALID, otherExtraCount: count })).toBeNull();
  });

  it('rejects non-objects and hostile getters without throwing', () => {
    for (const value of [null, undefined, 42, SENTINEL_URL, [], true]) {
      expect(sanitizeShareIntentShape(value)).toBeNull();
    }
    const hostile = { ...VALID };
    Object.defineProperty(hostile, 'action', { get: () => { throw new Error(SENTINEL_URL); } });
    expect(sanitizeShareIntentShape(hostile)).toBeNull();
    expect(sanitizeShareIntentShape({ ...VALID, clipItems: new Proxy([], { get: () => { throw new Error(SENTINEL_URL); } }) })).toBeNull();
  });
});

describe('logShareIntentShape', () => {
  it('logs one share_intent_shape event with only allowlisted fields', () => {
    nativeOk({ ...VALID, text: SENTINEL_URL });

    logShareIntentShape();

    expect(requireOptionalNativeModule).toHaveBeenCalledWith('ShareIntentDiag');
    const events = diagEvents();
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('share_intent_shape');
    expect(Object.keys(events[0]).filter((k) => k !== 'event').sort()).toEqual(ALLOWED_KEYS);
    expectEnumOnly(events[0]);
    expect(diagLines()[0]).not.toMatch(FORBIDDEN);
  });

  it.each([
    ['module_missing', () => (requireOptionalNativeModule as jest.Mock).mockReturnValue(null)],
    ['module_missing', () => (requireOptionalNativeModule as jest.Mock).mockReturnValue({})],
    ['no_intent', () => nativeReturning(() => ({ status: 'no_intent' }))],
    ['no_intent', () => nativeReturning(() => ({ status: 'no_intent', detail: SENTINEL_URL }))],
    ['native_error', () => nativeReturning(() => ({ status: 'native_error' }))],
    // Even if a native envelope ever carried exception data, only the fixed reason is logged.
    ['native_error', () => nativeReturning(() => ({ status: 'native_error', message: `boom ${SENTINEL_URL}`, stack: SENTINEL_VALUES[3] }))],
    ['invalid_shape', () => nativeOk({ ...VALID, action: SENTINEL_URL })],
    ['invalid_shape', () => nativeOk({ ...VALID, clipTextMatchesExtraText: SENTINEL_URL })],
    ['invalid_shape', () => nativeReturning(() => null)],
    ['invalid_shape', () => nativeReturning(() => VALID)], // un-enveloped shape is off-contract
    ['invalid_shape', () => nativeReturning(() => ({ status: SENTINEL_URL, shape: VALID }))],
    ['invalid_shape', () => nativeReturning(() => SENTINEL_URL)],
    ['js_error', () => nativeReturning(() => { throw new Error(`boom ${SENTINEL_URL}`); })],
    ['js_error', () => (requireOptionalNativeModule as jest.Mock).mockImplementation(() => { throw new Error(SENTINEL_URL); })],
  ])('reports %s as a reason enum, never the error or value', (reason, setup) => {
    setup();

    expect(() => logShareIntentShape()).not.toThrow();

    expect(diagEvents()).toEqual([{ event: 'share_intent_shape_unavailable', reason }]);
    for (const line of diagLines()) expect(line).not.toMatch(FORBIDDEN);
  });

  it('adversarial: hostile native output in every field never reaches the console', () => {
    for (const value of SENTINEL_VALUES) {
      infoSpy.mockClear();
      const hostile: Record<string, unknown> = { extra: value, [value]: value, clipItems: [{ hasText: true, hasUri: true, hasHtml: true, uri: value }] };
      for (const key of Object.keys(VALID)) if (key !== 'clipItems') hostile[key] = (VALID as any)[key];
      nativeOk(hostile);
      logShareIntentShape();
      for (const key of Object.keys(VALID)) {
        if (key === 'clipItems') continue;
        nativeOk({ ...VALID, [key]: value });
        logShareIntentShape();
      }
      // Checked per console call: a joiner newline would itself match the forbidden-character check.
      for (const call of infoSpy.mock.calls) expect(call.map(String).join(' ')).not.toMatch(FORBIDDEN);
      for (const event of diagEvents()) expectEnumOnly(event);
    }
  });

  it('a native shape carrying either compared text (EXTRA_TEXT / ClipData text) never logs it', () => {
    for (const leak of [{ extraText: SENTINEL_URL }, { clipText: SENTINEL_VALUES[2] }, { extraText: SENTINEL_URL, clipText: SENTINEL_URL }]) {
      infoSpy.mockClear();
      nativeOk({ ...VALID, ...leak });
      logShareIntentShape();
      const events = diagEvents();
      expect(events).toHaveLength(1);
      expect(events[0].event).toBe('share_intent_shape');
      expect(Object.keys(events[0]).filter((k) => k !== 'event').sort()).toEqual(ALLOWED_KEYS);
      for (const line of diagLines()) expect(line).not.toMatch(FORBIDDEN);
    }
  });

  it('never throws when console.info throws', () => {
    nativeOk(VALID);
    infoSpy.mockImplementation(() => {
      throw new Error('console broken');
    });
    expect(() => logShareIntentShape()).not.toThrow();
  });
});

describe('handle-share integration', () => {
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
  const hookState = (shared: unknown[], resolved: unknown[]) => ({
    sharedPayloads: shared,
    resolvedSharedPayloads: resolved,
    isResolving: false,
    error: null,
    clearSharedPayloads: jest.fn(),
    refreshSharePayloads: jest.fn(),
  });

  beforeEach(() => {
    (useAuth as jest.Mock).mockReturnValue({ getToken: jest.fn().mockResolvedValue('SENTINELBEARERTOKEN') });
    (createMemory as jest.Mock).mockResolvedValue({ id: 'mem-1' });
  });

  async function renderShare() {
    let root!: ReactTestRenderer;
    await act(async () => {
      root = TestRenderer.create(React.createElement(HandleShareScreen));
    });
    return root;
  }

  const shared = [{ value: SENTINEL_URL, shareType: 'url', mimeType: 'text/plain' }];
  const expectUnchangedCreate = () => {
    expect(createMemory).toHaveBeenCalledTimes(1);
    expect(createMemory).toHaveBeenCalledWith(
      'SENTINELBEARERTOKEN',
      'url',
      '00000000-0000-4000-8000-000000000000',
      SENTINEL_URL,
      SENTINEL_URL,
    );
  };

  it.each([
    ['valid summary', () => nativeOk(VALID)],
    ['module missing (current APK)', () => (requireOptionalNativeModule as jest.Mock).mockReturnValue(null)],
    ['native throws', () => nativeReturning(() => { throw new Error(SENTINEL_URL); })],
    ['console.info throws', () => {
      nativeOk(VALID);
      infoSpy.mockImplementation(() => { throw new Error('console broken'); });
    }],
  ])('%s: share handling is unchanged', async (_label, setup) => {
    setup();
    (useIncomingShare as jest.Mock).mockReturnValue(hookState(shared, [urlPayload]));

    await renderShare();

    expectUnchangedCreate();
    expect(mockRouter.replace).not.toHaveBeenCalled(); // navigation still only after the 500 ms success timer
  });

  it('reads the intent shape on mount and again only when the hook reports new shared payloads', async () => {
    nativeOk(VALID);
    const state = { current: hookState(shared, [urlPayload]) };
    (useIncomingShare as jest.Mock).mockImplementation(() => state.current);
    const root = await renderShare();
    await act(async () => root.update(React.createElement(HandleShareScreen))); // same payload array

    state.current = { ...state.current, sharedPayloads: [...shared] }; // new share while mounted
    await act(async () => root.update(React.createElement(HandleShareScreen)));

    expect(diagEvents().filter((e) => e.event === 'share_intent_shape')).toHaveLength(2);
    for (const line of diagLines()) expect(line).not.toMatch(FORBIDDEN);
  });
});
