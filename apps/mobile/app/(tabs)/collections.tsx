import { useAuth } from "@clerk/clerk-expo";
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity, TextInput, Modal } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listCollections, createCollection, Collection } from '@/src/api/client';

export default function CollectionsScreen() {
  const { getToken } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [collectionName, setCollectionName] = useState('');
  const [collectionDescription, setCollectionDescription] = useState('');

  const { data: collections = [], isLoading, error, refetch } = useQuery({
    queryKey: ['collections'],
    queryFn: async () => {
      const token = await getToken();
      return listCollections(token);
    },
  });

  const { mutate: createNew, isPending: isCreating } = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      return createCollection(token, {
        name: collectionName.trim(),
        description: collectionDescription.trim() || undefined,
      });
    },
    onSuccess: () => {
      setCollectionName('');
      setCollectionDescription('');
      setShowCreateModal(false);
      queryClient.invalidateQueries({ queryKey: ['collections'] });
    },
  });

  const handleCreateCollection = () => {
    if (!collectionName.trim()) return;
    createNew();
  };

  const handleCollectionPress = (collectionId: string) => {
    router.push(`/collection/${collectionId}`);
  };

  if (isLoading) {
    return (
      <View className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text className="text-gray-600 mt-4">Loading collections...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View className="flex-1 bg-white px-6 py-8">
        <View className="bg-red-50 rounded-lg p-4">
          <Text className="text-red-900 font-semibold mb-2">Error</Text>
          <Text className="text-red-700 text-sm mb-4">
            {error instanceof Error ? error.message : 'Failed to load collections'}
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
    <>
      <ScrollView className="flex-1 bg-white">
        <View className="px-6 py-6">
          <TouchableOpacity
            onPress={() => setShowCreateModal(true)}
            className="bg-blue-600 rounded-lg py-3 mb-6"
          >
            <Text className="text-white text-center font-semibold">+ New Collection</Text>
          </TouchableOpacity>

          {collections.length === 0 ? (
            <View className="items-center justify-center py-12">
              <Text className="text-lg font-semibold text-gray-900 mb-2">No Collections</Text>
              <Text className="text-gray-600 text-center">
                Create a collection to organize your memories
              </Text>
            </View>
          ) : (
            <View>
              {collections.map((collection) => (
                <TouchableOpacity
                  key={collection.id}
                  onPress={() => handleCollectionPress(collection.id)}
                  className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-3"
                >
                  <View className="flex-row justify-between items-start">
                    <View className="flex-1">
                      <Text className="text-base font-semibold text-gray-900 mb-1">
                        {collection.name}
                      </Text>
                      {collection.description ? (
                        <Text className="text-sm text-gray-600 mb-2" numberOfLines={1}>
                          {collection.description}
                        </Text>
                      ) : null}
                      <Text className="text-xs text-gray-500">
                        {collection.memories?.length || 0} memory
                        {collection.memories?.length !== 1 ? 'ies' : ''}
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      <Modal visible={showCreateModal} animationType="slide" transparent={true}>
        <View className="flex-1 bg-black/50 justify-end">
          <View className="bg-white rounded-t-lg px-6 py-6">
            <Text className="text-xl font-semibold text-gray-900 mb-4">Create Collection</Text>

            <View className="mb-4">
              <Text className="text-sm font-medium text-gray-700 mb-2">Name</Text>
              <TextInput
                value={collectionName}
                placeholder="Collection name"
                onChangeText={setCollectionName}
                editable={!isCreating}
                className="border border-gray-300 rounded-lg px-4 py-3 text-base"
                placeholderTextColor="#999"
              />
            </View>

            <View className="mb-6">
              <Text className="text-sm font-medium text-gray-700 mb-2">Description (optional)</Text>
              <TextInput
                value={collectionDescription}
                placeholder="Collection description"
                onChangeText={setCollectionDescription}
                multiline
                numberOfLines={3}
                editable={!isCreating}
                className="border border-gray-300 rounded-lg px-4 py-3 text-base"
                placeholderTextColor="#999"
              />
            </View>

            <View className="flex-row gap-3">
              <TouchableOpacity
                onPress={() => {
                  setCollectionName('');
                  setCollectionDescription('');
                  setShowCreateModal(false);
                }}
                disabled={isCreating}
                className="flex-1 bg-gray-200 rounded-lg py-3"
              >
                <Text className="text-gray-900 text-center font-semibold">Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleCreateCollection}
                disabled={isCreating || !collectionName.trim()}
                className={`flex-1 rounded-lg py-3 ${
                  isCreating || !collectionName.trim() ? 'bg-gray-300' : 'bg-blue-600'
                }`}
              >
                {isCreating ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text className="text-white text-center font-semibold">Create</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}
