import '../global.css';
import { ClerkProvider, useAuth } from "@clerk/clerk-expo";
import * as SecureStore from 'expo-secure-store';
import { Stack } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { logShareDiag } from '@/src/diagnostics/share-diag';

const tokenCache = {
  async getToken(key: string) {
    try {
      const item = await SecureStore.getItemAsync(key);
      if (item) {
        console.log(`${key} was used 🎉`);
      } else {
        console.log('No values stored under key: ' + key);
      }
      return item;
    } catch (error) {
      console.error('SecureStore error reading value for key ' + key + ':', error);
      await SecureStore.deleteItemAsync(key);
      return null;
    }
  },
  async saveToken(key: string, value: string) {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch (err) {
      console.error('SecureStore error saving key ' + key + ':', err);
    }
  },
};

const queryClient = new QueryClient();

export default function RootLayout() {
  const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

  if (!publishableKey) {
    throw new Error('Missing EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY');
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ClerkProvider tokenCache={tokenCache} publishableKey={publishableKey}>
        <RootLayoutNav />
      </ClerkProvider>
    </QueryClientProvider>
  );
}

// Every root route that needs a signed-in user. Stack.Protected only removes routes that are
// explicitly declared under a false guard (unlisted filesystem routes stay registered), so each
// authenticated root route must be listed here. __tests__/root-layout-routes.test.ts fails if a
// root route is added without being listed. The first entry is the signed-in initial route.
export const AUTHENTICATED_ROOT_ROUTES = [
  '(tabs)',
  'memory/[id]',
  'vault/[id]',
  'collection/[id]',
  'compare/[id]',
  'workspace/[workspaceId]',
  'people/index',
  'handle-share',
] as const;

export const SIGNED_OUT_ROOT_ROUTES = ['(auth)'] as const;

export function RootLayoutNav() {
  const { isLoaded, isSignedIn } = useAuth();

  // Diagnostic only (share ingestion): logs auth-gate transitions as booleans, no identity.
  useEffect(() => {
    logShareDiag({ event: 'root_auth_state', clerkLoaded: isLoaded === true, signedIn: isSignedIn === true });
  }, [isLoaded, isSignedIn]);

  // Don't register either route group until Clerk knows the auth state. An initial route that
  // can't be shown yet (e.g. a share or deep link) is kept and restored once it is registered.
  if (!isLoaded) return null;

  const signedIn = isSignedIn === true;

  // A root Stack keeps earlier routes mounted, so returning from a root-level detail route
  // lands on the tab it was opened from. When a guard turns false, every route declared under
  // it is removed from history, so no signed-in screen stays reachable after sign-out.
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'none' }}>
      <Stack.Protected guard={signedIn}>
        {AUTHENTICATED_ROOT_ROUTES.map((name) => (
          <Stack.Screen key={name} name={name} />
        ))}
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        {SIGNED_OUT_ROOT_ROUTES.map((name) => (
          <Stack.Screen key={name} name={name} />
        ))}
      </Stack.Protected>
    </Stack>
  );
}
