import { View, Text } from 'react-native';
import { Memory } from '@/src/api/client';
import { resolveCardType } from './cardTypeResolver';

interface CompactCardProps {
  memory: Memory;
}

const getTypeColor = (cardType: string): string => {
  switch (cardType) {
    case 'event':
      return 'bg-purple-100';
    case 'place':
      return 'bg-teal-100';
    case 'product':
      return 'bg-amber-100';
    case 'offer':
      return 'bg-red-100';
    case 'article_learning':
      return 'bg-blue-100';
    case 'video_social':
      return 'bg-pink-100';
    case 'document':
      return 'bg-orange-100';
    default:
      return 'bg-gray-100';
  }
};

const getTypeTextColor = (cardType: string): string => {
  switch (cardType) {
    case 'event':
      return 'text-purple-700';
    case 'place':
      return 'text-teal-700';
    case 'product':
      return 'text-amber-700';
    case 'offer':
      return 'text-red-700';
    case 'article_learning':
      return 'text-blue-700';
    case 'video_social':
      return 'text-pink-700';
    case 'document':
      return 'text-orange-700';
    default:
      return 'text-gray-700';
  }
};

const getTypeLabel = (cardType: string): string => {
  switch (cardType) {
    case 'event':
      return 'Event';
    case 'place':
      return 'Place';
    case 'product':
      return 'Product';
    case 'offer':
      return 'Offer';
    case 'article_learning':
      return 'Article';
    case 'video_social':
      return 'Video';
    case 'document':
      return 'Document';
    default:
      return 'Memory';
  }
};

const getSnippetField = (cardType: string): string | null => {
  switch (cardType) {
    case 'event':
    case 'offer':
    case 'document':
      return 'date';
    case 'product':
      return 'price';
    case 'place':
      return 'location';
    default:
      return null;
  };
};

const getFieldValue = (memory: Memory, field: string): any => {
  if (!memory.aiInferences) return null;
  const inference = memory.aiInferences.find((inf) => inf.field === field);
  return inference ? inference.valueJson : null;
};

const formatDate = (dateStr: string | null): string | null => {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return null;
  }
};

const formatTimestamp = (capturedAt: string): string => {
  const date = new Date(capturedAt);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
};

const getProcessingStateColor = (
  processingState: string,
): string => {
  switch (processingState) {
    case 'queued':
    case 'processing':
      return 'bg-blue-100';
    case 'understood':
      return 'bg-green-100';
    case 'partial':
      return 'bg-amber-100';
    case 'failed':
      return 'bg-red-100';
    default:
      return 'bg-gray-100';
  }
};

export function CompactCard({ memory }: CompactCardProps) {
  const cardType = resolveCardType(memory);
  const typeColor = getTypeColor(cardType);
  const typeTextColor = getTypeTextColor(cardType);
  const typeLabel = getTypeLabel(cardType);
  const snippetField = getSnippetField(cardType);
  const snippetValue = snippetField ? getFieldValue(memory, snippetField) : null;
  const processingStateColor = getProcessingStateColor(memory.processingState);

  const displayTitle = memory.title || `${memory.sourceType} Memory`;
  const formattedTimestamp = formatTimestamp(memory.capturedAt);

  return (
    <View className="flex-row items-center gap-3 px-4 py-3 bg-white border-b border-gray-200">
      {/* Type badge */}
      <View className={`${typeColor} rounded-full px-2 py-1`}>
        <Text className={`${typeTextColor} text-xs font-semibold`}>
          {typeLabel}
        </Text>
      </View>

      {/* Main content */}
      <View className="flex-1">
        <Text
          className="text-base font-semibold text-gray-900 mb-1"
          numberOfLines={1}
        >
          {displayTitle}
        </Text>

        <View className="flex-row items-center gap-2">
          <Text className="text-xs text-gray-600">
            {formattedTimestamp}
          </Text>

          {snippetValue && (
            <>
              <Text className="text-xs text-gray-400">•</Text>
              <Text className="text-xs text-gray-600" numberOfLines={1}>
                {snippetField === 'date'
                  ? formatDate(snippetValue) || snippetValue
                  : snippetValue}
              </Text>
            </>
          )}
        </View>
      </View>

      {/* Processing state indicator */}
      <View className={`${processingStateColor} rounded-full w-2 h-2`} />
    </View>
  );
}
