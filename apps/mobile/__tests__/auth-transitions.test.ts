import React from 'react';
import TestRenderer, { act, ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuth, useUser, useSignIn, useSignUp } from '@clerk/clerk-expo';
import * as client from '@/src/api/client';
import AccountScreen from '@/app/(tabs)/account';
import SignIn from '@/app/(auth)/sign-in';
import SignUp from '@/app/(auth)/sign-up';

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
    Modal: ({ visible, children }: any) => (visible ? mockReact.createElement('Modal', null, children) : null),
    Alert: { alert: jest.fn() },
  };
});

// Any navigation from these screens would go through this router; none is expected.
const mockRouter = { push: jest.fn(), replace: jest.fn(), navigate: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  Link: ({ children }: any) => children,
}));
jest.mock('@clerk/clerk-expo', () => ({
  useAuth: jest.fn(),
  useUser: jest.fn(),
  useSignIn: jest.fn(),
  useSignUp: jest.fn(),
}));
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('expo-sharing', () => ({}));
jest.mock('@/src/api/client', () => ({
  exportAccountData: jest.fn(),
  deleteAccount: jest.fn(),
}));

function textOf(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('');
}

function render(element: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  let root!: ReactTestRenderer;
  act(() => {
    root = TestRenderer.create(React.createElement(QueryClientProvider, { client: queryClient }, element));
  });
  return root;
}

async function press(root: ReactTestRenderer, label: string) {
  const target = root.root
    .findAllByType('TouchableOpacity' as any)
    .find((node) => textOf(node).trim() === label);
  if (!target) throw new Error(`No button labelled ${label}`);
  await act(async () => {
    await target.props.onPress();
  });
}

function type(root: ReactTestRenderer, placeholder: string, value: string) {
  const input = root.root.findAll((node) => node.type === ('TextInput' as any) && node.props.placeholder === placeholder)[0];
  if (!input) throw new Error(`No input with placeholder ${placeholder}`);
  act(() => input.props.onChangeText(value));
}

const flush = () => act(async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
});

function expectNoNavigation() {
  expect(mockRouter.push).not.toHaveBeenCalled();
  expect(mockRouter.replace).not.toHaveBeenCalled();
  expect(mockRouter.navigate).not.toHaveBeenCalled();
}

beforeEach(() => jest.clearAllMocks());

describe('Account: the root Stack.Protected guard owns the signed-out transition', () => {
  const signOut = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    (useAuth as jest.Mock).mockReturnValue({ getToken: jest.fn().mockResolvedValue('token'), signOut });
    (useUser as jest.Mock).mockReturnValue({
      user: { emailAddresses: [{ emailAddress: 'user@example.test' }], id: 'user_1' },
    });
  });

  it('Sign Out signs out without navigating', async () => {
    const root = render(React.createElement(AccountScreen));
    await press(root, 'Sign Out');

    expect(signOut).toHaveBeenCalledTimes(1);
    expectNoNavigation();
  });

  it('account deletion deletes, signs out and does not navigate', async () => {
    (client.deleteAccount as jest.Mock).mockResolvedValue({});
    const root = render(React.createElement(AccountScreen));

    await press(root, 'Delete Account');
    type(root, 'user@example.test', 'user@example.test');
    await press(root, 'Delete My Account');
    await flush();

    expect(client.deleteAccount).toHaveBeenCalledWith('token', 'user@example.test');
    expect(signOut).toHaveBeenCalledTimes(1);
    expectNoNavigation();
  });
});

describe('Sign-in and sign-up: activating the session does not navigate', () => {
  it('sign-in activates the new session without a manual redirect', async () => {
    const setActive = jest.fn().mockResolvedValue(undefined);
    const create = jest.fn().mockResolvedValue({ status: 'complete', createdSessionId: 'sess_1' });
    (useSignIn as jest.Mock).mockReturnValue({ isLoaded: true, signIn: { create }, setActive });
    const root = render(React.createElement(SignIn));

    type(root, 'Enter your email', 'user@example.test');
    type(root, 'Enter your password', 'secret');
    await press(root, 'Sign In');

    expect(create).toHaveBeenCalledWith({ identifier: 'user@example.test', password: 'secret' });
    expect(setActive).toHaveBeenCalledWith({ session: 'sess_1' });
    expectNoNavigation();
  });

  it('sign-up verification activates the new session without a manual redirect', async () => {
    const setActive = jest.fn().mockResolvedValue(undefined);
    const signUp = {
      create: jest.fn().mockResolvedValue({}),
      prepareEmailAddressVerification: jest.fn().mockResolvedValue({}),
      attemptEmailAddressVerification: jest.fn().mockResolvedValue({ status: 'complete', createdSessionId: 'sess_2' }),
    };
    (useSignUp as jest.Mock).mockReturnValue({ isLoaded: true, signUp, setActive });
    const root = render(React.createElement(SignUp));

    type(root, 'Enter your email', 'new@example.test');
    type(root, 'Create a password', 'secret');
    await press(root, 'Sign Up');
    type(root, '000000', '123456');
    await press(root, 'Verify Email');

    expect(signUp.attemptEmailAddressVerification).toHaveBeenCalledWith({ code: '123456' });
    expect(setActive).toHaveBeenCalledWith({ session: 'sess_2' });
    expectNoNavigation();
  });
});
