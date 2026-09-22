import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/clerk-expo';
import { File, Directory, Paths } from 'expo-file-system';

type AssetDownloadState = 'idle' | 'loading' | 'loaded' | 'error';

// Module-level concurrent download tracking to deduplicate simultaneous requests.
// Shared download is independent of individual component lifecycles.
export const downloadPromises = new Map<string, Promise<string>>();

export function useAuthenticatedAssetDownload(assetId: string, contentUrl: string) {
  const { getToken } = useAuth();
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [state, setState] = useState<AssetDownloadState>('idle');
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

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

        // Check if download already in progress for this asset
        if (downloadPromises.has(assetId)) {
          const cachedPromise = downloadPromises.get(assetId)!;
          const uri = await cachedPromise;
          if (mountedRef.current) {
            setLocalUri(uri);
            setState('loaded');
          }
          return;
        }

        const token = await getToken();
        if (!token || !mountedRef.current) return;

        // Build absolute URL from relative path
        const apiBaseUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';
        const absoluteUrl = contentUrl.startsWith('http')
          ? contentUrl
          : `${apiBaseUrl}${contentUrl.startsWith('/') ? '' : '/'}${contentUrl}`;

        // Create download promise and add to map.
        // This shared download is independent of this hook instance's lifecycle.
        const downloadPromise = performDownload(assetId, absoluteUrl, token);
        downloadPromises.set(assetId, downloadPromise);

        try {
          const uri = await downloadPromise;
          if (mountedRef.current) {
            setLocalUri(uri);
            setState('loaded');
          }
        } finally {
          downloadPromises.delete(assetId);
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
  }, [assetId, contentUrl, getToken]);

  return { localUri, state, error };
}

export async function performDownload(
  assetId: string,
  absoluteUrl: string,
  token: string,
): Promise<string> {
  // Ensure cache directory exists
  const assetsCacheDir = new Directory(Paths.cache, 'assets');
  const dirInfo = Paths.info(assetsCacheDir.uri);

  if (!dirInfo.exists) {
    // createDirectory is synchronous in v57.0.6
    assetsCacheDir.createDirectory('');
  }

  // Construct deterministic cache file path
  const cacheFile = new File(assetsCacheDir, assetId);

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
