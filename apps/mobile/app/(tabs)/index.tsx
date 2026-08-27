import { useAuth, useClerk } from "@clerk/clerk-expo";
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { fetchHealth } from '@/src/api/client';

export default function HomeScreen() {
  const router = useRouter();
  const { getToken } = useAuth();
  const { signOut } = useClerk();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const token = await getToken();
      return fetchHealth(token);
    },
  });

  const handleSignOut = async () => {
    await signOut();
  };

  const handleRefresh = () => {
    refetch();
  };

  return (
    <View className="flex-1 bg-white relative">
      <ScrollView className="flex-1">
        <View className="px-6 py-8">
        <View className="mb-8">
          <Text className="text-3xl font-bold text-gray-900">Welcome to Memories</Text>
          <Text className="text-base text-gray-600 mt-2">API Connectivity Check</Text>
        </View>

        <View className="rounded-lg border border-gray-200 p-6 mb-6">
          <Text className="text-lg font-semibold text-gray-900 mb-4">Health Check Status</Text>

          {isLoading ? (
            <View className="items-center py-8">
              <ActivityIndicator size="large" color="#3b82f6" />
              <Text className="text-gray-600 mt-4">Checking API health...</Text>
            </View>
          ) : error ? (
            <View className="bg-red-50 rounded-lg p-4">
              <Text className="text-red-900 font-semibold mb-2">Error</Text>
              <Text className="text-red-700 text-sm">
                {error instanceof Error ? error.message : 'Failed to check health'}
              </Text>
            </View>
          ) : data ? (
            <View className="gap-3">
              <View className="flex-row items-center">
                <View className="w-3 h-3 rounded-full bg-green-500 mr-3" />
                <Text className="text-gray-900 font-medium">API is reachable</Text>
              </View>

              <View className="bg-gray-50 rounded-lg p-4 mt-4">
                <Text className="text-xs text-gray-600 font-mono">
                  {JSON.stringify(data, null, 2)}
                </Text>
              </View>
            </View>
          ) : null}
        </View>

        <View className="gap-3">
          <TouchableOpacity
            onPress={handleRefresh}
            disabled={isLoading}
            className="bg-blue-600 rounded-lg py-3"
          >
            <Text className="text-white text-center font-semibold">
              {isLoading ? 'Checking...' : 'Refresh Health Check'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleSignOut}
            className="bg-gray-200 rounded-lg py-3"
          >
            <Text className="text-gray-900 text-center font-semibold">Sign Out</Text>
          </TouchableOpacity>
        </View>

        <View className="mt-8 pt-8 border-t border-gray-200">
          <Text className="text-xs text-gray-500 mb-2">Environment Info:</Text>
          <Text className="text-xs text-gray-600 font-mono mb-1">
            API URL: {process.env.EXPO_PUBLIC_API_URL || 'Not set'}
          </Text>
        </View>
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
