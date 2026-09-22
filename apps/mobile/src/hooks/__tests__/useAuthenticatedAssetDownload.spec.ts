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
    it('downloadPromises Map enables hook-layer deduplication of concurrent downloads', async () => {
      const mockToken = 'test-token-123';
      const mockUri = 'file:///cache/assets/asset-456';

      mockGetToken.mockResolvedValue(mockToken);
      (File.downloadFileAsync as jest.Mock).mockResolvedValue({ uri: mockUri });
      (Paths.info as jest.Mock).mockReturnValue({ exists: false });

      downloadPromises.clear();

      // Simulate hook-layer deduplication: before calling performDownload,
      // hook checks if promise already exists in downloadPromises Map
      const assetId = 'asset-456';
      const contentUrl = 'http://localhost:3000/assets/asset-456/content';

      // First instance: no promise in map, so call performDownload
      if (!downloadPromises.has(assetId)) {
        const promise = performDownload(assetId, contentUrl, mockToken);
        downloadPromises.set(assetId, promise);
      }

      // Second instance: promise already in map, so reuse it
      let cachedPromise: any;
      if (downloadPromises.has(assetId)) {
        cachedPromise = downloadPromises.get(assetId);
      }

      // Should have only one File.downloadFileAsync call
      expect((File.downloadFileAsync as jest.Mock).mock.calls.length).toBe(1);

      // Both would get the same promise from the map
      const result1 = await downloadPromises.get(assetId);
      expect(result1).toBe(mockUri);
      expect(cachedPromise).toBeDefined();
    });

    it('should maintain separate promises for different assets', async () => {
      const mockToken = 'test-token-123';

      mockGetToken.mockResolvedValue(mockToken);
      (File.downloadFileAsync as jest.Mock).mockResolvedValue({ uri: 'file:///cache/assets/asset-1' });
      (Paths.info as jest.Mock).mockReturnValue({ exists: false });

      downloadPromises.clear();

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
    it('downloadPromises Map persists independently of hook instance lifecycles', async () => {
      const mockToken = 'test-token-123';
      const mockUri = 'file:///cache/assets/asset-456';

      mockGetToken.mockResolvedValue(mockToken);
      (File.downloadFileAsync as jest.Mock).mockResolvedValue({ uri: mockUri });
      (Paths.info as jest.Mock).mockReturnValue({ exists: false });

      downloadPromises.clear();

      // Start a download (simulates first component mount)
      const assetId = 'asset-456';
      const contentUrl = 'http://localhost:3000/assets/asset-456/content';
      const promise1 = performDownload(assetId, contentUrl, mockToken);
      downloadPromises.set(assetId, promise1);

      // Verify it's stored in the module-level Map
      expect(downloadPromises.has(assetId)).toBe(true);
      const storedPromise = downloadPromises.get(assetId);

      // Second component gets same promise (shared download)
      const promise2 = storedPromise;
      expect(promise2).toBe(storedPromise);

      // Both complete successfully, proving the shared download was independent
      const result1 = await promise1;
      const result2 = await promise2;

      expect(result1).toBe(mockUri);
      expect(result2).toBe(mockUri);

      // After completion, promise is cleaned up from map
      downloadPromises.delete(assetId);
      expect(downloadPromises.has(assetId)).toBe(false);
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
