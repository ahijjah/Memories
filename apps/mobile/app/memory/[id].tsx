import { useAuth } from "@clerk/clerk-expo";
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { fetchMemoryDetail, fetchProcessingStatus, Memory, ProcessingStatus, AIInference } from '@/src/api/client';

export default function MemoryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getToken } = useAuth();
  const router = useRouter();

  const { data: memory, isLoading, error, refetch } = useQuery({
    queryKey: ['memory', id],
    queryFn: async () => {
      const token = await getToken();
      if (!id) throw new Error('Memory ID not found');
      return fetchMemoryDetail(token, id);
    },
  });

  const [shouldPoll, setShouldPoll] = useState(true);

  const { data: processingStatus, refetch: refetchStatus } = useQuery({
    queryKey: ['processingStatus', id],
    queryFn: async () => {
      const token = await getToken();
      if (!id) throw new Error('Memory ID not found');
      return fetchProcessingStatus(token, id);
    },
  });

  // Stop polling once processing is complete
  useEffect(() => {
    if (!processingStatus) return;
    if (processingStatus.processingState !== 'queued' && processingStatus.processingState !== 'processing') {
      setShouldPoll(false);
      return;
    }
    setShouldPoll(true);
    const interval = setInterval(() => {
      refetchStatus();
    }, 3000);
    return () => clearInterval(interval);
  }, [processingStatus, refetchStatus]);

  const getAIInferencesByField = (field: string): AIInference[] => {
    return memory?.aiInferences?.filter((inf) => inf.field === field) || [];
  };

  const getFieldValue = (field: string): any => {
    const inferences = getAIInferencesByField(field);
    if (inferences.length === 0) return null;
    return inferences[0].valueJson;
  };

  if (isLoading) {
    return (
      <View className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text className="text-gray-600 mt-4">Loading memory...</Text>
      </View>
    );
  }

  if (error || !memory) {
    return (
      <View className="flex-1 bg-white px-6 py-8">
        <View className="bg-red-50 rounded-lg p-4">
          <Text className="text-red-900 font-semibold mb-2">Error</Text>
          <Text className="text-red-700 text-sm mb-4">
            {error instanceof Error ? error.message : 'Failed to load memory'}
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

  const isProcessing = processingStatus?.processingState === 'queued' || processingStatus?.processingState === 'processing';
  const aiTitle = getFieldValue('title');
  const aiSummary = getFieldValue('summary');
  const aiTopics = getFieldValue('topics');

  return (
    <ScrollView className="flex-1 bg-white">
      <View className="px-6 py-8">
        {/* Processing Status */}
        <View className="mb-6 p-4 rounded-lg bg-blue-50">
          <View className="flex-row items-center gap-3">
            {isProcessing ? (
              <ActivityIndicator size="small" color="#3b82f6" />
            ) : (
              <View className="w-5 h-5 rounded-full bg-green-500" />
            )}
            <Text className="text-blue-900 font-semibold">
              {processingStatus?.processingState === 'queued' && 'Queued for processing...'}
              {processingStatus?.processingState === 'processing' && 'Processing your memory...'}
              {processingStatus?.processingState === 'understood' && 'Processing complete'}
              {processingStatus?.processingState === 'partial' && 'Partial processing'}
              {processingStatus?.processingState === 'failed' && 'Processing failed'}
            </Text>
          </View>
        </View>

        {/* Title */}
        <View className="mb-6">
          <Text className="text-xs text-gray-500 uppercase font-semibold mb-2">Title</Text>
          <Text className="text-3xl font-bold text-gray-900">
            {aiTitle ? aiTitle : memory.title || 'Untitled'}
          </Text>
        </View>

        {/* Source Info */}
        <View className="mb-6 p-4 bg-gray-50 rounded-lg">
          <Text className="text-sm text-gray-600 mb-1">
            <Text className="font-semibold">Source:</Text> {memory.sourceType}
          </Text>
          <Text className="text-sm text-gray-600">
            <Text className="font-semibold">Captured:</Text> {new Date(memory.capturedAt).toLocaleString()}
          </Text>
          {memory.sourceUri && (
            <Text className="text-sm text-gray-600 mt-1">
              <Text className="font-semibold">URL:</Text> {memory.sourceUri}
            </Text>
          )}
        </View>

        {/* Summary */}
        {aiSummary ? (
          <View className="mb-6">
            <Text className="text-lg font-semibold text-gray-900 mb-2">Summary</Text>
            <Text className="text-base text-gray-700 leading-6">{aiSummary}</Text>
          </View>
        ) : null}

        {/* Topics */}
        {aiTopics && Array.isArray(aiTopics) && aiTopics.length > 0 ? (
          <View className="mb-6">
            <Text className="text-lg font-semibold text-gray-900 mb-3">Topics</Text>
            <View className="flex-row flex-wrap gap-2">
              {aiTopics.map((topic: string, idx: number) => (
                <View key={idx} className="bg-blue-100 rounded-full px-4 py-2">
                  <Text className="text-blue-900 text-sm font-medium">{topic}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* Raw AI Inferences (for debugging) */}
        {memory.aiInferences && memory.aiInferences.length > 0 && !aiTitle && !aiSummary ? (
          <View className="mb-6 p-4 bg-gray-50 rounded-lg">
            <Text className="text-sm text-gray-600 font-mono">
              {memory.aiInferences.length} AI inferences available
            </Text>
          </View>
        ) : null}

        {/* Assets */}
        {memory.assets && memory.assets.length > 0 ? (
          <View className="mb-6">
            <Text className="text-lg font-semibold text-gray-900 mb-3">Attachments</Text>
            {memory.assets.map((asset) => (
              <View key={asset.id} className="bg-gray-50 p-4 rounded-lg mb-2">
                <Text className="text-sm text-gray-600">
                  <Text className="font-semibold">Type:</Text> {asset.mimeType}
                </Text>
                <Text className="text-sm text-gray-600">
                  <Text className="font-semibold">Size:</Text> {asset.variant || 'original'}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Refresh Button */}
        <TouchableOpacity
          onPress={() => {
            refetch();
            refetchStatus();
          }}
          className="bg-blue-600 rounded-lg py-3 mb-4"
        >
          <Text className="text-white text-center font-semibold">Refresh</Text>
        </TouchableOpacity>

        {/* Back Button */}
        <TouchableOpacity
          onPress={() => router.back()}
          className="bg-gray-200 rounded-lg py-3"
        >
          <Text className="text-gray-900 text-center font-semibold">Back</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
