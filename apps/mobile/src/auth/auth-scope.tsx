import { createContext, Fragment, useContext, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useAuth } from '@clerk/clerk-expo';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { resetShareDedupe } from '@/src/utils/share-dedupe';

/**
 * AUTH-CACHE-01: React Query data is scoped to one auth identity.
 *
 * A QueryClient that has held one account's data is never exposed to another account:
 * - AuthScopedQueryProvider picks the client during render, so the first render after an identity
 *   change already provides a new, empty client (no effect has to run first).
 * - A mounted useQuery stays bound to the client it was created with, so every screen is wrapped in
 *   AuthScopedScreen (the root Stack's screenLayout), keyed by the identity: on a change each
 *   screen remounts and subscribes to the new client in that same render. While signed out,
 *   authenticated screens render nothing.
 * - The retired client's queries are cancelled and its cache cleared afterwards; nothing rendered
 *   reads from it by then, and a late response can only land in that detached client.
 * The in-memory share dedupe (share-dedupe.ts) is reset once an identity change has committed (a
 * layout effect), never during render: a render that is started and then discarded must not clear
 * the committed account's dedupe. Layout effects run before any passive effect of the same commit,
 * and the share screen reads the dedupe only from a passive effect, so it never sees the previous
 * account's entries.
 */

/** Auth identity as the cache sees it. Only a real change of identity replaces the client. */
export type AuthIdentity = 'loading' | 'signed-out' | `user:${string}`;

export function authIdentity(auth: { isLoaded: boolean; userId?: string | null }): AuthIdentity {
  if (!auth.isLoaded) return 'loading';
  return auth.userId ? `user:${auth.userId}` : 'signed-out';
}

const AuthScopeContext = createContext<AuthIdentity | null>(null);

export function useAuthIdentity(): AuthIdentity | null {
  return useContext(AuthScopeContext);
}

type Owner = Exclude<AuthIdentity, 'loading'>;

interface Scope {
  /** The identity whose data this client may hold; null until Clerk first reports one. */
  owner: Owner | null;
  client: QueryClient;
}

/**
 * Whether the share dedupe must be reset when `committed` becomes the committed owner after
 * `previousCommitted`: only on a change from one real identity to another (sign-out included), not
 * when the first identity is reported at startup and not when it is unchanged.
 */
export function shouldResetShareDedupe(previousCommitted: Owner | null, committed: Owner | null): boolean {
  return previousCommitted !== null && committed !== null && previousCommitted !== committed;
}

export function AuthScopedQueryProvider({
  children,
  createClient = () => new QueryClient(),
}: {
  children: ReactNode;
  /** For tests. */
  createClient?: () => QueryClient;
}) {
  const { isLoaded, userId } = useAuth();
  const identity = authIdentity({ isLoaded, userId });

  const scope = useRef<Scope | null>(null);
  if (scope.current === null) {
    scope.current = { owner: null, client: createClient() };
  }
  // Decided during render, not in an effect, so no render for a new identity can see the previous
  // one's client. 'loading' never changes the scope (nothing below renders while Clerk loads). The
  // first identity adopts the startup client, which has held no data; any later different identity
  // gets a new client. Token refreshes and rerenders with the same identity keep it.
  if (identity !== 'loading' && identity !== scope.current.owner) {
    scope.current =
      scope.current.owner === null
        ? { owner: identity, client: scope.current.client }
        : { owner: identity, client: createClient() };
  }
  const { client, owner } = scope.current;

  // The share dedupe follows the committed owner only. A discarded render never runs this, and the
  // ref is updated here, after commit, so it always holds the last committed owner.
  const committedOwner = useRef<Owner | null>(null);
  useLayoutEffect(() => {
    if (shouldResetShareDedupe(committedOwner.current, owner)) {
      resetShareDedupe();
    }
    committedOwner.current = owner;
  }, [owner]);

  // Retire a replaced client after it is no longer provided: stop its requests and drop its data.
  useEffect(
    () => () => {
      void client.cancelQueries();
      client.clear();
    },
    [client],
  );

  return (
    <AuthScopeContext.Provider value={identity}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </AuthScopeContext.Provider>
  );
}

/**
 * Wraps one screen of the root Stack. Keyed by the auth identity so the screen's queries remount on
 * the current identity's client; an authenticated screen renders nothing while signed out (the
 * Stack.Protected guard then removes it).
 */
export function AuthScopedScreen({ authenticated, children }: { authenticated: boolean; children: ReactNode }) {
  const identity = useAuthIdentity();
  if (authenticated && identity === 'signed-out') return null;
  return <Fragment key={identity ?? 'unscoped'}>{children}</Fragment>;
}
