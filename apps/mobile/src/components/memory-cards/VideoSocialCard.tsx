import { View, Text } from 'react-native';

interface VideoSocialCardProps {
  aiSummary: any;
  aiTopics: any;
  aiIntent: any;
  aiEntities: any;
  sourceUri: string | null | undefined;
}

function derivePlatformFromUri(uri?: string | null): string | null {
  if (!uri) return null;

  try {
    const url = new URL(uri);
    const domain = url.hostname.toLowerCase();

    if (domain.includes('instagram.com')) return 'Instagram';
    if (domain.includes('tiktok.com')) return 'TikTok';
    if (domain.includes('facebook.com')) return 'Facebook';
    if (domain.includes('youtube.com') || domain.includes('youtu.be')) return 'YouTube';

    return null;
  } catch {
    return null;
  }
}

export function VideoSocialCard({
  aiSummary,
  aiTopics,
  aiIntent,
  aiEntities,
  sourceUri,
}: VideoSocialCardProps) {
  const platform = derivePlatformFromUri(sourceUri);

  return (
    <>
      {/* Platform badge */}
      {platform && (
        <View className="mb-6">
          <View className="inline-flex bg-purple-100 rounded-full px-3 py-1 self-start">
            <Text className="text-purple-700 text-xs font-semibold">{platform}</Text>
          </View>
        </View>
      )}

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

      {/* Additional Details */}
      {(aiIntent || (aiEntities && Array.isArray(aiEntities) && aiEntities.length > 0)) ? (
        <View className="mb-6 p-4 bg-indigo-50 rounded-lg">
          <Text className="text-lg font-semibold text-gray-900 mb-3">Details</Text>

          {aiIntent && (
            <View className="mb-3">
              <Text className="text-sm text-gray-600">
                <Text className="font-semibold">Intent:</Text> <Text className="text-indigo-600 font-medium">{aiIntent}</Text>
              </Text>
            </View>
          )}

          {aiEntities && Array.isArray(aiEntities) && aiEntities.length > 0 && (
            <View>
              <Text className="text-sm text-gray-600 font-semibold mb-2">Entities:</Text>
              <View className="flex-row flex-wrap gap-2">
                {aiEntities.map((entity: string, idx: number) => (
                  <View key={idx} className="bg-indigo-100 rounded-full px-3 py-1">
                    <Text className="text-indigo-800 text-xs font-medium">{entity}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>
      ) : null}
    </>
  );
}
