import { useAuth } from "@clerk/clerk-expo";
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { fetchMemories, Memory, getUpcomingMemories, UpcomingMemory, getForYouSuggestions, ForYouSuggestion, getContinueSuggestions, ContinueSuggestion, createCollection, addMemoryToCollection, Collection } from '@/src/api/client';
import { CompactCard } from '@/src/components/memory-cards/CompactCard';
import { useState } from 'react';

export default function HomeScreen() {
  const router = useRouter();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [savingForYou, setSavingForYou] = useState(false);
  const [savingContinue, setSavingContinue] = useState(false);

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

  const { data: forYouSuggestion } = useQuery({
    queryKey: ['forYouSuggestion'],
    queryFn: async () => {
      const token = await getToken();
      return getForYouSuggestions(token);
    },
  });

  const { data: continueSuggestion } = useQuery({
    queryKey: ['continueSuggestion'],
    queryFn: async () => {
      const token = await getToken();
      return getContinueSuggestions(token);
    },
  });

  const handleMemoryPress = (id: string) => {
    router.push(`/memory/${id}`);
  };

  const handleSuggestionPress = (query: string) => {
    router.push(`/(tabs)/search?q=${encodeURIComponent(query)}`);
  };

  const formatDaysUntil = (daysUntil: number): string => {
    if (daysUntil === 0) return 'today';
    if (daysUntil === 1) return 'tomorrow';
    return `in ${daysUntil} days`;
  };

  const saveAsCollection = async (
    name: string,
    memoryIds: string[],
    isForYou: boolean,
  ) => {
    if (isForYou) setSavingForYou(true);
    else setSavingContinue(true);

    try {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');

      // Create the collection
      const newCollection = await createCollection(token, { name });

      // Add all memories to the collection
      let failedMemories = 0;
      for (const memoryId of memoryIds) {
        try {
          await addMemoryToCollection(token, newCollection.id, memoryId);
        } catch (error) {
          failedMemories++;
        }
      }

      // Check if all memories were added successfully
      if (failedMemories > 0) {
        Alert.alert(
          'Partial Error',
          `Collection "${name}" was created, but ${failedMemories} of ${memoryIds.length} memories failed to add. Please add them manually in the collection.`,
          [
            {
              text: 'View Collection',
              onPress: () => {
                queryClient.invalidateQueries({ queryKey: ['collections'] });
                queryClient.invalidateQueries({ queryKey: ['forYouSuggestion'] });
                queryClient.invalidateQueries({ queryKey: ['continueSuggestion'] });
                router.push(`/collections/${newCollection.id}`);
              },
            },
            { text: 'Cancel', style: 'cancel' },
          ],
        );
      } else {
        // Success
        queryClient.invalidateQueries({ queryKey: ['collections'] });
        queryClient.invalidateQueries({ queryKey: ['forYouSuggestion'] });
        queryClient.invalidateQueries({ queryKey: ['continueSuggestion'] });

        Alert.alert(
          'Success',
          `Created collection "${name}" with ${memoryIds.length} memories`,
          [
            {
              text: 'View Collection',
              onPress: () => {
                router.push(`/collections/${newCollection.id}`);
              },
            },
            { text: 'Done', style: 'cancel' },
          ],
        );
      }
    } catch (error) {
      Alert.alert(
        'Error',
        `Failed to create collection: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    } finally {
      if (isForYou) setSavingForYou(false);
      else setSavingContinue(false);
    }
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

              {/* For You Section */}
              {forYouSuggestion && (
                <View className="mb-6">
                  <Text className="text-lg font-semibold text-gray-900 mb-3">For You</Text>
                  <TouchableOpacity
                    onPress={() => handleSuggestionPress(forYouSuggestion.category)}
                    className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-2"
                  >
                    <Text className="text-base font-semibold text-gray-900 mb-1">
                      {forYouSuggestion.category}
                    </Text>
                    <Text className="text-sm text-gray-600">
                      {forYouSuggestion.count} item{forYouSuggestion.count > 1 ? 's' : ''} in this category
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() =>
                      saveAsCollection(
                        forYouSuggestion.category,
                        forYouSuggestion.memoryIds,
                        true,
                      )
                    }
                    disabled={savingForYou}
                    className={`rounded-lg py-2 px-4 flex-row items-center justify-center ${
                      savingForYou ? 'bg-purple-200' : 'bg-purple-600'
                    }`}
                  >
                    {savingForYou ? (
                      <>
                        <ActivityIndicator size="small" color="white" style={{ marginRight: 8 }} />
                        <Text className="text-white text-sm font-semibold">Saving...</Text>
                      </>
                    ) : (
                      <Text className="text-white text-sm font-semibold">Save as Collection</Text>
                    )}
                  </TouchableOpacity>
                </View>
              )}

              {/* Continue Section */}
              {continueSuggestion && (
                <View className="mb-6">
                  <Text className="text-lg font-semibold text-gray-900 mb-3">Continue</Text>
                  <TouchableOpacity
                    onPress={() => handleSuggestionPress(continueSuggestion.topic)}
                    className="bg-green-50 border border-green-200 rounded-lg p-4 mb-2"
                  >
                    <Text className="text-base font-semibold text-gray-900 mb-1">
                      {continueSuggestion.topic}
                    </Text>
                    <Text className="text-sm text-gray-600">
                      {continueSuggestion.count} item{continueSuggestion.count > 1 ? 's' : ''} on this topic
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() =>
                      saveAsCollection(
                        continueSuggestion.topic,
                        continueSuggestion.memoryIds,
                        false,
                      )
                    }
                    disabled={savingContinue}
                    className={`rounded-lg py-2 px-4 flex-row items-center justify-center ${
                      savingContinue ? 'bg-green-200' : 'bg-green-600'
                    }`}
                  >
                    {savingContinue ? (
                      <>
                        <ActivityIndicator size="small" color="white" style={{ marginRight: 8 }} />
                        <Text className="text-white text-sm font-semibold">Saving...</Text>
                      </>
                    ) : (
                      <Text className="text-white text-sm font-semibold">Save as Collection</Text>
                    )}
                  </TouchableOpacity>
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
