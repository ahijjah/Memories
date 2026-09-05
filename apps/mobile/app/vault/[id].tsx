import { useAuth } from "@clerk/clerk-expo";
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity, Alert, Linking, Share, Platform } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Calendar from 'expo-calendar/legacy';
import { getVaultMemoryDetail, unlockMemory, AIInference } from '@/src/api/client';
import { getActionsForMemory, MemoryAction } from '@/src/utils/memory-actions';

export default function VaultDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getToken } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: memory, isLoading, error, refetch } = useQuery({
    queryKey: ['vaultMemory', id],
    queryFn: async () => {
      const token = await getToken();
      if (!id) throw new Error('Memory ID not found');
      return getVaultMemoryDetail(token, id);
    },
  });

  const { mutate: removeFromVault, isPending: isRemoving } = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      if (!id) throw new Error('Memory ID not found');
      return unlockMemory(token, id);
    },
    onSuccess: () => {
      Alert.alert('Success', 'Memory removed from vault');
      queryClient.invalidateQueries({ queryKey: ['vaultMemories'] });
      router.push('/(tabs)/vault');
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to remove from vault';
      Alert.alert('Error', message);
    },
  });

  const getAIInferencesByField = (field: string): AIInference[] => {
    return memory?.aiInferences?.filter((inf) => inf.field === field) || [];
  };

  const getFieldValue = (field: string): any => {
    const inferences = getAIInferencesByField(field);
    if (inferences.length === 0) return null;
    return inferences[0].valueJson;
  };

  const handleOpenURL = async (url: string) => {
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
      } else {
        Alert.alert('Cannot Open', `Cannot open this URL: ${url}`);
      }
    } catch {
      Alert.alert('Error', 'Failed to open URL');
    }
  };

  const handleAddToCalendar = async (action: MemoryAction) => {
    try {
      const { status } = await Calendar.requestCalendarPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Calendar access is required to add events');
        return;
      }

      const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      let calendarId = calendars[0]?.id;

      if (!calendarId && calendars.length === 0) {
        // Get platform-appropriate source for calendar creation
        let defaultSource;
        if (Platform.OS === 'ios') {
          const defaultCalendar = await Calendar.getDefaultCalendarAsync();
          defaultSource = defaultCalendar.source;
        } else {
          defaultSource = { type: Calendar.SourceType.LOCAL, name: 'Expo Calendar', isLocalAccount: true };
        }

        console.log('Creating calendar with defaultSource:', defaultSource);
        const newCalendarId = await Calendar.createCalendarAsync({
          title: 'Memories',
          color: '#3b82f6',
          entityType: Calendar.EntityTypes.EVENT,
          sourceId: defaultSource?.id,
          source: defaultSource,
          name: 'Memories',
          ownerAccount: defaultSource?.name ?? 'personal',
          accessLevel: Calendar.CalendarAccessLevel.OWNER,
        });
        calendarId = newCalendarId;
      }

      if (!calendarId) return;

      const date = action.payload?.date ? new Date(action.payload.date) : new Date();
      const endDate = new Date(date);
      endDate.setHours(endDate.getHours() + 1);

      await Calendar.createEventAsync(calendarId, {
        title: action.payload?.title || memory?.title || 'Memory Event',
        startDate: date,
        endDate,
        timeZone: 'UTC',
      });

      Alert.alert('Success', 'Event added to calendar');
    } catch (err) {
      console.error('Calendar error:', err);
      Alert.alert('Error', `Failed to add event to calendar: ${(err as Error).message}`);
    }
  };

  const handleOpenMaps = async (action: MemoryAction) => {
    try {
      const location = action.payload?.location;
      if (!location) return;

      const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
      const canOpen = await Linking.canOpenURL(mapsUrl);
      if (canOpen) {
        await Linking.openURL(mapsUrl);
      } else {
        Alert.alert('Cannot Open', 'Maps is not available on this device');
      }
    } catch {
      Alert.alert('Error', 'Failed to open maps');
    }
  };

  const handleShareMemory = async () => {
    try {
      await Share.share({
        message: memory?.title || 'Check this out!',
        url: memory?.sourceUri || undefined,
        title: memory?.title || 'Memory',
      });
    } catch (err) {
      if ((err as any).code !== 'E_SHARE_CANCELLED') {
        Alert.alert('Error', 'Failed to share');
      }
    }
  };

  const handleAskAbout = (action: MemoryAction) => {
    router.push({
      pathname: '/(tabs)/ask',
      params: { prefill: action.payload?.prefill || '' },
    });
  };

  const handleActionPress = (action: MemoryAction) => {
    switch (action.kind) {
      case 'calendar':
        handleAddToCalendar(action);
        break;
      case 'maps':
        handleOpenMaps(action);
        break;
      case 'share':
        handleShareMemory();
        break;
      case 'openUrl':
        handleOpenURL(action.payload?.url);
        break;
      case 'ask':
        handleAskAbout(action);
        break;
      case 'comingSoon':
        Alert.alert('Coming Soon', action.payload?.message || 'This feature is coming soon');
        break;
    }
  };

  if (isLoading) {
    return (
      <View className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text className="text-gray-600 mt-4">Loading memory...</Text>
      </View>
    );
  }

  if (error || !memory) {
    return (
      <View className="flex-1 bg-white px-6 py-8">
        <View className="bg-red-50 rounded-lg p-4">
          <Text className="text-red-900 font-semibold mb-2">Error</Text>
          <Text className="text-red-700 text-sm mb-4">
            {error instanceof Error ? error.message : 'Failed to load memory'}
          </Text>
          <TouchableOpacity
            onPress={() => refetch()}
            className="bg-red-600 rounded-lg py-2 px-4"
          >
            <Text className="text-white text-center font-semibold text-sm">Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const aiTitle = getFieldValue('title');
  const aiSummary = getFieldValue('summary');
  const aiTopics = getFieldValue('topics');
  const aiIntent = getFieldValue('intent');
  const aiEntities = getFieldValue('entities');
  const aiLocation = getFieldValue('location');
  const aiDate = getFieldValue('date');

  return (
    <ScrollView className="flex-1 bg-white">
      <View className="px-6 py-8">
        {/* Vault Status Badge */}
        <View className="mb-6 p-4 rounded-lg bg-amber-50 border border-amber-200">
          <Text className="text-amber-900 font-semibold">
            🔒 In Vault
          </Text>
        </View>

        {/* Title */}
        <View className="mb-6">
          <Text className="text-xs text-gray-500 uppercase font-semibold mb-2">Title</Text>
          <Text className="text-3xl font-bold text-gray-900">
            {aiTitle ? aiTitle : memory.title || 'Untitled'}
          </Text>
        </View>

        {/* Source Info */}
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
              <TouchableOpacity onPress={() => handleOpenURL(memory.sourceUri!)} className="ml-1">
                <Text className="text-sm text-blue-600 underline" numberOfLines={1}>
                  {memory.sourceUri}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

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

        {/* Structured Understanding — Intent, Entities, Location, Date */}
        {(aiIntent || (aiEntities && Array.isArray(aiEntities) && aiEntities.length > 0) || aiLocation || aiDate) ? (
          <View className="mb-6 p-4 bg-indigo-50 rounded-lg">
            <Text className="text-lg font-semibold text-gray-900 mb-3">Details</Text>

            {aiIntent && (
              <View className="mb-3">
                <Text className="text-sm text-gray-600">
                  <Text className="font-semibold">Intent:</Text> <Text className="text-indigo-600 font-medium">{aiIntent}</Text>
                </Text>
              </View>
            )}

            {aiLocation && (
              <View className="mb-3">
                <Text className="text-sm text-gray-600">
                  <Text className="font-semibold">Location:</Text> {aiLocation}
                </Text>
              </View>
            )}

            {aiDate && (
              <View className="mb-3">
                <Text className="text-sm text-gray-600">
                  <Text className="font-semibold">Date:</Text> {new Date(aiDate).toLocaleDateString()}
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

        {/* Assets */}
        {memory.assets && memory.assets.length > 0 ? (
          <View className="mb-6">
            <Text className="text-lg font-semibold text-gray-900 mb-3">Attachments</Text>
            {memory.assets.map((asset) => (
              <View key={asset.id} className="bg-gray-50 p-4 rounded-lg mb-2">
                <Text className="text-sm text-gray-600">
                  <Text className="font-semibold">Type:</Text> {asset.mimeType}
                </Text>
                <Text className="text-sm text-gray-600">
                  <Text className="font-semibold">Size:</Text> {asset.variant || 'original'}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Memory Actions */}
        {memory && (
          <View className="mb-6">
            {getActionsForMemory(memory, memory.aiInferences).length > 0 && (
              <View className="mb-4">
                {getActionsForMemory(memory, memory.aiInferences).map((action, idx) => (
                  <TouchableOpacity
                    key={idx}
                    onPress={() => handleActionPress(action)}
                    className={`rounded-lg py-3 mb-2 ${
                      action.kind === 'comingSoon'
                        ? 'bg-gray-200'
                        : action.kind === 'ask'
                          ? 'bg-green-600'
                          : 'bg-blue-600'
                    }`}
                  >
                    <Text
                      className={`text-center font-semibold ${
                        action.kind === 'comingSoon' ? 'text-gray-600' : 'text-white'
                      }`}
                    >
                      {action.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Remove from Vault Button */}
            <TouchableOpacity
              onPress={() => {
                Alert.alert(
                  'Remove from Vault?',
                  'This memory will be moved back to your regular memories.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Remove',
                      style: 'destructive',
                      onPress: () => removeFromVault(),
                    },
                  ],
                );
              }}
              disabled={isRemoving}
              className={`rounded-lg py-3 mb-4 ${isRemoving ? 'bg-gray-300' : 'bg-amber-600'}`}
            >
              {isRemoving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text className="text-white text-center font-semibold">Remove from Vault</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Back Button */}
        <TouchableOpacity
          onPress={() => router.back()}
          className="bg-gray-200 rounded-lg py-3"
        >
          <Text className="text-gray-900 text-center font-semibold">Back</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
