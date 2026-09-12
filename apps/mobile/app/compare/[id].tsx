import React from "react";
import { useAuth } from "@clerk/clerk-expo";
import { useLocalSearchParams } from "expo-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity, Alert } from "react-native";
import { fetchMemories, Memory, compareMemories } from "@/src/api/client";

export default function CompareScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getToken } = useAuth();
  const initiatingMemoryId = id;

  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [result, setResult] = React.useState<{ comparison: string; keyDifferences: string[] } | null>(null);

  // Fetch all product memories
  const { data: memories = [], isLoading, error } = useQuery({
    queryKey: ['memories'],
    queryFn: async () => {
      const token = await getToken();
      return fetchMemories(token);
    },
  });

  // Filter to product types, excluding the initiating memory
  const productMemories = memories.filter(
    (m: Memory) => {
      const memType = m.memoryType?.toLowerCase() || 'other';
      return (memType === 'product' || memType === 'PRODUCT') && m.id !== initiatingMemoryId;
    }
  );

  // Comparison mutation
  const compareMutation = useMutation({
    mutationFn: async (memoryIds: string[]) => {
      const token = await getToken();
      return compareMemories(token, memoryIds);
    },
    onSuccess: (data) => {
      setResult(data);
    },
    onError: (error) => {
      Alert.alert('Error', `Failed to compare: ${error instanceof Error ? error.message : 'Unknown error'}`);
    },
  });

  const handleToggleSelection = (memoryId: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(memoryId)) {
      newSelected.delete(memoryId);
    } else {
      if (newSelected.size >= 4) {
        Alert.alert('Limit reached', 'You can select up to 4 additional products (5 total including the initiating one)');
        return;
      }
      newSelected.add(memoryId);
    }
    setSelectedIds(newSelected);
  };

  const handleCompare = () => {
    const allIds = [initiatingMemoryId, ...Array.from(selectedIds)];
    compareMutation.mutate(allIds);
  };

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-white">
      <View className="px-6 py-6">
        {/* Result section */}
        {result && (
          <View className="mb-8">
            <Text className="text-lg font-semibold text-gray-900 mb-4">Comparison Result</Text>
            <View className="bg-blue-50 rounded-lg p-4 mb-4">
              <Text className="text-gray-800 leading-6">{result.comparison}</Text>
            </View>

            {result.keyDifferences.length > 0 && (
              <View>
                <Text className="text-base font-semibold text-gray-900 mb-2">Key Differences</Text>
                {result.keyDifferences.map((diff, idx) => (
                  <View key={idx} className="flex-row mb-2">
                    <Text className="text-gray-700 mr-2">•</Text>
                    <Text className="flex-1 text-gray-700">{diff}</Text>
                  </View>
                ))}
              </View>
            )}

            <TouchableOpacity
              onPress={() => {
                setResult(null);
                setSelectedIds(new Set());
              }}
              className="mt-6 bg-blue-600 rounded-lg py-3"
            >
              <Text className="text-white text-center font-semibold">Compare More</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Selection section (hidden when result is shown) */}
        {!result && (
          <View>
            <Text className="text-lg font-semibold text-gray-900 mb-4">
              Select Products to Compare (1-4 more)
            </Text>

            {productMemories.length === 0 ? (
              <View className="items-center py-12">
                <Text className="text-gray-600 text-center">
                  No other product memories found. Try saving more products first.
                </Text>
              </View>
            ) : (
              <View className="mb-6">
                {productMemories.map((memory: Memory) => (
                  <TouchableOpacity
                    key={memory.id}
                    onPress={() => handleToggleSelection(memory.id)}
                    className={`flex-row items-center p-4 rounded-lg mb-2 border-2 ${
                      selectedIds.has(memory.id)
                        ? 'bg-blue-50 border-blue-600'
                        : 'bg-white border-gray-200'
                    }`}
                  >
                    <View
                      className={`w-6 h-6 rounded border-2 items-center justify-center mr-3 ${
                        selectedIds.has(memory.id)
                          ? 'bg-blue-600 border-blue-600'
                          : 'bg-white border-gray-300'
                      }`}
                    >
                      {selectedIds.has(memory.id) && (
                        <Text className="text-white font-bold">✓</Text>
                      )}
                    </View>
                    <View className="flex-1">
                      <Text className="text-base font-semibold text-gray-900">{memory.title}</Text>
                      {memory.sourceUri && (
                        <Text className="text-xs text-gray-500 mt-1">{memory.sourceUri}</Text>
                      )}
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {productMemories.length > 0 && (
              <TouchableOpacity
                onPress={handleCompare}
                disabled={selectedIds.size === 0 || compareMutation.isPending}
                className={`rounded-lg py-3 ${
                  selectedIds.size === 0 || compareMutation.isPending
                    ? 'bg-gray-300'
                    : 'bg-blue-600'
                }`}
              >
                <Text className="text-white text-center font-semibold">
                  {compareMutation.isPending ? 'Comparing...' : 'Compare Selected'}
                </Text>
              </TouchableOpacity>
            )}

            {error && (
              <View className="bg-red-50 rounded-lg p-4 mt-4">
                <Text className="text-red-900 font-semibold">Error</Text>
                <Text className="text-red-700 text-sm">
                  {error instanceof Error ? error.message : 'Failed to load memories'}
                </Text>
              </View>
            )}
          </View>
        )}
      </View>
    </ScrollView>
  );
}
