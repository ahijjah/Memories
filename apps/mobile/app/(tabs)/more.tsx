import { useRouter } from 'expo-router';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';

export default function MoreScreen() {
  const router = useRouter();

  const menuItems = [
    { title: 'Capture', route: '/(tabs)/capture' },
    { title: 'Memories', route: '/(tabs)/memories' },
    { title: 'Collections', route: '/(tabs)/collections' },
    { title: 'Vault', route: '/(tabs)/vault' },
    { title: 'Account', route: '/(tabs)/account' },
  ];

  return (
    <ScrollView className="flex-1 bg-white">
      <View className="px-6 py-6">
        {menuItems.map((item) => (
          <TouchableOpacity
            key={item.title}
            onPress={() => router.push(item.route)}
            className="py-4 px-4 border-b border-gray-200 flex-row justify-between items-center"
          >
            <Text className="text-base font-medium text-gray-900">{item.title}</Text>
            <Text className="text-gray-400">›</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}
