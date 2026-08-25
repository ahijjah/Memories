import { useAuth } from "@clerk/clerk-expo";
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getCollectionDetail, deleteCollection, removeMemoryFromCollection } from '@/src/api/client';

export default function CollectionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getToken } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: collection, isLoading, error, refetch } = useQuery({
    queryKey: ['collection', id],
    queryFn: async () => {
      const token = await getToken();
      if (!id) throw new Error('Collection ID not found');
      return getCollectionDetail(token, id);
    },
  });

  const { mutate: deleteCol, isPending: isDeleting } = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      if (!id) throw new Error('Collection ID not found');
      await deleteCollection(token, id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collections'] });
      router.push('/(tabs)/collections');
    },
  });

  const { mutate: removeMemory } = useMutation({
    mutationFn: async (memoryId: string) => {
      const token = await getToken();
      if (!id) throw new Error('Collection ID not found');
      await removeMemoryFromCollection(token, id, memoryId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collection', id] });
    },
  });

  const handleDeleteCollection = () => {
    Alert.alert(
      'Delete Collection?',
      `Are you sure you want to delete "${collection?.name}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteCol(),
        },
      ],
    );
  };

  const handleRemoveMemory = (memoryId: string) => {
    Alert.alert(
      'Remove Memory?',
      'Remove this memory from the collection?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => removeMemory(memoryId),
        },
      ],
    );
  };

  const handleMemoryPress = (memoryId: string) => {
    router.push(`/memory/${memoryId}`);
  };

  if (isLoading) {
    return (
      <View className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text className="text-gray-600 mt-4">Loading collection...</Text>
      </View>
    );
  }

  if (error || !collection) {
    return (
      <View className="flex-1 bg-white px-6 py-8">
        <View className="bg-red-50 rounded-lg p-4">
          <Text className="text-red-900 font-semibold mb-2">Error</Text>
          <Text className="text-red-700 text-sm mb-4">
            {error instanceof Error ? error.message : 'Failed to load collection'}
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

  const memories = collection.memories || [];

  return (
    <ScrollView className="flex-1 bg-white">
      <View className="px-6 py-6">
        {/* Collection Info */}
        <View className="mb-6">
          <Text className="text-3xl font-bold text-gray-900 mb-2">{collection.name}</Text>
          {collection.description ? (
            <Text className="text-base text-gray-600 mb-2">{collection.description}</Text>
          ) : null}
          <Text className="text-sm text-gray-500">
            {memories.length} memory{memories.length !== 1 ? 'ies' : ''}
          </Text>
        </View>

        {/* Delete Button */}
        <TouchableOpacity
          onPress={handleDeleteCollection}
          disabled={isDeleting}
          className={`rounded-lg py-3 mb-6 ${isDeleting ? 'bg-gray-300' : 'bg-red-600'}`}
        >
          {isDeleting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text className="text-white text-center font-semibold">Delete Collection</Text>
          )}
        </TouchableOpacity>

        {/* Memories List */}
        {memories.length === 0 ? (
          <View className="items-center justify-center py-12">
            <Text className="text-lg font-semibold text-gray-900 mb-2">No Memories</Text>
            <Text className="text-gray-600 text-center">
              This collection is empty. Add memories from the Memories tab.
            </Text>
          </View>
        ) : (
          <View>
            <Text className="text-lg font-semibold text-gray-900 mb-3">Memories</Text>
            {memories.map((item) => (
              <View key={item.memory.id} className="mb-3">
                <TouchableOpacity
                  onPress={() => handleMemoryPress(item.memory.id)}
                  className="bg-gray-50 border border-gray-200 rounded-lg p-4 flex-row justify-between items-start"
                >
                  <View className="flex-1">
                    <Text className="text-base font-semibold text-gray-900 mb-1">
                      {item.memory.title || 'Untitled'}
                    </Text>
                    <Text className="text-xs text-gray-500">
                      {new Date(item.memory.capturedAt).toLocaleDateString()}
                    </Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => handleRemoveMemory(item.memory.id)}
                  className="bg-red-50 rounded-lg py-2 px-4 mt-2"
                >
                  <Text className="text-red-700 text-center font-semibold text-sm">Remove</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* Back Button */}
        <TouchableOpacity
          onPress={() => router.back()}
          className="bg-gray-200 rounded-lg py-3 mt-6"
        >
          <Text className="text-gray-900 text-center font-semibold">Back</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
