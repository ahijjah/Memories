import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-expo';
import { fetchRelatedMemories, RelatedMemoryResult } from '../api/client';

interface UseRelatedMemoriesOptions {
  isVault?: boolean;
}

export function useRelatedMemories(
  memoryId: string,
  options: UseRelatedMemoriesOptions = {},
) {
  const { getToken } = useAuth();

  const query = useQuery({
    queryKey: ['relatedMemories', memoryId],
    queryFn: async () => {
      const token = await getToken();
      if (!token) {
        throw new Error('No authentication token');
      }
      return fetchRelatedMemories(token, memoryId, 5);
    },
    enabled: !!memoryId,
    staleTime: 1000 * 60 * 5, // 5 minutes
    retry: 1,
  });

  return query;
}
