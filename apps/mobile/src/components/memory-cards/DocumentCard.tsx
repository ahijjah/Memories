import { View, Text } from 'react-native';

interface DocumentCardProps {
  aiSummary: any;
  aiTopics: any;
  aiIntent: any;
  aiEntities: any;
  aiDate: any;
}

export function DocumentCard({
  aiSummary,
  aiTopics,
  aiIntent,
  aiEntities,
  aiDate,
}: DocumentCardProps) {
  return (
    <>
      {/* Expiry Information */}
      {aiDate && (
        <View className="mb-6 p-4 bg-orange-50 rounded-lg border border-orange-200">
          <Text className="text-sm text-gray-600">
            <Text className="font-semibold">Expires:</Text> {new Date(aiDate).toLocaleDateString()}
          </Text>
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
