import { View, Text } from 'react-native';

interface CardHeaderProps {
  title: string | null | undefined;
}

export function CardHeader({ title }: CardHeaderProps) {
  return (
    <View className="mb-6">
      <Text className="text-xs text-gray-500 uppercase font-semibold mb-2">Title</Text>
      <Text className="text-3xl font-bold text-gray-900">
        {title || 'Untitled'}
      </Text>
    </View>
  );
}
