import { useAuth } from "@clerk/clerk-expo";
import { useRouter } from 'expo-router';
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { listVaultMemories, Memory } from '@/src/api/client';

export default function VaultScreen() {
  const { getToken } = useAuth();
  const router = useRouter();

  const { data: memories = [], isLoading, error, refetch } = useQuery({
    queryKey: ['vaultMemories'],
    queryFn: async () => {
      const token = await getToken();
      return listVaultMemories(token);
    },
  });

  const handleMemoryPress = (memoryId: string) => {
    router.push(`/vault/${memoryId}`);
  };

  if (isLoading) {
    return (
      <View className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text className="text-gray-600 mt-4">Loading vault...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View className="flex-1 bg-white px-6 py-8">
        <View className="bg-red-50 rounded-lg p-4">
          <Text className="text-red-900 font-semibold mb-2">Error</Text>
          <Text className="text-red-700 text-sm mb-4">
            {error instanceof Error ? error.message : 'Failed to load vault'}
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
    <ScrollView className="flex-1 bg-white">
      <View className="px-6 py-6">
        {/* Privacy Notice */}
        <View className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
          <Text className="text-sm text-amber-900">
            Vault items are private to your account but use the same sign-in as the rest of the app — no separate lock screen yet.
          </Text>
        </View>

        {memories.length === 0 ? (
          <View className="items-center justify-center py-12">
            <Text className="text-lg font-semibold text-gray-900 mb-2">Vault Empty</Text>
            <Text className="text-gray-600 text-center">
              Move memories here from the Memories tab to keep them private
            </Text>
          </View>
        ) : (
          <View>
            {memories.map((memory: Memory) => (
              <TouchableOpacity
                key={memory.id}
                onPress={() => handleMemoryPress(memory.id)}
                className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-3"
              >
                <Text className="text-base font-semibold text-gray-900 mb-1">
                  {memory.title || 'Untitled'}
                </Text>
                <Text className="text-xs text-gray-500">
                  {new Date(memory.capturedAt).toLocaleDateString()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}
