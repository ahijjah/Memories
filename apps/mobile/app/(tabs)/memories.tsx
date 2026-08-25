import { useAuth } from "@clerk/clerk-expo";
import { useRouter } from 'expo-router';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, FlatList } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { fetchMemories, Memory } from '@/src/api/client';

export default function MemoriesScreen() {
  const { getToken } = useAuth();
  const router = useRouter();

  const { data: memories, isLoading, error, refetch } = useQuery({
    queryKey: ['memories'],
    queryFn: async () => {
      const token = await getToken();
      return fetchMemories(token);
    },
  });

  const getProcessingStateColor = (state: string) => {
    switch (state) {
      case 'queued':
      case 'processing':
        return 'text-yellow-600';
      case 'understood':
        return 'text-green-600';
      case 'partial':
        return 'text-orange-600';
      case 'failed':
        return 'text-red-600';
      default:
        return 'text-gray-600';
    }
  };

  const getProcessingStateLabel = (state: string) => {
    switch (state) {
      case 'queued':
        return 'Queued';
      case 'processing':
        return 'Processing...';
      case 'understood':
        return 'Complete';
      case 'partial':
        return 'Partial';
      case 'failed':
        return 'Failed';
      default:
        return state;
    }
  };

  const handleMemoryPress = (id: string) => {
    router.push(`/memory/${id}`);
  };

  const renderMemoryItem = (item: Memory) => (
    <TouchableOpacity
      key={item.id}
      onPress={() => handleMemoryPress(item.id)}
      className="bg-white border border-gray-200 rounded-lg p-4 mb-3"
    >
      <View className="flex-row justify-between items-start gap-2">
        <View className="flex-1">
          <Text className="text-lg font-semibold text-gray-900" numberOfLines={2}>
            {item.title || `${item.sourceType} Memory`}
          </Text>
          <Text className="text-sm text-gray-600 mt-1">
            {new Date(item.capturedAt).toLocaleString()}
          </Text>
        </View>
        <Text className={`text-sm font-medium ${getProcessingStateColor(item.processingState)}`}>
          {getProcessingStateLabel(item.processingState)}
        </Text>
      </View>
    </TouchableOpacity>
  );

  if (isLoading) {
    return (
      <View className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text className="text-gray-600 mt-4">Loading memories...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View className="flex-1 bg-white px-6 py-8">
        <View className="bg-red-50 rounded-lg p-4">
          <Text className="text-red-900 font-semibold mb-2">Error</Text>
          <Text className="text-red-700 text-sm mb-4">
            {error instanceof Error ? error.message : 'Failed to load memories'}
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

  return (
    <View className="flex-1 bg-white">
      {memories && memories.length > 0 ? (
        <FlatList
          data={memories}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => renderMemoryItem(item)}
          contentContainerStyle={{ paddingHorizontal: 24, paddingVertical: 16 }}
          scrollEnabled={true}
        />
      ) : (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-lg font-semibold text-gray-900 mb-2">No Memories Yet</Text>
          <Text className="text-gray-600 text-center">
            Use the Capture tab to create your first memory
          </Text>
        </View>
      )}
    </View>
  );
}
