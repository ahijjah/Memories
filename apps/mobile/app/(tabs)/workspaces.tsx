import { useAuth } from "@clerk/clerk-expo";
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useQuery } from '@tanstack/react-query';

interface Workspace {
  workspaceId: string;
  displayLabel: string;
  memoryCount: number;
}

interface WorkspaceListResponse {
  workspaces: Workspace[];
  total: number;
  limit: number;
  offset: number;
}

export default function WorkspacesScreen() {
  const { getToken } = useAuth();
  const router = useRouter();
  const [offset, setOffset] = useState(0);
  const limit = 20;

  const { data, isLoading, error, refetch } = useQuery<WorkspaceListResponse>({
    queryKey: ['workspaces', offset],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error('No auth token');

      const response = await fetch(
        `${process.env.EXPO_PUBLIC_API_URL}/workspaces?limit=${limit}&offset=${offset}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) throw new Error('Failed to fetch workspaces');
      return response.json();
    },
  });

  const handleWorkspacePress = (workspaceId: string) => {
    router.push(`/workspace/${workspaceId}`);
  };

  if (isLoading) {
    return (
      <View className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text className="text-gray-600 mt-4">Loading workspaces...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View className="flex-1 bg-white px-6 py-8">
        <View className="bg-red-50 rounded-lg p-4">
          <Text className="text-red-900 font-semibold mb-2">Error</Text>
          <Text className="text-red-700 text-sm mb-4">
            {error instanceof Error ? error.message : 'Failed to load workspaces'}
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

  const workspaces = data?.workspaces ?? [];
  const total = data?.total ?? 0;
  const hasMore = offset + limit < total;

  return (
    <ScrollView className="flex-1 bg-white">
      <View className="px-6 py-6">
        {workspaces.length === 0 ? (
          <View className="items-center justify-center py-12">
            <Text className="text-lg font-semibold text-gray-900 mb-2">
              No Workspaces
            </Text>
            <Text className="text-gray-600 text-center">
              Topics will appear here as you capture memories
            </Text>
          </View>
        ) : (
          <View>
            {workspaces.map((workspace) => (
              <TouchableOpacity
                key={workspace.workspaceId}
                onPress={() => handleWorkspacePress(workspace.workspaceId)}
                className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-3"
              >
                <View className="flex-row justify-between items-start">
                  <View className="flex-1">
                    <Text className="text-base font-semibold text-gray-900 mb-1">
                      {workspace.displayLabel}
                    </Text>
                    <Text className="text-xs text-gray-500">
                      {workspace.memoryCount} memory
                      {workspace.memoryCount !== 1 ? 'ies' : ''}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}

            {hasMore && (
              <TouchableOpacity
                onPress={() => setOffset(offset + limit)}
                className="bg-gray-200 rounded-lg py-3 mt-4"
              >
                <Text className="text-gray-700 text-center font-semibold">
                  Load More
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    </ScrollView>
  );
}
