import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/clerk-expo';
import { File, Directory, Paths } from 'expo-file-system';

type AssetDownloadState = 'idle' | 'loading' | 'loaded' | 'error';

// Module-level concurrent download tracking with user-scoped deduplication.
// Key format: `${userId}:${assetId}` ensures different users don't share cache.
export const downloadPromises = new Map<string, Promise<string>>();

// Production helper: synchronously checks/installs deduplication Promise.
// Ensures only ONE download operation runs per (user, asset) pair, even if
// multiple hook consumers call this concurrently.
export function getOrStartAssetDownload(
  userId: string,
  assetId: string,
  contentUrl: string,
  getToken: () => Promise<string | null>,
): Promise<string> {
  const dedupeKey = `${userId}:${assetId}`;

  // Synchronous check: if download already in progress, return existing Promise
  if (downloadPromises.has(dedupeKey)) {
    return downloadPromises.get(dedupeKey)!;
  }

  // Create a single Promise representing the ENTIRE async operation.
  // Installed synchronously in Map BEFORE any async operation begins.
  let resolvedPromise: Promise<string>;

  resolvedPromise = (async () => {
    try {
      const token = await getToken();
      if (!token) {
        throw new Error('Failed to obtain authentication token');
      }

      // Build absolute URL from relative path
      const apiBaseUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';
      const absoluteUrl = contentUrl.startsWith('http')
        ? contentUrl
        : `${apiBaseUrl}${contentUrl.startsWith('/') ? '' : '/'}${contentUrl}`;

      return performDownload(userId, assetId, absoluteUrl, token);
    } finally {
      // Clean up only if this Promise is still the current one in the Map.
      if (downloadPromises.get(dedupeKey) === resolvedPromise) {
        downloadPromises.delete(dedupeKey);
      }
    }
  })();

  // Synchronously install in Map BEFORE returning (before first async yield).
  downloadPromises.set(dedupeKey, resolvedPromise);

  return resolvedPromise;
}

export function useAuthenticatedAssetDownload(assetId: string, contentUrl: string) {
  const { getToken, userId } = useAuth();
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [state, setState] = useState<AssetDownloadState>('idle');
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  // @clerk/clerk-expo's useAuth() returns a new getToken function on every render. Keep the
  // latest one in a ref so the download effect depends only on its semantic inputs; otherwise
  // every render re-runs the effect (loaded -> loading -> loaded ...: "Maximum update depth").
  // Each download still calls the current getToken, so tokens are always fresh.
  const getTokenRef = useRef(getToken);
  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  // Track mounted state only; unmounting this hook does NOT cancel shared download
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const download = async () => {
      try {
        setState('loading');
        setError(null);

        // userId is required for user-scoped cache isolation
        if (!userId) {
          setError(new Error('User not authenticated'));
          setState('error');
          return;
        }

        // Call production helper: synchronously deduplicates concurrent requests
        const uri = await getOrStartAssetDownload(userId, assetId, contentUrl, () =>
          getTokenRef.current(),
        );
        if (mountedRef.current) {
          setLocalUri(uri);
          setState('loaded');
        }
      } catch (err) {
        if (mountedRef.current) {
          const error = err instanceof Error ? err : new Error(String(err));
          setError(error);
          setState('error');
        }
      }
    };

    download();
  }, [assetId, contentUrl, userId]);

  return { localUri, state, error };
}

export async function performDownload(
  userId: string,
  assetId: string,
  absoluteUrl: string,
  token: string,
): Promise<string> {
  // Ensure cache directory exists
  const assetsCacheDir = new Directory(Paths.cache, 'assets');
  const dirInfo = Paths.info(assetsCacheDir.uri);

  if (!dirInfo.exists) {
    // create() makes cache/assets itself; createDirectory(name) makes a named child and rejects
    // an empty name on Android. idempotent: another first download may already have created it.
    assetsCacheDir.create({ idempotent: true });
  }

  // User-scoped cache: filename includes userId to prevent cross-account cache reuse
  const cacheFileName = `${userId}:${assetId}`;
  const cacheFile = new File(assetsCacheDir, cacheFileName);

  // Check if already cached (optimization: avoid re-download)
  const fileInfo = Paths.info(cacheFile.uri);
  if (fileInfo.exists && !fileInfo.isDirectory) {
    return cacheFile.uri;
  }

  // Download with Authorization header (no per-component cancellation)
  try {
    const result = await File.downloadFileAsync(absoluteUrl, cacheFile, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      idempotent: true,
    });

    return result.uri;
  } catch (err) {
    throw new Error(`Failed to download asset: ${err instanceof Error ? err.message : String(err)}`);
  }
}
