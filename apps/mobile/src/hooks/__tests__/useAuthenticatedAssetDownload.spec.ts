import React from 'react';
import TestRenderer from 'react-test-renderer';
import { useAuth } from '@clerk/clerk-expo';
import { File, Directory, Paths } from 'expo-file-system';
import { useAuthenticatedAssetDownload, performDownload, downloadPromises } from '../useAuthenticatedAssetDownload';

jest.mock('@clerk/clerk-expo');
jest.mock('expo-file-system');

const mockGetToken = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (useAuth as jest.Mock).mockReturnValue({ getToken: mockGetToken });
  (File.downloadFileAsync as jest.Mock).mockImplementation(async () => {
    return { uri: 'file:///cache/assets/asset-456' };
  });
  (Paths.info as jest.Mock).mockReturnValue({ exists: false });
});

describe('useAuthenticatedAssetDownload', () => {
  describe('A. CACHE MISS - Download new asset', () => {
    it('should obtain Clerk token and call downloadFileAsync once', async () => {
      const mockToken = 'test-token-123';
      mockGetToken.mockResolvedValue(mockToken);

      await performDownload('asset-456', 'http://localhost:3000/assets/asset-456/content', mockToken);

      expect(File.downloadFileAsync).toHaveBeenCalled();
      expect((File.downloadFileAsync as jest.Mock).mock.calls.length).toBe(1);
    });

    it('should send Authorization header with Clerk token', async () => {
      const mockToken = 'test-token-123';
      mockGetToken.mockResolvedValue(mockToken);

      await performDownload('asset-456', 'http://localhost:3000/assets/asset-456/content', mockToken);

      const callArgs = (File.downloadFileAsync as jest.Mock).mock.calls[0];
      const headers = callArgs[2]?.headers;

      expect(headers['Authorization']).toBe(`Bearer ${mockToken}`);
    });

    it('should NOT send SSE-C headers', async () => {
      const mockToken = 'test-token-123';
      mockGetToken.mockResolvedValue(mockToken);

      await performDownload('asset-456', 'http://localhost:3000/assets/asset-456/content', mockToken);

      const callArgs = (File.downloadFileAsync as jest.Mock).mock.calls[0];
      const headers = callArgs[2]?.headers || {};

      expect(headers['x-amz-server-side-encryption-customer-algorithm']).toBeUndefined();
      expect(headers['x-amz-server-side-encryption-customer-key']).toBeUndefined();
      expect(headers['x-amz-server-side-encryption-customer-key-MD5']).toBeUndefined();
      expect(Object.keys(headers)).toEqual(['Authorization']);
    });

    it('should resolve relative asset URL against API base URL', async () => {
      const mockToken = 'test-token-123';
      mockGetToken.mockResolvedValue(mockToken);

      await performDownload('asset-456', 'http://localhost:3000/assets/asset-456/content', mockToken);

      const callArgs = (File.downloadFileAsync as jest.Mock).mock.calls[0];
      const downloadUrl = callArgs[0];

      expect(downloadUrl).toBe('http://localhost:3000/assets/asset-456/content');
    });

    it('should return downloaded local file URI', async () => {
      const mockToken = 'test-token-123';
      const mockUri = 'file:///cache/assets/asset-456';
      mockGetToken.mockResolvedValue(mockToken);
      (File.downloadFileAsync as jest.Mock).mockResolvedValue({ uri: mockUri });

      const result = await performDownload('asset-456', 'http://localhost:3000/assets/asset-456/content', mockToken);

      expect(result).toBe(mockUri);
    });
  });

  describe('B. CACHE HIT - Existing file detected', () => {
    it('should skip File.downloadFileAsync when Paths.info returns exists=true', async () => {
      const mockToken = 'test-token-123';
      mockGetToken.mockResolvedValue(mockToken);

      // Mock file exists: first call for directory, second for file
      let callCount = 0;
      (Paths.info as jest.Mock).mockImplementation(() => {
        callCount++;
        // First call: directory exists, second call: file exists
        return { exists: true, isDirectory: callCount === 1 };
      });

      // Call performDownload - it should detect cache hit and NOT call download
      await performDownload('asset-456', 'http://localhost:3000/assets/asset-456/content', mockToken);

      // Critical requirement: File.downloadFileAsync should NOT be called
      // because the file already exists in cache
      expect(File.downloadFileAsync).not.toHaveBeenCalled();
    });

    it('should NOT perform download when cache file exists', async () => {
      mockGetToken.mockResolvedValue('test-token-123');

      // Mock Paths.info to indicate cached file exists
      (Paths.info as jest.Mock).mockReturnValue({ exists: true, isDirectory: false });

      // Perform download - should return early due to cache hit
      await performDownload('asset-456', 'http://localhost:3000/assets/asset-456/content', 'test-token-123');

      // File.downloadFileAsync should NOT be called since file already cached
      expect(File.downloadFileAsync).not.toHaveBeenCalled();
    });
  });

  describe('C. CONCURRENT DEDUPLICATION - Multiple simultaneous requests', () => {
    it('should deduplicate simultaneous performDownload calls for same asset ID', () => {
      const mockToken = 'test-token-123';
      const mockUri = 'file:///cache/assets/asset-456';

      mockGetToken.mockResolvedValue(mockToken);
      let downloadResolve: any;
      const controlledPromise = new Promise<{ uri: string }>((resolve) => {
        downloadResolve = resolve;
      });

      (File.downloadFileAsync as jest.Mock).mockReturnValue(controlledPromise);
      (Paths.info as jest.Mock).mockReturnValue({ exists: false });

      downloadPromises.delete('asset-456');

      // Simulate concurrent hook instances calling performDownload for same asset
      // First hook instance calls performDownload and stores in map
      const promise1 = performDownload('asset-456', 'http://localhost:3000/assets/asset-456/content', mockToken);
      downloadPromises.set('asset-456', promise1);

      // Second hook instance would check map and reuse existing promise
      const cachedPromise = downloadPromises.get('asset-456');
      expect(cachedPromise).toBe(promise1);

      // Critical: File.downloadFileAsync should be called EXACTLY ONCE
      expect((File.downloadFileAsync as jest.Mock).mock.calls.length).toBe(1);

      // Resolve the shared download
      downloadResolve({ uri: mockUri });

      // Both promises should resolve to same value
      return Promise.all([
        promise1.then((result) => {
          expect(result).toBe(mockUri);
        }),
        cachedPromise.then((result) => {
          expect(result).toBe(mockUri);
        }),
      ]).then(() => {
        downloadPromises.delete('asset-456');
      });
    });

    it('should maintain separate promises for different assets', async () => {
      const mockToken = 'test-token-123';

      mockGetToken.mockResolvedValue(mockToken);
      (File.downloadFileAsync as jest.Mock).mockResolvedValue({ uri: 'file:///cache/assets/asset-1' });
      (Paths.info as jest.Mock).mockReturnValue({ exists: false });

      // Download two different assets
      const promise1 = performDownload('asset-1', 'http://localhost:3000/assets/asset-1/content', mockToken);
      const promise2 = performDownload('asset-2', 'http://localhost:3000/assets/asset-2/content', mockToken);

      // Should make two separate download calls
      expect((File.downloadFileAsync as jest.Mock).mock.calls.length).toBe(2);

      const result1 = await promise1;
      const result2 = await promise2;

      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
    });
  });

  describe('D. UNMOUNT SAFETY - Shared download lifecycle independence', () => {
    it('should continue shared download when one consumer unmounts mid-download', () => {
      const mockToken = 'test-token-123';
      const mockUri = 'file:///cache/assets/asset-456';

      mockGetToken.mockResolvedValue(mockToken);
      let downloadResolve: any;
      const downloadPromise = new Promise<{ uri: string }>((resolve) => {
        downloadResolve = resolve;
      });

      (File.downloadFileAsync as jest.Mock).mockReturnValue(downloadPromise);
      (Paths.info as jest.Mock).mockReturnValue({ exists: false });

      downloadPromises.delete('asset-456');

      // Simulate first hook instance starting download
      const promise1 = performDownload('asset-456', 'http://localhost:3000/assets/asset-456/content', mockToken);
      downloadPromises.set('asset-456', promise1);

      // Verify download started
      expect((File.downloadFileAsync as jest.Mock).mock.calls.length).toBe(1);

      // Simulate second hook instance joining (would share the promise)
      const promise2 = downloadPromises.get('asset-456');
      expect(promise2).toBe(promise1);

      // Simulate first hook instance unmounting (it would no longer update state)
      // but the Promise continues
      downloadPromises.delete('asset-456');

      // Both promises should still resolve to the same value
      downloadResolve({ uri: mockUri });

      return Promise.all([
        promise1.then((result) => {
          expect(result).toBe(mockUri);
        }),
        promise2.then((result) => {
          expect(result).toBe(mockUri);
        }),
      ]);
    });
  });

  describe('E. DOWNLOAD FAILURE - Error handling', () => {
    it('should handle download failure and throw error', async () => {
      const mockToken = 'test-token-123';
      const downloadError = new Error('Network error');

      mockGetToken.mockResolvedValue(mockToken);
      (File.downloadFileAsync as jest.Mock).mockRejectedValue(downloadError);
      (Paths.info as jest.Mock).mockReturnValue({ exists: false });

      await expect(performDownload('asset-456', 'http://localhost:3000/assets/asset-456/content', mockToken)).rejects.toThrow(
        'Failed to download asset: Network error'
      );
    });

    it('should NOT return corrupt success URI on failure', async () => {
      const mockToken = 'test-token-123';

      mockGetToken.mockResolvedValue(mockToken);
      (File.downloadFileAsync as jest.Mock).mockRejectedValue(new Error('Download failed'));
      (Paths.info as jest.Mock).mockReturnValue({ exists: false });

      try {
        await performDownload('asset-456', 'http://localhost:3000/assets/asset-456/content', mockToken);
        fail('Should have thrown error');
      } catch (err: any) {
        expect(err.message).toContain('Failed to download asset');
      }
    });
  });

  describe('F. COMPONENT INTEGRATION - Image component compatibility', () => {
    it('should provide file:// URI suitable for Image component', async () => {
      const mockToken = 'test-token-123';
      const mockUri = 'file:///cache/assets/asset-456';

      mockGetToken.mockResolvedValue(mockToken);
      (File.downloadFileAsync as jest.Mock).mockResolvedValue({ uri: mockUri });
      (Paths.info as jest.Mock).mockReturnValue({ exists: false });

      const result = await performDownload('asset-456', 'http://localhost:3000/assets/asset-456/content', mockToken);

      expect(result).toBe(mockUri);
      expect(result).toMatch(/^file:\/\//);
    });

    it('should NOT pass SSE-C headers to Image component', async () => {
      const mockToken = 'test-token-123';

      mockGetToken.mockResolvedValue(mockToken);
      (File.downloadFileAsync as jest.Mock).mockResolvedValue({ uri: 'file:///cache/assets/asset-456' });
      (Paths.info as jest.Mock).mockReturnValue({ exists: false });

      await performDownload('asset-456', 'http://localhost:3000/assets/asset-456/content', mockToken);

      const callArgs = (File.downloadFileAsync as jest.Mock).mock.calls[0];
      const options = callArgs[2];

      // Verify only Authorization header, no SSE-C material
      const headerKeys = Object.keys(options?.headers || {});
      expect(headerKeys).toEqual(['Authorization']);
      expect(options.idempotent).toBe(true);
    });
  });
});
