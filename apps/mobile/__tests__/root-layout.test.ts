import React from 'react';
import TestRenderer, { act, ReactTestRenderer } from 'react-test-renderer';
import { useAuth } from '@clerk/clerk-expo';

jest.mock('../global.css', () => ({}));
jest.mock('expo-secure-store', () => ({}));
jest.mock('@clerk/clerk-expo', () => ({ ClerkProvider: ({ children }: any) => children, useAuth: jest.fn() }));

const mockRouter = { replace: jest.fn(), push: jest.fn(), navigate: jest.fn() };
jest.mock('expo-router', () => {
  const mockReact = require('react');
  const Stack = (props: any) => mockReact.createElement('Stack', props);
  Stack.Protected = (props: any) => mockReact.createElement('Protected', props);
  Stack.Screen = (props: any) => mockReact.createElement('Screen', props);
  return { Stack, useRouter: () => mockRouter, useSegments: () => [] };
});

import { RootLayoutNav, AUTHENTICATED_ROOT_ROUTES } from '../app/_layout';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function render(auth: { isLoaded: boolean; isSignedIn?: boolean }) {
  (useAuth as jest.Mock).mockReturnValue(auth);
  let root!: ReactTestRenderer;
  act(() => {
    root = TestRenderer.create(React.createElement(RootLayoutNav));
  });
  return root;
}

function guards(root: ReactTestRenderer) {
  return root.root.findAllByType('Protected' as any).map((group) => ({
    guard: group.props.guard,
    screens: group.findAllByType('Screen' as any).map((screen) => screen.props.name),
  }));
}

describe('RootLayoutNav', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders nothing until Clerk has loaded', () => {
    const root = render({ isLoaded: false, isSignedIn: undefined });
    expect(root.toJSON()).toBeNull();
  });

  it('uses a root Stack without headers or transition animation', () => {
    const root = render({ isLoaded: true, isSignedIn: true });
    expect(root.root.findByType('Stack' as any).props.screenOptions).toEqual({
      headerShown: false,
      animation: 'none',
    });
  });

  it('enables only the authenticated routes when signed in', () => {
    expect(guards(render({ isLoaded: true, isSignedIn: true }))).toEqual([
      { guard: true, screens: [...AUTHENTICATED_ROOT_ROUTES] },
      { guard: false, screens: ['(auth)'] },
    ]);
  });

  it('enables only the auth routes when signed out', () => {
    expect(guards(render({ isLoaded: true, isSignedIn: false }))).toEqual([
      { guard: false, screens: [...AUTHENTICATED_ROOT_ROUTES] },
      { guard: true, screens: ['(auth)'] },
    ]);
  });

  it('switches guards on a signed-in to signed-out transition without imperative navigation', () => {
    const root = render({ isLoaded: true, isSignedIn: true });
    (useAuth as jest.Mock).mockReturnValue({ isLoaded: true, isSignedIn: false });
    act(() => root.update(React.createElement(RootLayoutNav)));

    expect(guards(root).map((group) => group.guard)).toEqual([false, true]);
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockRouter.navigate).not.toHaveBeenCalled();
  });
});
