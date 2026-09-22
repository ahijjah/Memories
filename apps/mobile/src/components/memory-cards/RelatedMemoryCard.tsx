import { View, Text, Pressable } from 'react-native';
import { RelatedMemoryResult } from '@/src/api/client';
import { AuthenticatedAssetImage } from '../AuthenticatedAssetImage';

interface RelatedMemoryCardProps {
  memory: RelatedMemoryResult;
  onPress: () => void;
}

const getTypeLabel = (memoryType?: string): string => {
  if (!memoryType) return 'Memory';

  switch (memoryType.toLowerCase()) {
    case 'event':
      return 'Event';
    case 'place':
      return 'Place';
    case 'product':
      return 'Product';
    case 'offer':
      return 'Offer';
    case 'article_learning':
    case 'article-learning':
      return 'Article';
    case 'video_social':
    case 'video-social':
      return 'Video';
    case 'document':
      return 'Document';
    default:
      return memoryType;
  }
};

const getTypeColor = (memoryType?: string): string => {
  if (!memoryType) return 'bg-gray-100';

  const type = memoryType.toLowerCase();
  switch (type) {
    case 'event':
      return 'bg-purple-100';
    case 'place':
      return 'bg-teal-100';
    case 'product':
      return 'bg-amber-100';
    case 'offer':
      return 'bg-red-100';
    case 'article_learning':
    case 'article-learning':
      return 'bg-blue-100';
    case 'video_social':
    case 'video-social':
      return 'bg-pink-100';
    case 'document':
      return 'bg-orange-100';
    default:
      return 'bg-gray-100';
  }
};

const getTypeTextColor = (memoryType?: string): string => {
  if (!memoryType) return 'text-gray-700';

  const type = memoryType.toLowerCase();
  switch (type) {
    case 'event':
      return 'text-purple-700';
    case 'place':
      return 'text-teal-700';
    case 'product':
      return 'text-amber-700';
    case 'offer':
      return 'text-red-700';
    case 'article_learning':
    case 'article-learning':
      return 'text-blue-700';
    case 'video_social':
    case 'video-social':
      return 'text-pink-700';
    case 'document':
      return 'text-orange-700';
    default:
      return 'text-gray-700';
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

export function RelatedMemoryCard({ memory, onPress }: RelatedMemoryCardProps) {
  const typeLabel = getTypeLabel(memory.memoryType);
  const typeColor = getTypeColor(memory.memoryType);
  const typeTextColor = getTypeTextColor(memory.memoryType);
  const formattedTimestamp = formatTimestamp(memory.capturedAt);

  // Get first image asset for thumbnail
  const imageAsset = memory.assets?.find(
    (asset) => asset.mimeType?.startsWith('image/')
  );

  return (
    <Pressable onPress={onPress}>
      <View className="flex-row items-center gap-3 px-4 py-3 bg-white border-b border-gray-200">
        {/* Thumbnail or Type badge */}
        {imageAsset ? (
          <AuthenticatedAssetImage
            assetId={imageAsset.id}
            contentUrl={imageAsset.url}
            style={{ width: 48, height: 48, borderRadius: 6 }}
          />
        ) : (
          <View className={`${typeColor} rounded-full px-2 py-1`}>
            <Text className={`${typeTextColor} text-xs font-semibold`}>
              {typeLabel}
            </Text>
          </View>
        )}

        {/* Main content */}
        <View className="flex-1">
          <Text
            className="text-base font-semibold text-gray-900 mb-1"
            numberOfLines={1}
          >
            {memory.title}
          </Text>

          <View className="flex-row items-center gap-2">
            <Text className="text-xs text-gray-600">
              {formattedTimestamp}
            </Text>
            {typeLabel !== 'Memory' && (
              <>
                <Text className="text-xs text-gray-400">•</Text>
                <Text className="text-xs text-gray-600">
                  {typeLabel}
                </Text>
              </>
            )}
          </View>
        </View>
      </View>
    </Pressable>
  );
}
