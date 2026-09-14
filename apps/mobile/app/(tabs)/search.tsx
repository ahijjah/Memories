import { useAuth } from "@clerk/clerk-expo";
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useState, useEffect } from 'react';
import { View, Text, TextInput, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useQuery, useMutation } from '@tanstack/react-query';
import { search, ask } from '@/src/api/client';
import { isQuestion } from '@/src/utils/is-question';

export default function SearchScreen() {
  const { getToken } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams();
  const initialQuery = typeof params.q === 'string' ? params.q : (typeof params.prefill === 'string' ? params.prefill : '');
  const [searchInput, setSearchInput] = useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchInput.trim());
    }, 400);

    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (initialQuery) {
      setDebouncedQuery(initialQuery.trim());
    }
  }, []);

  // Search query
  const { data: searchResults, isLoading: searchLoading, error: searchError } = useQuery({
    queryKey: ['search', debouncedQuery],
    queryFn: async () => {
      if (!debouncedQuery) return [];
      const token = await getToken();
      return search(token, debouncedQuery);
    },
    enabled: debouncedQuery.length > 0,
  });

  // Ask mutation (called separately for questions)
  const { mutate: submitQuestion, isPending: askPending, data: askResult, error: askError } = useMutation({
    mutationFn: async (q: string) => {
      const token = await getToken();
      return ask(token, q);
    },
  });

  useEffect(() => {
    if (debouncedQuery && isQuestion(debouncedQuery)) {
      submitQuestion(debouncedQuery);
    }
  }, [debouncedQuery, submitQuestion]);

  const handleResultPress = (id: string) => {
    router.push(`/memory/${id}`);
  };

  const handleSourcePress = (memoryId: string) => {
    router.push(`/memory/${memoryId}`);
  };

  const renderSearchResultCard = (result: any) => (
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

  const renderSourceCard = (source: any) => (
    <TouchableOpacity
      key={source.memoryId}
      onPress={() => handleSourcePress(source.memoryId)}
      className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-2"
    >
      <Text className="text-base font-semibold text-gray-900 mb-1">
        {source.title}
      </Text>
      {source.summary ? (
        <Text className="text-sm text-gray-600 mb-1" numberOfLines={2}>
          {source.summary}
        </Text>
      ) : null}
      {source.sourceUri ? (
        <Text className="text-xs text-gray-500">
          {source.sourceUri}
        </Text>
      ) : null}
    </TouchableOpacity>
  );

  const isLoading = searchLoading || askPending;
  const error = searchError || askError;

  return (
    <ScrollView className="flex-1 bg-white">
      <View className="px-6 py-6">
        {/* Search Input */}
        <View className="mb-6">
          <TextInput
            value={searchInput}
            placeholder="Search memories or ask a question..."
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
              {error instanceof Error ? error.message : 'Request failed'}
            </Text>
          </View>
        ) : null}

        {/* Loading State */}
        {isLoading ? (
          <View className="items-center justify-center py-8">
            <ActivityIndicator size="large" color="#3b82f6" />
            <Text className="text-gray-600 mt-4">
              {askPending ? 'Thinking...' : 'Searching...'}
            </Text>
          </View>
        ) : null}

        {/* Empty State */}
        {!debouncedQuery && !isLoading ? (
          <View className="items-center justify-center py-12">
            <Text className="text-lg font-semibold text-gray-900 mb-2">Search or Ask</Text>
            <Text className="text-gray-600 text-center">
              Search through your memories or ask a question to get answers grounded in your data
            </Text>
          </View>
        ) : null}

        {/* Answer Section (if question was asked) */}
        {askResult && !askPending ? (
          <View className="mb-6">
            <Text className="text-lg font-semibold text-gray-900 mb-3">Answer</Text>
            <View className="bg-gray-50 rounded-lg p-4 mb-6">
              <Text className="text-base text-gray-700 leading-6">
                {askResult.answer}
              </Text>
            </View>

            {/* Answer Sources */}
            {askResult.sources && askResult.sources.length > 0 ? (
              <View className="mb-6">
                <Text className="text-sm font-semibold text-gray-700 mb-3">
                  Sources
                </Text>
                {askResult.sources.map((source) => renderSourceCard(source))}
              </View>
            ) : null}
          </View>
        ) : null}

        {/* More Results Section */}
        {searchResults && searchResults.length > 0 ? (
          <View>
            {askResult ? (
              <Text className="text-sm font-semibold text-gray-700 mb-3">More Results</Text>
            ) : (
              <Text className="text-sm font-semibold text-gray-700 mb-3">Results</Text>
            )}
            {searchResults.map((result) => renderSearchResultCard(result))}
          </View>
        ) : null}

        {/* No Results */}
        {debouncedQuery && !isLoading && searchResults && searchResults.length === 0 && !askResult ? (
          <View className="items-center justify-center py-8">
            <Text className="text-gray-600">No memories found</Text>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}
