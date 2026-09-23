import { useAuth } from "@clerk/clerk-expo";
import { useRouter, useLocalSearchParams } from 'expo-router';
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useInfiniteQuery } from '@tanstack/react-query';
import { CompactCard } from '@/src/components/memory-cards/CompactCard';

interface Asset {
  id: string;
  mimeType: string;
  variant: string | null;
  url: string;
}

interface WorkspaceMemory {
  id: string;
  title: string;
  memoryType: string;
  sourceType: string;
  capturedAt: string;
  processingState: string;
  securityScope: string;
  assets: Asset[];
}

interface WorkspaceDetailResponse {
  workspaceId: string;
  displayLabel: string;
  memories: WorkspaceMemory[];
  total: number;
  limit: number;
  offset: number;
}

export default function WorkspaceDetailScreen() {
  const { getToken } = useAuth();
  const router = useRouter();
  const { workspaceId } = useLocalSearchParams<{ workspaceId: string }>();
  const limit = 20;

  const {
    data,
    isLoading,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<WorkspaceDetailResponse>({
    queryKey: ['workspace', workspaceId],
    queryFn: async ({ pageParam = 0 }) => {
      if (!workspaceId) throw new Error('No workspace ID');

      const token = await getToken();
      if (!token) throw new Error('No auth token');

      const response = await fetch(
        `${process.env.EXPO_PUBLIC_API_URL}/workspaces/${workspaceId}/memories?limit=${limit}&offset=${pageParam}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.status === 404) {
        throw new Error('Workspace not found');
      }
      if (!response.ok) throw new Error('Failed to fetch workspace memories');
      return response.json();
    },
    getNextPageParam: (lastPage) => {
      const nextOffset = lastPage.offset + lastPage.limit;
      if (nextOffset < lastPage.total) {
        return nextOffset;
      }
      return undefined;
    },
    initialPageParam: 0,
    enabled: !!workspaceId,
  });

  const handleMemoryPress = (memoryId: string) => {
    router.push(`/memories/${memoryId}`);
  };

  const handleLoadMore = () => {
    fetchNextPage();
  };

  if (isLoading) {
    return (
      <View className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text className="text-gray-600 mt-4">Loading workspace...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View className="flex-1 bg-white px-6 py-8">
        <View className="bg-red-50 rounded-lg p-4">
          <Text className="text-red-900 font-semibold mb-2">Error</Text>
          <Text className="text-red-700 text-sm mb-4">
            {error instanceof Error ? error.message : 'Failed to load workspace'}
          </Text>
          <TouchableOpacity
            onPress={() => refetch()}
            className="bg-red-600 rounded-lg py-2 px-4"
          >
            <Text className="text-white text-center font-semibold text-sm">Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const memories = data?.pages.flatMap((page) => page.memories) ?? [];
  const displayLabel = data?.pages[0]?.displayLabel ?? 'Workspace';
  const total = data?.pages[0]?.total ?? 0;

  return (
    <ScrollView className="flex-1 bg-white">
      <View className="px-4 py-4 border-b border-gray-200">
        <Text className="text-xl font-bold text-gray-900">{displayLabel}</Text>
        <Text className="text-sm text-gray-500 mt-1">
          {total} memory
          {total !== 1 ? 'ies' : ''}
        </Text>
      </View>

      {memories.length === 0 ? (
        <View className="items-center justify-center py-12">
          <Text className="text-lg font-semibold text-gray-900 mb-2">
            No Memories
          </Text>
          <Text className="text-gray-600 text-center">
            This workspace has no memories yet
          </Text>
        </View>
      ) : (
        <View>
          {memories.map((memory) => (
            <TouchableOpacity
              key={memory.id}
              onPress={() => handleMemoryPress(memory.id)}
            >
              <CompactCard
                memory={{
                  ...memory,
                  capturedAt: new Date(memory.capturedAt),
                }}
              />
            </TouchableOpacity>
          ))}

          {hasNextPage && (
            <View className="px-4 py-4">
              <TouchableOpacity
                onPress={handleLoadMore}
                className="bg-gray-200 rounded-lg py-3"
                disabled={isFetchingNextPage}
              >
                <Text className="text-gray-700 text-center font-semibold">
                  {isFetchingNextPage ? 'Loading...' : 'Load More'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
}
