import React from 'react';
import TestRenderer, { act, ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/clerk-expo';
import * as clientApi from '@/src/api/client';
import CalendarScreen from '../calendar';

// Same host-component mocking approach as the other component specs (no react-native preset).
jest.mock('react-native', () => {
  const React = require('react');
  return {
    View: 'View',
    Text: 'Text',
    ScrollView: 'ScrollView',
    ActivityIndicator: 'ActivityIndicator',
    TouchableOpacity: 'TouchableOpacity',
    FlatList: ({ data, renderItem, keyExtractor }: any) =>
      React.createElement(
        'FlatList',
        null,
        data.map((item: any, index: number) =>
          React.createElement(React.Fragment, { key: keyExtractor(item) }, renderItem({ item, index })),
        ),
      ),
  };
});
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
// Real client module with only the network call replaced: importing an export that does not
// exist (the original `getAuthenticatedClient` bug) yields undefined and fails these tests.
jest.mock('@/src/api/client', () => ({
  ...jest.requireActual('@/src/api/client'),
  getCalendarMonth: jest.fn(),
}));

const mockGetCalendarMonth = clientApi.getCalendarMonth as jest.Mock;

const SEPTEMBER = {
  month: '2026-09',
  items: [
    { memoryId: 'mem-1', date: '2026-09-15', title: 'Conference', type: 'EVENT' },
    { memoryId: 'mem-2', date: '2026-09-15', title: 'Meeting', type: 'EVENT' },
    { memoryId: 'mem-3', date: '2026-09-20', title: 'Vacation', type: 'PLACE' },
  ],
};

function textOf(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === 'string' ? child : textOf(child)))
    .join('');
}

const texts = (root: ReactTestRenderer) => root.root.findAllByType('Text' as any).map(textOf);
const hasText = (root: ReactTestRenderer, value: string | RegExp) =>
  texts(root).some((t) => (typeof value === 'string' ? t === value : value.test(t)));

function pressText(root: ReactTestRenderer, value: string) {
  const target = root.root
    .findAllByType('TouchableOpacity' as any)
    .find((node) => node.findAllByType('Text' as any).some((t) => textOf(t) === value));
  if (!target) throw new Error(`No pressable with text ${value}`);
  act(() => target.props.onPress());
}

const flush = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });

describe('CalendarScreen', () => {
  let getToken: jest.Mock;
  let push: jest.Mock;
  let root: ReactTestRenderer;

  beforeAll(() => {
    // Only Date is faked, so React Query's timers and promises behave normally.
    jest.useFakeTimers({
      now: new Date(2026, 8, 25),
      doNotFake: [
        'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate',
        'clearImmediate', 'nextTick', 'queueMicrotask', 'hrtime', 'performance',
      ],
    });
  });
  afterAll(() => jest.useRealTimers());

  beforeEach(() => {
    jest.clearAllMocks();
    push = jest.fn();
    (useRouter as jest.Mock).mockReturnValue({ push });
    getToken = jest.fn().mockResolvedValue('clerk-token');
    // Like @clerk/clerk-expo, hand out a new getToken identity on every render.
    (useAuth as jest.Mock).mockImplementation(() => ({ getToken: (...args: unknown[]) => getToken(...args) }));
    mockGetCalendarMonth.mockResolvedValue(SEPTEMBER);
  });

  afterEach(() => {
    act(() => root?.unmount());
  });

  const render = async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() => {
      root = TestRenderer.create(
        <QueryClientProvider client={queryClient}>
          <CalendarScreen />
        </QueryClientProvider>,
      );
    });
    await flush();
  };

  it('obtains a Clerk token and requests the current month through the real client export', async () => {
    await render();

    expect(getToken).toHaveBeenCalledTimes(1);
    expect(mockGetCalendarMonth).toHaveBeenCalledTimes(1);
    expect(mockGetCalendarMonth).toHaveBeenCalledWith('clerk-token', '2026-09');
  });

  it('renders the month and the selected day items from the response', async () => {
    await render();

    expect(hasText(root, 'September 2026')).toBe(true);
    expect(hasText(root, 'Sun')).toBe(true);

    pressText(root, '15');
    expect(hasText(root, 'Tuesday, September 15, 2026')).toBe(true);
    expect(hasText(root, 'Conference')).toBe(true);
    expect(hasText(root, 'Meeting')).toBe(true);
    expect(hasText(root, 'Vacation')).toBe(false);

    pressText(root, 'Conference');
    expect(push).toHaveBeenCalledWith('/memory/mem-1');
  });

  it('shows "No memories for this day" for a day without items', async () => {
    await render();

    pressText(root, '10');
    expect(hasText(root, 'No memories for this day')).toBe(true);
  });

  it('shows the loading indicator while the request is pending', async () => {
    mockGetCalendarMonth.mockImplementation(() => new Promise(() => undefined));
    await render();

    expect(root.root.findAllByType('ActivityIndicator' as any)).toHaveLength(1);
    expect(hasText(root, 'Sun')).toBe(false);
  });

  it('shows the existing error state when the request fails', async () => {
    mockGetCalendarMonth.mockRejectedValue(new Error('Request failed with status 500'));
    await render();

    expect(hasText(root, /Failed to load calendar/)).toBe(true);
  });

  it('shows the error state and makes no request when no token is available', async () => {
    getToken.mockResolvedValue(null);
    await render();

    expect(mockGetCalendarMonth).not.toHaveBeenCalled();
    expect(hasText(root, /Failed to load calendar/)).toBe(true);
  });

  it('requests the next month with a fresh token after navigation', async () => {
    await render();
    getToken.mockResolvedValue('clerk-token-2');

    pressText(root, '›');
    await flush();

    expect(hasText(root, 'October 2026')).toBe(true);
    expect(mockGetCalendarMonth).toHaveBeenLastCalledWith('clerk-token-2', '2026-10');
  });

  it('does not refetch when re-renders hand out a new getToken identity', async () => {
    await render();
    pressText(root, '15');
    pressText(root, '20');
    await flush();

    expect(mockGetCalendarMonth).toHaveBeenCalledTimes(1);
    expect(getToken).toHaveBeenCalledTimes(1);
  });
});

describe('getCalendarMonth (real client function)', () => {
  const { getCalendarMonth } = jest.requireActual('@/src/api/client');
  const originalFetch = global.fetch;
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_URL = 'https://api.example.test';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => SEPTEMBER,
    }) as any;
  });
  afterEach(() => {
    global.fetch = originalFetch;
    process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
  });

  it('is exported and sends an authenticated GET for the month', async () => {
    expect(typeof getCalendarMonth).toBe('function');

    await expect(getCalendarMonth('clerk-token', '2026-09')).resolves.toEqual(SEPTEMBER);

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.example.test/engagement/calendar?month=2026-09');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer clerk-token');
  });

  it('encodes the month query value', async () => {
    await getCalendarMonth('clerk-token', '2026-09&x=1');

    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(
      'https://api.example.test/engagement/calendar?month=2026-09%26x%3D1',
    );
  });

  it('rejects on a non-OK response', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500 });

    await expect(getCalendarMonth('clerk-token', '2026-09')).rejects.toThrow('Request failed with status 500');
  });
});
