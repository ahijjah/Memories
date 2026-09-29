import React from 'react';
import TestRenderer, { act, ReactTestRenderer } from 'react-test-renderer';
import { useAuth } from '@clerk/clerk-expo';
import { QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { AuthScopedQueryProvider, AuthScopedScreen, authIdentity } from '@/src/auth/auth-scope';
import { getShareAttempt, resetShareDedupe } from '@/src/utils/share-dedupe';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let mockUuid = 0;
jest.mock('uuid', () => ({ v4: () => `00000000-0000-4000-8000-${String(++mockUuid).padStart(12, '0')}` }));

// AUTH-CACHE-01: one account's cached data is never rendered or readable by another account.

type Auth = { isLoaded: boolean; userId?: string | null };
const auth = (a: Auth) => (useAuth as jest.Mock).mockReturnValue({ ...a, isSignedIn: !!a.userId });

// A screen that loads "memories" for whoever is signed in and records what it renders.
let rendered: unknown[] = [];
let fetchMemories: jest.Mock;
function MemoriesScreen() {
  const { data } = useQuery({ queryKey: ['memories'], queryFn: () => fetchMemories() });
  rendered.push(data ?? 'no-data');
  return React.createElement('Text', null, data === undefined ? 'no-data' : String(data));
}
let seenClients: QueryClient[] = [];
function ClientProbe() {
  const client = useQueryClient();
  seenClients.push(client);
  return null;
}

let createdClients: QueryClient[] = [];
const createClient = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  createdClients.push(client);
  return client;
};

const tree = () =>
  React.createElement(
    AuthScopedQueryProvider,
    { createClient },
    React.createElement(AuthScopedScreen, { authenticated: true }, React.createElement(MemoriesScreen), React.createElement(ClientProbe)),
  );

let root: ReactTestRenderer | undefined;
async function mount(a: Auth) {
  auth(a);
  await act(async () => {
    root = TestRenderer.create(tree());
  });
}
async function switchTo(a: Auth) {
  auth(a);
  await act(async () => {
    root!.update(tree());
  });
}
const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
const latestClient = () => seenClients[seenClients.length - 1];
const shownText = () => root!.root.findAll((n) => (n.type as any) === 'Text').map((n) => n.props.children);

beforeEach(() => {
  rendered = [];
  seenClients = [];
  createdClients = [];
  fetchMemories = jest.fn();
  resetShareDedupe();
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
});

describe('authIdentity', () => {
  it('distinguishes loading, signed out and each account', () => {
    expect(authIdentity({ isLoaded: false, userId: 'user_a' })).toBe('loading');
    expect(authIdentity({ isLoaded: true, userId: null })).toBe('signed-out');
    expect(authIdentity({ isLoaded: true, userId: 'user_a' })).toBe('user:user_a');
  });
});

describe('account-scoped query cache', () => {
  it("A -> signed out -> B: B never renders or reads A's data, even before B's request resolves", async () => {
    fetchMemories.mockResolvedValue('A-private-memories');
    await mount({ isLoaded: true, userId: 'user_a' });
    await flush();
    expect(shownText()).toEqual(['A-private-memories']);
    const clientA = latestClient();

    await switchTo({ isLoaded: true, userId: null });
    // Signed out: the authenticated screen renders nothing and no longer holds A's cache.
    expect(shownText()).toEqual([]);

    const pendingB = deferred<string>();
    fetchMemories.mockReturnValue(pendingB.promise);
    rendered = [];
    await switchTo({ isLoaded: true, userId: 'user_b' });

    // B's request has not resolved: nothing of A's is visible or readable.
    expect(rendered).not.toContain('A-private-memories');
    expect(shownText()).toEqual(['no-data']);
    expect(latestClient()).not.toBe(clientA);
    expect(latestClient().getQueryData(['memories'])).toBeUndefined();
    // The retired client has been emptied.
    expect(clientA.getQueryCache().getAll()).toHaveLength(0);

    await act(async () => pendingB.resolve('B-memories'));
    await flush();
    expect(shownText()).toEqual(['B-memories']);
  });

  it("A -> B directly (no signed-out render): the mounted screen remounts on B's client in the same render", async () => {
    fetchMemories.mockResolvedValue('A-private-memories');
    await mount({ isLoaded: true, userId: 'user_a' });
    await flush();

    fetchMemories.mockReturnValue(new Promise(() => undefined));
    rendered = [];
    await switchTo({ isLoaded: true, userId: 'user_b' });

    expect(rendered).not.toContain('A-private-memories');
    expect(shownText()).toEqual(['no-data']);
  });

  it('A -> signed out removes access to A\'s cache', async () => {
    fetchMemories.mockResolvedValue('A-private-memories');
    await mount({ isLoaded: true, userId: 'user_a' });
    await flush();
    const clientA = latestClient();

    await switchTo({ isLoaded: true, userId: null });

    expect(shownText()).toEqual([]);
    expect(clientA.getQueryData(['memories'])).toBeUndefined();
  });

  it('an in-flight request of A that resolves after the switch cannot reach B', async () => {
    const pendingA = deferred<string>();
    fetchMemories.mockReturnValue(pendingA.promise);
    await mount({ isLoaded: true, userId: 'user_a' });
    const clientA = latestClient();

    fetchMemories.mockReturnValue(new Promise(() => undefined));
    await switchTo({ isLoaded: true, userId: 'user_b' });
    rendered = [];
    await act(async () => pendingA.resolve('A-private-memories'));
    await flush();

    expect(rendered).not.toContain('A-private-memories');
    expect(latestClient()).not.toBe(clientA);
    expect(latestClient().getQueryData(['memories'])).toBeUndefined();
    expect(clientA.getQueryData(['memories'])).toBeUndefined();
  });

  it('the same user rerendering (e.g. a token refresh) keeps the client and its cache', async () => {
    fetchMemories.mockResolvedValue('A-memories');
    await mount({ isLoaded: true, userId: 'user_a' });
    await flush();
    const clientA = latestClient();
    const fetches = fetchMemories.mock.calls.length;

    await switchTo({ isLoaded: true, userId: 'user_a' });
    await switchTo({ isLoaded: true, userId: 'user_a' });

    expect(latestClient()).toBe(clientA);
    expect(createdClients).toHaveLength(1);
    expect(clientA.getQueryData(['memories'])).toBe('A-memories');
    expect(fetchMemories.mock.calls.length).toBe(fetches); // no remount, no refetch
  });

  it('a different user gets a different client', async () => {
    fetchMemories.mockResolvedValue('x');
    await mount({ isLoaded: true, userId: 'user_a' });
    const clientA = latestClient();
    await switchTo({ isLoaded: true, userId: 'user_b' });

    expect(latestClient()).not.toBe(clientA);
    expect(createdClients).toHaveLength(2);
  });

  it('auth hydration (loading -> signed in) adopts the startup client without churn', async () => {
    fetchMemories.mockResolvedValue('x');
    await mount({ isLoaded: false, userId: null });
    await switchTo({ isLoaded: false, userId: null });
    await switchTo({ isLoaded: true, userId: 'user_a' });

    expect(createdClients).toHaveLength(1);
  });

  it('A -> loading -> B never reuses A\'s client', async () => {
    fetchMemories.mockResolvedValue('A-private-memories');
    await mount({ isLoaded: true, userId: 'user_a' });
    await flush();
    const clientA = latestClient();

    await switchTo({ isLoaded: false, userId: null });
    fetchMemories.mockReturnValue(new Promise(() => undefined));
    rendered = [];
    await switchTo({ isLoaded: true, userId: 'user_b' });

    expect(latestClient()).not.toBe(clientA);
    expect(rendered).not.toContain('A-private-memories');
  });
});

describe('share dedupe is scoped to the auth identity', () => {
  const FP = '[["text","same shared text",null]]';

  it('a delivery key created while A is signed in is not reused after B signs in', async () => {
    await mount({ isLoaded: true, userId: 'user_a' });
    const keyA = getShareAttempt(FP).idempotencyKey;

    await switchTo({ isLoaded: true, userId: null });
    await switchTo({ isLoaded: true, userId: 'user_b' });

    expect(getShareAttempt(FP).idempotencyKey).not.toBe(keyA);
  });

  it('a rerender or token refresh for the same user keeps the dedupe window', async () => {
    await mount({ isLoaded: true, userId: 'user_a' });
    const keyA = getShareAttempt(FP).idempotencyKey;

    await switchTo({ isLoaded: true, userId: 'user_a' });

    expect(getShareAttempt(FP).idempotencyKey).toBe(keyA);
  });

  it('auth hydration does not reset it', async () => {
    await mount({ isLoaded: false, userId: null });
    const key = getShareAttempt(FP).idempotencyKey;
    await switchTo({ isLoaded: true, userId: 'user_a' });

    expect(getShareAttempt(FP).idempotencyKey).toBe(key);
  });
});
