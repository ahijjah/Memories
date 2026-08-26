import { useAuth } from "@clerk/clerk-expo";
import { useRouter } from 'expo-router';
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listReminders, getRediscoveryMemories, updateReminderStatus, deleteReminder, Reminder, Memory } from '@/src/api/client';

export default function RemindersScreen() {
  const { getToken } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: reminders = [], isLoading: remindersLoading, error: remindersError, refetch: refetchReminders } = useQuery({
    queryKey: ['reminders'],
    queryFn: async () => {
      const token = await getToken();
      return listReminders(token);
    },
  });

  const { data: rediscoveryMemories = [], isLoading: rediscoveryLoading, refetch: refetchRediscover } = useQuery({
    queryKey: ['rediscover'],
    queryFn: async () => {
      const token = await getToken();
      return getRediscoveryMemories(token);
    },
  });

  const { mutate: updateStatus, isPending: isUpdating } = useMutation({
    mutationFn: async ({ reminderId, status }: { reminderId: string; status: string }) => {
      const token = await getToken();
      return updateReminderStatus(token, reminderId, status);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reminders'] });
    },
  });

  const { mutate: removeReminder, isPending: isRemoving } = useMutation({
    mutationFn: async (reminderId: string) => {
      const token = await getToken();
      return deleteReminder(token, reminderId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reminders'] });
    },
  });

  const handleStatusChange = (reminderId: string, status: string) => {
    updateStatus({ reminderId, status });
  };

  const handleDeleteReminder = (reminderId: string) => {
    Alert.alert(
      'Delete Reminder?',
      'This reminder will be deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => removeReminder(reminderId),
        },
      ],
    );
  };

  const handleRediscoverMemoryPress = (memoryId: string) => {
    router.push(`/memory/${memoryId}`);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'due':
        return 'bg-red-100 text-red-900';
      case 'completed':
        return 'bg-green-100 text-green-900';
      case 'dismissed':
        return 'bg-gray-100 text-gray-900';
      default:
        return 'bg-blue-100 text-blue-900';
    }
  };

  if (remindersLoading) {
    return (
      <View className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text className="text-gray-600 mt-4">Loading reminders...</Text>
      </View>
    );
  }

  if (remindersError) {
    return (
      <View className="flex-1 bg-white px-6 py-8">
        <View className="bg-red-50 rounded-lg p-4">
          <Text className="text-red-900 font-semibold mb-2">Error</Text>
          <Text className="text-red-700 text-sm mb-4">
            {remindersError instanceof Error ? remindersError.message : 'Failed to load reminders'}
          </Text>
          <TouchableOpacity
            onPress={() => refetchReminders()}
            className="bg-red-600 rounded-lg py-2 px-4"
          >
            <Text className="text-white text-center font-semibold text-sm">Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-white">
      <View className="px-6 py-6">
        {/* Info Note */}
        <View className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <Text className="text-sm text-blue-900">
            Reminders appear here when due — there's no push notification yet, so check back in the app.
          </Text>
        </View>

        {/* Reminders Section */}
        <Text className="text-lg font-semibold text-gray-900 mb-3">Your Reminders</Text>

        {reminders.length === 0 ? (
          <View className="bg-gray-50 rounded-lg p-6 mb-8 items-center">
            <Text className="text-gray-600 text-center">
              No reminders yet. Set a reminder on a memory to get started.
            </Text>
          </View>
        ) : (
          <View className="mb-8">
            {reminders.map((reminder) => (
              <View key={reminder.id} className="border border-gray-200 rounded-lg p-4 mb-3">
                <View className="flex-row justify-between items-start mb-3">
                  <View className="flex-1">
                    <Text className="text-sm text-gray-600 mb-1">
                      {new Date(reminder.remindAt).toLocaleString()}
                    </Text>
                    {reminder.note && (
                      <Text className="text-sm text-gray-700 mb-2">{reminder.note}</Text>
                    )}
                  </View>
                  <View className={`rounded-full px-3 py-1 ${getStatusColor(reminder.status)}`}>
                    <Text className={`text-xs font-semibold capitalize`}>
                      {reminder.status}
                    </Text>
                  </View>
                </View>

                <View className="flex-row gap-2">
                  {reminder.status !== 'completed' && (
                    <TouchableOpacity
                      onPress={() => handleStatusChange(reminder.id, 'completed')}
                      disabled={isUpdating}
                      className="flex-1 bg-green-600 rounded-lg py-2"
                    >
                      <Text className="text-white text-center font-semibold text-sm">Complete</Text>
                    </TouchableOpacity>
                  )}
                  {reminder.status !== 'dismissed' && (
                    <TouchableOpacity
                      onPress={() => handleStatusChange(reminder.id, 'dismissed')}
                      disabled={isUpdating}
                      className="flex-1 bg-gray-300 rounded-lg py-2"
                    >
                      <Text className="text-gray-900 text-center font-semibold text-sm">Dismiss</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    onPress={() => handleDeleteReminder(reminder.id)}
                    disabled={isRemoving}
                    className="flex-1 bg-red-600 rounded-lg py-2"
                  >
                    <Text className="text-white text-center font-semibold text-sm">Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Rediscover Section */}
        <View className="border-t border-gray-200 pt-6">
          <View className="flex-row justify-between items-center mb-4">
            <Text className="text-lg font-semibold text-gray-900">Rediscover</Text>
            <TouchableOpacity
              onPress={() => refetchRediscover()}
              disabled={rediscoveryLoading}
              className="px-3 py-1 bg-blue-600 rounded-lg"
            >
              {rediscoveryLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text className="text-white text-sm font-semibold">Reroll</Text>
              )}
            </TouchableOpacity>
          </View>

          {rediscoveryMemories.length === 0 ? (
            <View className="bg-gray-50 rounded-lg p-6 items-center">
              <Text className="text-gray-600 text-center">
                No older memories to rediscover yet.
              </Text>
            </View>
          ) : (
            rediscoveryMemories.map((memory: Memory) => (
              <TouchableOpacity
                key={memory.id}
                onPress={() => handleRediscoverMemoryPress(memory.id)}
                className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-3"
              >
                <Text className="text-base font-semibold text-gray-900 mb-1">
                  {memory.title || 'Untitled'}
                </Text>
                <Text className="text-xs text-gray-500">
                  {new Date(memory.capturedAt).toLocaleDateString()}
                </Text>
              </TouchableOpacity>
            ))
          )}
        </View>
      </View>
    </ScrollView>
  );
}
