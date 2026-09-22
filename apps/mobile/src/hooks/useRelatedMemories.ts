import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-expo';
import { fetchRelatedMemories, fetchRelatedVaultMemories, RelatedMemoryResult } from '../api/client';

interface UseRelatedMemoriesOptions {
  enabled?: boolean;
  isVault?: boolean;
}

export function useRelatedMemories(
  memoryId: string,
  options: UseRelatedMemoriesOptions = {},
) {
  const { getToken } = useAuth();
  const { enabled = true, isVault = false } = options;
  const enabledRef = useRef(enabled);

  // Track if this effect is for the current memory ID to prevent stale updates
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const query = useQuery({
    queryKey: ['relatedMemories', memoryId, isVault],
    queryFn: async () => {
      const token = await getToken();
      if (!token) {
        throw new Error('No authentication token');
      }

      // If component was disabled/unmounted before this resolves, don't update
      if (!enabledRef.current) {
        return [];
      }

      const fetchFn = isVault ? fetchRelatedVaultMemories : fetchRelatedMemories;
      return fetchFn(token, memoryId, 5);
    },
    enabled: enabled && !!memoryId,
    staleTime: 1000 * 60 * 5, // 5 minutes
    retry: 1,
  });

  return query;
}
