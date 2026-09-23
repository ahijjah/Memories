import { useAuth } from "@clerk/clerk-expo";
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useQuery } from '@tanstack/react-query';
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
  const [offset, setOffset] = useState(0);
  const [accumulatedMemories, setAccumulatedMemories] = useState<WorkspaceMemory[]>([]);
  const [displayLabel, setDisplayLabel] = useState('Workspace');
  const [total, setTotal] = useState(0);
  const limit = 20;

  const { data, isLoading, error, refetch } = useQuery<WorkspaceDetailResponse>({
    queryKey: ['workspace', workspaceId],
    queryFn: async () => {
      if (!workspaceId) throw new Error('No workspace ID');

      const token = await getToken();
      if (!token) throw new Error('No auth token');

      const response = await fetch(
        `${process.env.EXPO_PUBLIC_API_URL}/workspaces/${workspaceId}/memories?limit=${limit}&offset=${offset}`,
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
    enabled: !!workspaceId,
  });

  useEffect(() => {
    if (data) {
      setDisplayLabel(data.displayLabel);
      setTotal(data.total);
      if (offset === 0) {
        setAccumulatedMemories(data.memories);
      } else {
        setAccumulatedMemories((prev) => [...prev, ...data.memories]);
      }
    }
  }, [data, offset]);

  const handleMemoryPress = (memoryId: string) => {
    router.push(`/memories/${memoryId}`);
  };

  const handleLoadMore = () => {
    setOffset((prev) => prev + limit);
  };

  if (isLoading && offset === 0) {
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

  const hasMore = offset + limit < total;

  return (
    <ScrollView className="flex-1 bg-white">
      <View className="px-4 py-4 border-b border-gray-200">
        <Text className="text-xl font-bold text-gray-900">{displayLabel}</Text>
        <Text className="text-sm text-gray-500 mt-1">
          {total} memory
          {total !== 1 ? 'ies' : ''}
        </Text>
      </View>

      {accumulatedMemories.length === 0 ? (
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
          {accumulatedMemories.map((memory) => (
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

          {hasMore && (
            <View className="px-4 py-4">
              <TouchableOpacity
                onPress={handleLoadMore}
                className="bg-gray-200 rounded-lg py-3"
                disabled={isLoading}
              >
                <Text className="text-gray-700 text-center font-semibold">
                  {isLoading ? 'Loading...' : 'Load More'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
}
