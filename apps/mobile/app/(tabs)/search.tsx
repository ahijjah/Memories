import { useAuth } from "@clerk/clerk-expo";
import { useRouter } from 'expo-router';
import { useState, useEffect } from 'react';
import { View, Text, TextInput, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { search } from '@/src/api/client';

export default function SearchScreen() {
  const { getToken } = useAuth();
  const router = useRouter();
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchInput.trim());
    }, 400);

    return () => clearTimeout(timer);
  }, [searchInput]);

  const { data: results, isLoading, error } = useQuery({
    queryKey: ['search', debouncedQuery],
    queryFn: async () => {
      if (!debouncedQuery) return [];
      const token = await getToken();
      return search(token, debouncedQuery);
    },
    enabled: debouncedQuery.length > 0,
  });

  const handleResultPress = (id: string) => {
    router.push(`/memory/${id}`);
  };

  const renderResultCard = (result: any) => (
    <TouchableOpacity
      key={result.id}
      onPress={() => handleResultPress(result.id)}
      className="bg-white border border-gray-200 rounded-lg p-4 mb-3"
    >
      <View className="flex-1">
        <Text className="text-lg font-semibold text-gray-900 mb-2" numberOfLines={2}>
          {result.title}
        </Text>
        {result.summary ? (
          <Text className="text-sm text-gray-600 mb-2" numberOfLines={2}>
            {result.summary}
          </Text>
        ) : null}
        {result.sourceUri ? (
          <Text className="text-xs text-gray-500 mb-1">
            {result.sourceUri}
          </Text>
        ) : null}
        <Text className="text-xs text-gray-400">
          Relevance: {(1 - result.distance).toFixed(2)}
        </Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <ScrollView className="flex-1 bg-white">
      <View className="px-6 py-6">
        {/* Search Input */}
        <View className="mb-6">
          <TextInput
            value={searchInput}
            placeholder="Search memories..."
            onChangeText={setSearchInput}
            className="border border-gray-300 rounded-lg px-4 py-3 text-base"
            placeholderTextColor="#999"
          />
        </View>

        {/* Error Message */}
        {error ? (
          <View className="bg-red-50 rounded-lg p-4 mb-6">
            <Text className="text-red-900 font-semibold mb-1">Error</Text>
            <Text className="text-red-700 text-sm">
              {error instanceof Error ? error.message : 'Search failed'}
            </Text>
          </View>
        ) : null}

        {/* Loading State */}
        {isLoading ? (
          <View className="items-center justify-center py-8">
            <ActivityIndicator size="large" color="#3b82f6" />
            <Text className="text-gray-600 mt-4">Searching...</Text>
          </View>
        ) : null}

        {/* Empty State */}
        {!debouncedQuery && !isLoading ? (
          <View className="items-center justify-center py-12">
            <Text className="text-lg font-semibold text-gray-900 mb-2">Search Memories</Text>
            <Text className="text-gray-600 text-center">
              Enter a query to search through your memories
            </Text>
          </View>
        ) : null}

        {/* No Results */}
        {debouncedQuery && !isLoading && results && results.length === 0 ? (
          <View className="items-center justify-center py-8">
            <Text className="text-gray-600">No memories found</Text>
          </View>
        ) : null}

        {/* Results */}
        {results && results.length > 0 ? (
          <View>
            {results.map((result) => renderResultCard(result))}
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}
