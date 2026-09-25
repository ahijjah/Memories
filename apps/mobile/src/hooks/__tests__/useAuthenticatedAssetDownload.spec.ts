import React from 'react';
import TestRenderer, { ReactTestInstance } from 'react-test-renderer';
import { useAuth } from '@clerk/clerk-expo';
import { File, Directory, Paths } from 'expo-file-system';
import { useAuthenticatedAssetDownload, performDownload, getOrStartAssetDownload, downloadPromises } from '../useAuthenticatedAssetDownload';

jest.mock('@clerk/clerk-expo');
jest.mock('expo-file-system');

const mockGetToken = jest.fn();
const mockUserId = 'user-123';

beforeEach(() => {
  jest.clearAllMocks();
  downloadPromises.clear();
  (useAuth as jest.Mock).mockReturnValue({ getToken: mockGetToken, userId: mockUserId });
  (File.downloadFileAsync as jest.Mock).mockImplementation(async () => {
    return { uri: 'file:///cache/assets/user-123:asset-456' };
  });
  (Paths.info as jest.Mock).mockReturnValue({ exists: false });
});

describe('useAuthenticatedAssetDownload', () => {
  describe('A. RACE CONDITION FIX - Synchronous deduplication at async boundary', () => {
    it('two concurrent hook consumers should call File.downloadFileAsync exactly ONCE', async () => {
      const mockToken = 'test-token-123';
      let downloadStarted = false;
      let downloadBlocked = true;

      mockGetToken.mockImplementation(async () => {
        downloadStarted = true;
        // Block this getToken to allow second consumer to reach getOrStartAssetDownload
        while (downloadBlocked) {
          await new Promise(r => setTimeout(r, 10));
        }
        return mockToken;
      });

      (File.downloadFileAsync as jest.Mock).mockResolvedValue({ uri: 'file:///cache/assets/user-123:asset-456' });

      const assetId = 'asset-456';
      const contentUrl = '/assets/asset-456/content';

      // Consumer A: starts calling getOrStartAssetDownload
      const promise1 = getOrStartAssetDownload(
        mockUserId,
        assetId,
        contentUrl,
        mockGetToken
      );

      // Give promise1 time to synchronously install in Map
      await new Promise(r => setTimeout(r, 5));

      // Consumer B: calls getOrStartAssetDownload for same asset
      // Should get the same Promise from Map (before async ops even start)
      const promise2 = getOrStartAssetDownload(
        mockUserId,
        assetId,
        contentUrl,
        mockGetToken
      );

      // Both should be the exact same Promise object
      expect(promise1).toBe(promise2);

      // Unblock the download
      downloadBlocked = false;

      const uri1 = await promise1;
      const uri2 = await promise2;

      // Both should get the same result
      expect(uri1).toBe(uri2);
      expect(uri1).toBe('file:///cache/assets/user-123:asset-456');

      // File.downloadFileAsync should have been called exactly once
      expect((File.downloadFileAsync as jest.Mock).mock.calls.length).toBe(1);
    });

    it('real hook: two components mounted concurrently with same asset call download once', async () => {
      const mockToken = 'test-token-123';
      mockGetToken.mockResolvedValue(mockToken);

      let componentALoaded = false;
      let componentBLoaded = false;

      // Component A: consumes hook
      const ConsumerA = () => {
        const { localUri, state } = useAuthenticatedAssetDownload('asset-456', '/assets/asset-456/content');
        if (state === 'loaded') {
          componentALoaded = true;
        }
        return React.createElement('div', null, `A: ${state}`);
      };

      // Component B: consumes same asset
      const ConsumerB = () => {
        const { localUri, state } = useAuthenticatedAssetDownload('asset-456', '/assets/asset-456/content');
        if (state === 'loaded') {
          componentBLoaded = true;
        }
        return React.createElement('div', null, `B: ${state}`);
      };

      // Render both components together (simulates concurrent mounting)
      const root = TestRenderer.create(
        React.createElement('div', null,
          React.createElement(ConsumerA),
          React.createElement(ConsumerB)
        )
      );

      // Wait for downloads to complete
      await new Promise(r => setTimeout(r, 100));

      // Both components should reach loaded state
      expect(componentALoaded).toBe(true);
      expect(componentBLoaded).toBe(true);

      // File.downloadFileAsync called exactly once (not twice)
      expect((File.downloadFileAsync as jest.Mock).mock.calls.length).toBe(1);

      root.unmount();
    });
  });

  describe('B. UNMOUNT SAFETY - One consumer unmounts while download pending', () => {
    it('unmounting component A does not affect component B receiving download result', async () => {
      const mockToken = 'test-token-123';
      let downloadBlocked = true;

      mockGetToken.mockResolvedValue(mockToken);
      (File.downloadFileAsync as jest.Mock).mockImplementation(async () => {
        while (downloadBlocked) {
          await new Promise(r => setTimeout(r, 10));
        }
        return { uri: 'file:///cache/assets/user-123:asset-456' };
      });

      let componentALoaded = false;
      let componentBLoaded = false;
      let componentBError = false;

      const ConsumerA = () => {
        const { localUri, state } = useAuthenticatedAssetDownload('asset-456', '/assets/asset-456/content');
        if (state === 'loaded') {
          componentALoaded = true;
        }
        return React.createElement('div', null, `A: ${state}`);
      };

      const ConsumerB = () => {
        const { localUri, state, error } = useAuthenticatedAssetDownload('asset-456', '/assets/asset-456/content');
        if (state === 'loaded') {
          componentBLoaded = true;
        }
        if (state === 'error') {
          componentBError = true;
        }
        return React.createElement('div', null, `B: ${state}`);
      };

      const root = TestRenderer.create(
        React.createElement('div', null,
          React.createElement(ConsumerA),
          React.createElement(ConsumerB)
        )
      );

      // Give components time to register and start download
      await new Promise(r => setTimeout(r, 20));

      // Unmount component A while download is still pending
      TestRenderer.act(() => {
        root.update(
          React.createElement('div', null,
            React.createElement(ConsumerB)
          )
        );
      });

      // Unblock the download
      downloadBlocked = false;

      // Wait for B to complete
      await new Promise(r => setTimeout(r, 100));

      // Component B should have loaded successfully
      // (unmounting A didn't cancel the shared download)
      expect(componentBLoaded).toBe(true);
      expect(componentBError).toBe(false);

      root.unmount();
    });
  });

  describe('C. USER-SCOPED CACHE - Different users don\'t share cache', () => {
    it('different userIds should maintain separate in-flight downloads and cache', async () => {
      const mockToken = 'test-token';
      const assetId = 'asset-456';
      const contentUrl = '/assets/asset-456/content';

      mockGetToken.mockResolvedValue(mockToken);
      (File.downloadFileAsync as jest.Mock).mockResolvedValue({ uri: 'file:///cache/assets/mock' });

      downloadPromises.clear();

      // User A downloads asset-456
      const promiseUserA = getOrStartAssetDownload('user-a', assetId, contentUrl, mockGetToken);

      // User B downloads same asset-456
      const promiseUserB = getOrStartAssetDownload('user-b', assetId, contentUrl, mockGetToken);

      // Promises should be DIFFERENT because of user-scoped deduplication
      expect(promiseUserA).not.toBe(promiseUserB);

      // Verify deduplication keys are in Map
      expect(downloadPromises.has('user-a:asset-456')).toBe(true);
      expect(downloadPromises.has('user-b:asset-456')).toBe(true);

      await Promise.all([promiseUserA, promiseUserB]);

      // File.downloadFileAsync should have been called twice (once per user)
      expect((File.downloadFileAsync as jest.Mock).mock.calls.length).toBe(2);

      // Verify user-scoped cache filenames in the File constructor calls
      // File constructor is called with (directory, filename)
      // We can check the filename parameter passed to File() constructor
      // by inspecting how performDownload was called
    });
  });

  describe('D. performDownload - Authorization and security', () => {
    it('should send Authorization header with Clerk token', async () => {
      const mockToken = 'test-token-123';

      mockGetToken.mockResolvedValue(mockToken);
      (File.downloadFileAsync as jest.Mock).mockResolvedValue({ uri: 'file:///cache/assets/user-123:asset-456' });

      await performDownload('user-123', 'asset-456', 'http://localhost:3000/assets/asset-456/content', mockToken);

      const callArgs = (File.downloadFileAsync as jest.Mock).mock.calls[0];
      const headers = callArgs[2]?.headers;

      expect(headers['Authorization']).toBe(`Bearer ${mockToken}`);
      expect(Object.keys(headers)).toEqual(['Authorization']);
    });

    it('should NOT send SSE-C headers in download request', async () => {
      const mockToken = 'test-token-123';

      mockGetToken.mockResolvedValue(mockToken);
      (File.downloadFileAsync as jest.Mock).mockResolvedValue({ uri: 'file:///cache/assets/user-123:asset-456' });

      await performDownload('user-123', 'asset-456', 'http://localhost:3000/assets/asset-456/content', mockToken);

      const callArgs = (File.downloadFileAsync as jest.Mock).mock.calls[0];
      const headers = callArgs[2]?.headers || {};

      expect(headers['x-amz-server-side-encryption-customer-algorithm']).toBeUndefined();
      expect(headers['x-amz-server-side-encryption-customer-key']).toBeUndefined();
      expect(headers['x-amz-server-side-encryption-customer-key-MD5']).toBeUndefined();
    });
  });

  describe('E. CACHE HIT - Existing file detection', () => {
    it('should skip File.downloadFileAsync when cached file exists', async () => {
      const mockToken = 'test-token-123';

      mockGetToken.mockResolvedValue(mockToken);
      let callCount = 0;
      (Paths.info as jest.Mock).mockImplementation(() => {
        callCount++;
        // First call: directory exists, second call: file exists
        return { exists: true, isDirectory: callCount === 1 };
      });

      await performDownload('user-123', 'asset-456', 'http://localhost:3000/assets/asset-456/content', mockToken);

      expect((File.downloadFileAsync as jest.Mock)).not.toHaveBeenCalled();
    });
  });

  describe('F. ERROR HANDLING', () => {
    it('should propagate download errors through shared Promise', async () => {
      const mockToken = 'test-token';
      const downloadError = new Error('Network error');

      mockGetToken.mockResolvedValue(mockToken);
      (File.downloadFileAsync as jest.Mock).mockRejectedValue(downloadError);

      await expect(
        performDownload('user-123', 'asset-456', 'http://localhost:3000/assets/asset-456/content', mockToken)
      ).rejects.toThrow('Failed to download asset: Network error');
    });

    it('should handle missing authentication token', async () => {
      mockGetToken.mockResolvedValue(null);

      await expect(
        getOrStartAssetDownload('user-123', 'asset-456', '/assets/asset-456/content', mockGetToken)
      ).rejects.toThrow('Failed to obtain authentication token');
    });
  });

  describe('G. UNSTABLE getToken IDENTITY - no render/effect loop', () => {
    // @clerk/clerk-expo's useAuth() wraps getToken in a new arrow function on every render.
    // Model that exactly: every useAuth() call returns a fresh function delegating to tokenSource.
    // Each getToken identity yields the token that was current when it was issued, so a hook
    // that kept calling an old (mount-time) getToken would observe a stale token. Token
    // retrieval takes a real (timer) tick, as Clerk's does, so a loop stays observable instead
    // of starving the test's own timers.
    const tokenSource = jest.fn(
      (token: string) => new Promise<string>((r) => setTimeout(() => r(token), 5)),
    );
    let currentUserId: string | null;
    let currentToken: string;

    let prevActEnv: unknown;
    beforeAll(() => {
      prevActEnv = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
      // Async resolutions below happen outside act(); don't flood the output with act warnings.
      (globalThis as any).IS_REACT_ACT_ENVIRONMENT = false;
    });
    afterAll(() => {
      (globalThis as any).IS_REACT_ACT_ENVIRONMENT = prevActEnv;
    });

    // Always unmount, even when an assertion fails, so a looping hook cannot keep Jest alive.
    const mountedRoots: TestRenderer.ReactTestRenderer[] = [];
    afterEach(() => {
      while (mountedRoots.length) {
        const r = mountedRoots.pop()!;
        TestRenderer.act(() => r.unmount());
      }
    });

    beforeEach(() => {
      currentUserId = mockUserId;
      currentToken = 'token-1';
      (useAuth as jest.Mock).mockImplementation(() => {
        const issuedToken = currentToken;
        return { getToken: () => tokenSource(issuedToken), userId: currentUserId };
      });
    });

    // Plain timed wait (not act()): with a render/effect loop act() may never settle.
    const flush = () => new Promise<void>((r) => setTimeout(r, 50));

    function renderProbe(initial: { assetId: string; contentUrl: string }) {
      const states: string[] = [];
      const Probe = (props: { assetId: string; contentUrl: string; tick?: number }) => {
        const { state } = useAuthenticatedAssetDownload(props.assetId, props.contentUrl);
        states.push(state);
        return React.createElement('div', null, state);
      };
      let root!: TestRenderer.ReactTestRenderer;
      TestRenderer.act(() => {
        root = TestRenderer.create(React.createElement(Probe, initial));
      });
      mountedRoots.push(root);
      const rerender = (props: { assetId: string; contentUrl: string; tick?: number }) =>
        TestRenderer.act(() => {
          root.update(React.createElement(Probe, props));
        });
      return { states, rerender };
    }

    it('a new getToken identity on re-render does not restart the download or cycle loaded -> loading', async () => {
      const props = { assetId: 'asset-456', contentUrl: '/assets/asset-456/content' };
      const { states, rerender } = renderProbe(props);
      await flush();

      expect(states[states.length - 1]).toBe('loaded');
      expect(tokenSource).toHaveBeenCalledTimes(1);
      expect(File.downloadFileAsync as jest.Mock).toHaveBeenCalledTimes(1);

      // Parent re-renders with unchanged semantic inputs: useAuth() hands out new getToken
      // identities, but userId/session are unchanged.
      const loadedAt = states.length;
      for (let tick = 1; tick <= 3; tick++) rerender({ ...props, tick });
      await flush();

      expect(tokenSource).toHaveBeenCalledTimes(1);
      expect(File.downloadFileAsync as jest.Mock).toHaveBeenCalledTimes(1);
      expect(states.slice(loadedAt)).not.toContain('loading');
      expect(states[states.length - 1]).toBe('loaded');
    });

    it('a genuine assetId/contentUrl change still downloads, using the latest getToken', async () => {
      const { states, rerender } = renderProbe({
        assetId: 'asset-456',
        contentUrl: '/assets/asset-456/content',
      });
      await flush();
      expect(tokenSource).toHaveBeenCalledTimes(1);

      // Token rotates (Clerk refresh); the next real download must use the current getToken.
      currentToken = 'token-2';
      rerender({ assetId: 'asset-789', contentUrl: '/assets/asset-789/content' });
      await flush();

      expect(tokenSource).toHaveBeenCalledTimes(2);
      const calls = (File.downloadFileAsync as jest.Mock).mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[1][0]).toBe('http://localhost:3000/assets/asset-789/content');
      expect(calls[1][2].headers.Authorization).toBe('Bearer token-2');
      expect(states[states.length - 1]).toBe('loaded');
    });

    it('a genuine userId change still downloads under the new user', async () => {
      const props = { assetId: 'asset-456', contentUrl: '/assets/asset-456/content' };
      const { rerender } = renderProbe(props);
      await flush();
      expect(File.downloadFileAsync as jest.Mock).toHaveBeenCalledTimes(1);

      currentUserId = 'user-999';
      rerender({ ...props });
      await flush();

      expect(tokenSource).toHaveBeenCalledTimes(2);
      expect(File.downloadFileAsync as jest.Mock).toHaveBeenCalledTimes(2);
      // expo-file-system is automocked: File is a mock constructor; check the cache filename.
      const cacheFileNames = (File as unknown as jest.Mock).mock.calls.map((c: unknown[]) => c[1]);
      expect(cacheFileNames).toContain('user-999:asset-456');
    });
  });
});
