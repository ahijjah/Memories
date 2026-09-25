import fs from 'fs';
import path from 'path';

// Everything app/_layout imports that can't load under Jest. Only the route constants are used.
jest.mock('../global.css', () => ({}));
jest.mock('expo-secure-store', () => ({}));
jest.mock('@clerk/clerk-expo', () => ({ ClerkProvider: () => null, useAuth: jest.fn() }));
jest.mock('expo-router', () => ({ Stack: () => null }));

import { AUTHENTICATED_ROOT_ROUTES, SIGNED_OUT_ROOT_ROUTES } from '../app/_layout';

const { getRoutes } = jest.requireActual('expo-router/build/getRoutes');
const { EXPO_ROUTER_CTX_IGNORE } = jest.requireActual('expo-router/_ctx-shared');

const APP_DIR = path.join(__dirname, '..', 'app');

function listFiles(dir: string, prefix = '.'): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const key = `${prefix}/${entry.name}`;
    return entry.isDirectory() ? listFiles(path.join(dir, entry.name), key) : [key];
  });
}

// The root routes Expo Router registers, built from app/ with the same file filter the
// router's own require.context uses.
function rootRouteNames(): string[] {
  const keys = listFiles(APP_DIR).filter((key) => EXPO_ROUTER_CTX_IGNORE.test(key));
  const ctx = Object.assign(() => ({ default: () => null }), {
    keys: () => keys,
    resolve: (key: string) => key,
    id: 'app',
  });
  const tree = getRoutes(ctx, { platform: 'android', skipGenerated: true, internal_stripLoadRoute: true });
  return tree.children.map((child: { route: string }) => child.route).sort();
}

describe('root layout route protection', () => {
  it('declares every root route under exactly one auth guard', () => {
    // Fails when a root route is added under app/ without listing it in _layout's protected
    // routes: Stack.Protected leaves unlisted routes reachable while signed out.
    expect(rootRouteNames()).toEqual([...AUTHENTICATED_ROOT_ROUTES, ...SIGNED_OUT_ROOT_ROUTES].sort());
  });

  it('keeps the signed-in and signed-out route lists disjoint', () => {
    const signedOut = new Set<string>(SIGNED_OUT_ROOT_ROUTES);
    expect(AUTHENTICATED_ROOT_ROUTES.filter((name) => signedOut.has(name))).toEqual([]);
  });

  it('makes (tabs) the signed-in initial route and (auth) the signed-out one', () => {
    expect(AUTHENTICATED_ROOT_ROUTES[0]).toBe('(tabs)');
    expect(SIGNED_OUT_ROOT_ROUTES).toEqual(['(auth)']);
  });
});
