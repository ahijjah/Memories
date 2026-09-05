import { useAuth } from "@clerk/clerk-expo";
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity, Modal, Alert, TextInput, Linking } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import DateTimePicker from '@react-native-community/datetimepicker';
import { fetchMemoryDetail, fetchProcessingStatus, Memory, ProcessingStatus, AIInference, listCollections, addMemoryToCollection, lockMemory, createReminder } from '@/src/api/client';

export default function MemoryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getToken } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showCollectionPicker, setShowCollectionPicker] = useState(false);
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [reminderDate, setReminderDate] = useState(new Date());
  const [reminderNote, setReminderNote] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  const { data: memory, isLoading, error, refetch } = useQuery({
    queryKey: ['memory', id],
    queryFn: async () => {
      const token = await getToken();
      if (!id) throw new Error('Memory ID not found');
      return fetchMemoryDetail(token, id);
    },
  });

  const { data: collections = [] } = useQuery({
    queryKey: ['collections'],
    queryFn: async () => {
      const token = await getToken();
      return listCollections(token);
    },
  });

  const { mutate: addToCollection, isPending: isAdding } = useMutation({
    mutationFn: async (collectionId: string) => {
      const token = await getToken();
      if (!id) throw new Error('Memory ID not found');
      return addMemoryToCollection(token, collectionId, id);
    },
    onSuccess: () => {
      Alert.alert('Success', 'Memory added to collection');
      setShowCollectionPicker(false);
      queryClient.invalidateQueries({ queryKey: ['collections'] });
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to add memory to collection';
      Alert.alert('Error', message);
    },
  });

  const { mutate: moveToVault, isPending: isLocking } = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      if (!id) throw new Error('Memory ID not found');
      return lockMemory(token, id);
    },
    onSuccess: () => {
      Alert.alert('Success', 'Memory moved to vault');
      queryClient.invalidateQueries({ queryKey: ['memories'] });
      router.push('/(tabs)/memories');
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to move to vault';
      Alert.alert('Error', message);
    },
  });

  const { mutate: setReminder, isPending: isSettingReminder } = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      if (!id) throw new Error('Memory ID not found');
      return createReminder(token, {
        memoryId: id,
        remindAt: reminderDate.toISOString(),
        note: reminderNote.trim() || undefined,
      });
    },
    onSuccess: () => {
      Alert.alert('Success', 'Reminder set');
      setShowReminderModal(false);
      setReminderNote('');
      setReminderDate(new Date());
      queryClient.invalidateQueries({ queryKey: ['reminders'] });
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to set reminder';
      Alert.alert('Error', message);
    },
  });

  const [shouldPoll, setShouldPoll] = useState(true);

  const { data: processingStatus, refetch: refetchStatus } = useQuery({
    queryKey: ['processingStatus', id],
    queryFn: async () => {
      const token = await getToken();
      if (!id) throw new Error('Memory ID not found');
      return fetchProcessingStatus(token, id);
    },
  });

  // Stop polling once processing is complete
  useEffect(() => {
    if (!processingStatus) return;
    if (processingStatus.processingState !== 'queued' && processingStatus.processingState !== 'processing') {
      setShouldPoll(false);
      return;
    }
    setShouldPoll(true);
    const interval = setInterval(() => {
      refetchStatus();
    }, 3000);
    return () => clearInterval(interval);
  }, [processingStatus, refetchStatus]);

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

  const isProcessing = processingStatus?.processingState === 'queued' || processingStatus?.processingState === 'processing';
  const aiTitle = getFieldValue('title');
  const aiSummary = getFieldValue('summary');
  const aiTopics = getFieldValue('topics');
  const aiIntent = getFieldValue('intent');
  const aiEntities = getFieldValue('entities');
  const aiLocation = getFieldValue('location');
  const aiDate = getFieldValue('date');

  return (
    <>
      <ScrollView className="flex-1 bg-white">
        <View className="px-6 py-8">
        {/* Processing Status */}
        <View className="mb-6 p-4 rounded-lg bg-blue-50">
          <View className="flex-row items-center gap-3">
            {isProcessing ? (
              <ActivityIndicator size="small" color="#3b82f6" />
            ) : (
              <View className="w-5 h-5 rounded-full bg-green-500" />
            )}
            <Text className="text-blue-900 font-semibold">
              {processingStatus?.processingState === 'queued' && 'Queued for processing...'}
              {processingStatus?.processingState === 'processing' && 'Processing your memory...'}
              {processingStatus?.processingState === 'understood' && 'Processing complete'}
              {processingStatus?.processingState === 'partial' && 'Partial processing'}
              {processingStatus?.processingState === 'failed' && 'Processing failed'}
            </Text>
          </View>
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

        {/* Raw AI Inferences (for debugging) */}
        {memory.aiInferences && memory.aiInferences.length > 0 && !aiTitle && !aiSummary ? (
          <View className="mb-6 p-4 bg-gray-50 rounded-lg">
            <Text className="text-sm text-gray-600 font-mono">
              {memory.aiInferences.length} AI inferences available
            </Text>
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

        {/* Set Reminder Button */}
        {memory.securityScope !== 'vault' ? (
          <TouchableOpacity
            onPress={() => setShowReminderModal(true)}
            className="bg-orange-600 rounded-lg py-3 mb-4"
          >
            <Text className="text-white text-center font-semibold">Set Reminder</Text>
          </TouchableOpacity>
        ) : null}

        {/* Move to Vault Button */}
        {memory.securityScope !== 'vault' ? (
          <TouchableOpacity
            onPress={() => {
              Alert.alert(
                'Move to Vault?',
                'This memory will be private and hidden from search, list, and ask results.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Move to Vault',
                    style: 'destructive',
                    onPress: () => moveToVault(),
                  },
                ],
              );
            }}
            disabled={isLocking}
            className={`rounded-lg py-3 mb-4 ${isLocking ? 'bg-gray-300' : 'bg-amber-600'}`}
          >
            {isLocking ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text className="text-white text-center font-semibold">Move to Vault</Text>
            )}
          </TouchableOpacity>
        ) : null}

        {/* Add to Collection Button */}
        {memory.securityScope !== 'vault' ? (
          <TouchableOpacity
            onPress={() => setShowCollectionPicker(true)}
            className="bg-purple-600 rounded-lg py-3 mb-4"
          >
            <Text className="text-white text-center font-semibold">Add to Collection</Text>
          </TouchableOpacity>
        ) : (
          <View className="bg-amber-50 rounded-lg py-3 px-4 mb-4">
            <Text className="text-amber-900 text-center text-sm font-semibold">
              Vault content cannot be added to collections
            </Text>
          </View>
        )}

        {/* Refresh Button */}
        <TouchableOpacity
          onPress={() => {
            refetch();
            refetchStatus();
          }}
          className="bg-blue-600 rounded-lg py-3 mb-4"
        >
          <Text className="text-white text-center font-semibold">Refresh</Text>
        </TouchableOpacity>

        {/* Back Button */}
        <TouchableOpacity
          onPress={() => router.back()}
          className="bg-gray-200 rounded-lg py-3"
        >
          <Text className="text-gray-900 text-center font-semibold">Back</Text>
        </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Reminder Modal */}
      <Modal visible={showReminderModal} animationType="slide" transparent={true}>
        <View className="flex-1 bg-black/50 justify-end">
          <View className="bg-white rounded-t-lg px-6 py-6">
            <Text className="text-xl font-semibold text-gray-900 mb-4">Set Reminder</Text>

            {/* Date Picker */}
            <View className="mb-4">
              <Text className="text-sm font-medium text-gray-700 mb-2">Date</Text>
              <TouchableOpacity
                onPress={() => setShowDatePicker(true)}
                className="border border-gray-300 rounded-lg px-4 py-3"
              >
                <Text className="text-base text-gray-900">
                  {reminderDate.toLocaleDateString()}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Time Picker */}
            <View className="mb-4">
              <Text className="text-sm font-medium text-gray-700 mb-2">Time</Text>
              <TouchableOpacity
                onPress={() => setShowTimePicker(true)}
                className="border border-gray-300 rounded-lg px-4 py-3"
              >
                <Text className="text-base text-gray-900">
                  {reminderDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Note Input */}
            <View className="mb-6">
              <Text className="text-sm font-medium text-gray-700 mb-2">Note (optional)</Text>
              <TextInput
                value={reminderNote}
                placeholder="Add a note for this reminder"
                onChangeText={setReminderNote}
                multiline
                numberOfLines={2}
                editable={!isSettingReminder}
                className="border border-gray-300 rounded-lg px-4 py-3 text-base"
                placeholderTextColor="#999"
              />
            </View>

            <View className="flex-row gap-3">
              <TouchableOpacity
                onPress={() => {
                  setShowReminderModal(false);
                  setReminderNote('');
                  setReminderDate(new Date());
                }}
                disabled={isSettingReminder}
                className="flex-1 bg-gray-200 rounded-lg py-3"
              >
                <Text className="text-gray-900 text-center font-semibold">Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setReminder()}
                disabled={isSettingReminder}
                className={`flex-1 rounded-lg py-3 ${isSettingReminder ? 'bg-gray-300' : 'bg-orange-600'}`}
              >
                {isSettingReminder ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text className="text-white text-center font-semibold">Set Reminder</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Date Time Pickers */}
      {showDatePicker && (
        <DateTimePicker
          value={reminderDate}
          mode="date"
          display="default"
          onChange={(event, selectedDate) => {
            if (selectedDate) {
              const newDate = new Date(reminderDate);
              newDate.setFullYear(selectedDate.getFullYear());
              newDate.setMonth(selectedDate.getMonth());
              newDate.setDate(selectedDate.getDate());
              setReminderDate(newDate);
            }
            setShowDatePicker(false);
          }}
        />
      )}

      {showTimePicker && (
        <DateTimePicker
          value={reminderDate}
          mode="time"
          display="default"
          onChange={(event, selectedDate) => {
            if (selectedDate) {
              const newDate = new Date(reminderDate);
              newDate.setHours(selectedDate.getHours());
              newDate.setMinutes(selectedDate.getMinutes());
              setReminderDate(newDate);
            }
            setShowTimePicker(false);
          }}
        />
      )}

    {/* Collection Picker Modal */}
      <Modal visible={showCollectionPicker} animationType="slide" transparent={true}>
        <View className="flex-1 bg-black/50 justify-end">
          <View className="bg-white rounded-t-lg max-h-96">
            <View className="border-b border-gray-200 px-6 py-4">
              <Text className="text-lg font-semibold text-gray-900">Add to Collection</Text>
            </View>

            <ScrollView className="px-6 py-4">
              {collections.length === 0 ? (
                <Text className="text-gray-600 text-center py-8">
                  No collections yet. Create one from the Collections tab.
                </Text>
              ) : (
                collections.map((collection) => (
                  <TouchableOpacity
                    key={collection.id}
                    onPress={() => addToCollection(collection.id)}
                    disabled={isAdding}
                    className="border border-gray-200 rounded-lg p-4 mb-3"
                  >
                    <Text className="text-base font-semibold text-gray-900">
                      {collection.name}
                    </Text>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>

            <View className="border-t border-gray-200 px-6 py-4">
              <TouchableOpacity
                onPress={() => setShowCollectionPicker(false)}
                disabled={isAdding}
                className="bg-gray-200 rounded-lg py-3"
              >
                <Text className="text-gray-900 text-center font-semibold">Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}
