import React, { useCallback } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { useRelatedMemories } from '../hooks/useRelatedMemories';
import { RelatedMemoryCard } from './memory-cards/RelatedMemoryCard';

interface RelatedMemoriesSectionProps {
  memoryId: string;
  isVault?: boolean;
  onNavigateToMemory: (memoryId: string, isVault: boolean) => void;
}

export function RelatedMemoriesSection({
  memoryId,
  isVault = false,
  onNavigateToMemory,
}: RelatedMemoriesSectionProps) {
  const { data: relatedMemories, isLoading, error } = useRelatedMemories(memoryId, {
    isVault,
  });

  // Handle navigation to a related memory
  const handleNavigate = useCallback(
    (relatedId: string, relatedIsVault: boolean) => {
      onNavigateToMemory(relatedId, relatedIsVault);
    },
    [onNavigateToMemory]
  );

  // Hide if no results
  if (!relatedMemories || relatedMemories.length === 0) {
    return null;
  }

  return (
    <View className="bg-gray-50 border-t border-gray-200">
      <View className="px-4 py-3">
        <Text className="text-lg font-semibold text-gray-900">
          Related Memories
        </Text>
      </View>

      {/* Loading state */}
      {isLoading && (
        <View className="flex items-center py-6">
          <ActivityIndicator size="small" color="#666" />
        </View>
      )}

      {/* Error state - fail gracefully */}
      {error && !isLoading && (
        <View className="px-4 py-3">
          <Text className="text-sm text-gray-600">
            Could not load related memories
          </Text>
        </View>
      )}

      {/* Results */}
      {!error && relatedMemories && relatedMemories.length > 0 && (
        <View>
          {relatedMemories.slice(0, 5).map((related) => (
            <RelatedMemoryCard
              key={related.id}
              memory={related}
              onPress={() => handleNavigate(related.id, related.securityScope === 'vault')}
            />
          ))}
        </View>
      )}
    </View>
  );
}
