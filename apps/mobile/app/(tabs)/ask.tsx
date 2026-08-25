import { useAuth } from "@clerk/clerk-expo";
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View, Text, TextInput, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { ask } from '@/src/api/client';

export default function AskScreen() {
  const { getToken } = useAuth();
  const router = useRouter();
  const [question, setQuestion] = useState('');

  const { mutate: submitQuestion, isPending, data: result, error } = useMutation({
    mutationFn: async (q: string) => {
      const token = await getToken();
      return ask(token, q);
    },
  });

  const handleAsk = () => {
    if (!question.trim()) return;
    submitQuestion(question.trim());
  };

  const handleSourcePress = (memoryId: string) => {
    router.push(`/memory/${memoryId}`);
  };

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

  return (
    <ScrollView className="flex-1 bg-white">
      <View className="px-6 py-6">
        {/* Question Input */}
        <View className="mb-6">
          <Text className="text-sm font-medium text-gray-700 mb-2">Ask a question</Text>
          <TextInput
            value={question}
            placeholder="What would you like to know?"
            onChangeText={setQuestion}
            multiline
            numberOfLines={4}
            editable={!isPending}
            className="border border-gray-300 rounded-lg px-4 py-3 text-base"
            placeholderTextColor="#999"
          />
        </View>

        {/* Submit Button */}
        <TouchableOpacity
          onPress={handleAsk}
          disabled={isPending || !question.trim()}
          className={`rounded-lg py-3 mb-6 ${
            isPending || !question.trim() ? 'bg-gray-300' : 'bg-blue-600'
          }`}
        >
          {isPending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text className="text-white text-center font-semibold">Ask</Text>
          )}
        </TouchableOpacity>

        {/* Loading State */}
        {isPending ? (
          <View className="items-center justify-center py-12">
            <ActivityIndicator size="large" color="#3b82f6" />
            <Text className="text-gray-600 mt-4">Thinking...</Text>
          </View>
        ) : null}

        {/* Error Message */}
        {error && !isPending ? (
          <View className="bg-red-50 rounded-lg p-4 mb-6">
            <Text className="text-red-900 font-semibold mb-1">Error</Text>
            <Text className="text-red-700 text-sm">
              {error instanceof Error ? error.message : 'Failed to get answer'}
            </Text>
          </View>
        ) : null}

        {/* Answer */}
        {result && !isPending ? (
          <View className="mb-6">
            <Text className="text-lg font-semibold text-gray-900 mb-3">Answer</Text>
            <View className="bg-gray-50 rounded-lg p-4 mb-6">
              <Text className="text-base text-gray-700 leading-6">
                {result.answer}
              </Text>
            </View>

            {/* Sources */}
            {result.sources && result.sources.length > 0 ? (
              <View>
                <Text className="text-lg font-semibold text-gray-900 mb-3">
                  Sources
                </Text>
                {result.sources.map((source) => renderSourceCard(source))}
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Empty State */}
        {!result && !isPending && !error ? (
          <View className="items-center justify-center py-12">
            <Text className="text-lg font-semibold text-gray-900 mb-2">Ask Your Memories</Text>
            <Text className="text-gray-600 text-center">
              Ask a question about your saved memories and get answers grounded in your own data
            </Text>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}
