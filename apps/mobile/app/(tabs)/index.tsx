import { useAuth } from "@clerk/clerk-expo";
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { fetchMemories, Memory, getUpcomingMemories, UpcomingMemory } from '@/src/api/client';
import { CompactCard } from '@/src/components/memory-cards/CompactCard';

export default function HomeScreen() {
  const router = useRouter();
  const { getToken } = useAuth();

  const { data: memories, isLoading, error, refetch } = useQuery({
    queryKey: ['memories'],
    queryFn: async () => {
      const token = await getToken();
      return fetchMemories(token);
    },
  });

  const { data: upcomingMemories = [] } = useQuery({
    queryKey: ['upcomingMemories'],
    queryFn: async () => {
      const token = await getToken();
      return getUpcomingMemories(token);
    },
  });

  const handleMemoryPress = (id: string) => {
    router.push(`/memory/${id}`);
  };

  const formatDaysUntil = (daysUntil: number): string => {
    if (daysUntil === 0) return 'today';
    if (daysUntil === 1) return 'tomorrow';
    return `in ${daysUntil} days`;
  };

  const recentMemories = (memories || []).slice(0, 10);
  const hasMemories = recentMemories.length > 0;
  const hasUpcoming = upcomingMemories.length > 0;

  return (
    <View className="flex-1 bg-white relative">
      <ScrollView className="flex-1">
        <View className="px-6 py-8">
          <View className="mb-8">
            <Text className="text-3xl font-bold text-gray-900">Memories</Text>
          </View>

          {isLoading ? (
            <View className="items-center justify-center py-12">
              <ActivityIndicator size="large" color="#3b82f6" />
              <Text className="text-gray-600 mt-4">Loading recent memories...</Text>
            </View>
          ) : error ? (
            <View className="bg-red-50 rounded-lg p-4 mb-6">
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
          ) : !hasMemories ? (
            <View className="items-center justify-center py-12">
              <Text className="text-lg font-semibold text-gray-900 mb-2">No Memories Yet</Text>
              <Text className="text-gray-600 text-center">
                Use the Capture tab to create your first memory
              </Text>
            </View>
          ) : (
            <View>
              {/* Upcoming Section */}
              {hasUpcoming && (
                <View className="mb-6">
                  <Text className="text-lg font-semibold text-gray-900 mb-3">Upcoming</Text>
                  <View className="space-y-2">
                    {upcomingMemories.map((upcoming: UpcomingMemory) => (
                      <TouchableOpacity
                        key={upcoming.id}
                        onPress={() => handleMemoryPress(upcoming.id)}
                        className="bg-blue-50 rounded-lg p-4 flex-row items-center justify-between"
                      >
                        <View className="flex-1">
                          <Text className="text-base font-semibold text-gray-900">{upcoming.title}</Text>
                          <Text className="text-sm text-blue-600 mt-1">{formatDaysUntil(upcoming.daysUntil)}</Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}

              {/* Recent Section */}
              <View className="mb-6">
                <Text className="text-lg font-semibold text-gray-900 mb-3">Recent</Text>
                <View>
                  {recentMemories.map((memory: Memory) => (
                    <TouchableOpacity
                      key={memory.id}
                      onPress={() => handleMemoryPress(memory.id)}
                    >
                      <CompactCard memory={memory} />
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      <TouchableOpacity
        onPress={() => router.push('/(tabs)/capture')}
        className="absolute bottom-6 right-6 w-16 h-16 rounded-full bg-blue-600 items-center justify-center shadow-lg"
        style={{ elevation: 5 }}
      >
        <Text className="text-white text-3xl font-bold">+</Text>
      </TouchableOpacity>
    </View>
  );
}
