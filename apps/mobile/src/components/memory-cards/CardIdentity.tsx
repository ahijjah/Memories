import { View, Text, TouchableOpacity } from 'react-native';
import { Memory } from '@/src/api/client';

interface CardIdentityProps {
  memory: Memory;
  onOpenURL: (url: string) => void;
}

export function CardIdentity({ memory, onOpenURL }: CardIdentityProps) {
  return (
    <View className="mb-6 p-4 bg-gray-50 rounded-lg">
      <Text className="text-sm text-gray-600 mb-1">
        <Text className="font-semibold">Source:</Text> {memory.sourceType}
      </Text>
      <Text className="text-sm text-gray-600">
        <Text className="font-semibold">Captured:</Text> {new Date(memory.capturedAt).toLocaleString()}
      </Text>
      {memory.sourceUri && (
        <View className="flex-row mt-1 flex-wrap items-center">
          <Text className="text-sm text-gray-600 font-semibold">URL:</Text>
          <TouchableOpacity onPress={() => onOpenURL(memory.sourceUri!)} className="ml-1">
            <Text className="text-sm text-blue-600 underline" numberOfLines={1}>
              {memory.sourceUri}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}
