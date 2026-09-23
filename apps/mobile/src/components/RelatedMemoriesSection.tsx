import React, { useCallback } from 'react';
import { View, Text } from 'react-native';
import { useRelatedMemories } from '../hooks/useRelatedMemories';
import { RelatedMemoryCard } from './memory-cards/RelatedMemoryCard';

interface RelatedMemoriesSectionProps {
  memoryId: string;
  onNavigateToMemory: (memoryId: string, isVault: boolean) => void;
}

export function RelatedMemoriesSection({
  memoryId,
  onNavigateToMemory,
}: RelatedMemoriesSectionProps) {
  const { data: relatedMemories, isLoading, error } = useRelatedMemories(memoryId);

  // Handle navigation to a related memory
  const handleNavigate = useCallback(
    (relatedId: string, relatedIsVault: boolean) => {
      onNavigateToMemory(relatedId, relatedIsVault);
    },
    [onNavigateToMemory]
  );

  // Hide section if loading, has error, or no results
  if (isLoading || error || !relatedMemories || relatedMemories.length === 0) {
    return null;
  }

  return (
    <View className="bg-gray-50 border-t border-gray-200">
      <View className="px-4 py-3">
        <Text className="text-lg font-semibold text-gray-900">
          Related Memories
        </Text>
      </View>

      {/* Results - max 5 cards */}
      <View>
        {relatedMemories.slice(0, 5).map((related) => (
          <RelatedMemoryCard
            key={related.id}
            memory={related}
            onPress={() => handleNavigate(related.id, related.securityScope === 'vault')}
          />
        ))}
      </View>
    </View>
  );
}
