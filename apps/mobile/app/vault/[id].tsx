import { useAuth } from "@clerk/clerk-expo";
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity, Alert, Linking, Share, Platform, Image, Modal, FlatList, TextInput } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import * as Calendar from 'expo-calendar/legacy';

import { getVaultMemoryDetail, unlockMemory, AIInference, reprocessMemory, deleteVaultMemory, listPeople, assignPersonToMemory, unassignPersonFromMemory, Person, confirmVaultField } from '@/src/api/client';
import { getActionsForMemory, MemoryAction } from '@/src/utils/memory-actions';
import { uploadPhotoToExistingMemory } from '@/src/utils/photo-upload';
import { CardHeader } from '@/src/components/memory-cards/CardHeader';
import { CardIdentity } from '@/src/components/memory-cards/CardIdentity';
import { GenericCard } from '@/src/components/memory-cards/GenericCard';
import { EventCard } from '@/src/components/memory-cards/EventCard';
import { PlaceCard } from '@/src/components/memory-cards/PlaceCard';
import { ProductCard } from '@/src/components/memory-cards/ProductCard';
import { OfferCard } from '@/src/components/memory-cards/OfferCard';
import { ArticleLearningCard } from '@/src/components/memory-cards/ArticleLearningCard';
import { VideoSocialCard } from '@/src/components/memory-cards/VideoSocialCard';
import { DocumentCard } from '@/src/components/memory-cards/DocumentCard';
import { resolveCardType } from '@/src/components/memory-cards/cardTypeResolver';
import { checkBiometricEnrollment, authenticateVault, useVaultAutoLock, useVaultScreenProtection, type VaultAuthState } from '@/src/utils/vault-auth';

export default function VaultDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getToken } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isAddingPhoto, setIsAddingPhoto] = useState(false);
  const [authState, setAuthState] = useState<VaultAuthState>('locked');
  const [enrollmentChecked, setEnrollmentChecked] = useState(false);
  const [showPersonPicker, setShowPersonPicker] = useState(false);
  const [showNotesModal, setShowNotesModal] = useState(false);
  const [notesText, setNotesText] = useState('');

  useVaultAutoLock(authState, setAuthState);
  useVaultScreenProtection(authState === 'unlocked');

  useFocusEffect(
    useCallback(() => {
      checkVaultAuthentication();
    }, [])
  );

  const checkVaultAuthentication = async () => {
    setAuthState('checking');
    const { hasHardware, isEnrolled } = await checkBiometricEnrollment();

    if (!hasHardware || !isEnrolled) {
      setEnrollmentChecked(true);
      setAuthState('no_enrollment');
      return;
    }

    setEnrollmentChecked(true);
    setAuthState('locked');
  };

  const handleUnlockVault = async () => {
    const success = await authenticateVault();
    if (success) {
      setAuthState('unlocked');
    } else {
      setAuthState('failed');
    }
  };

  const handleRetryAuthentication = () => {
    setAuthState('locked');
  };

  const handleContinueWithoutBiometric = () => {
    setAuthState('unlocked');
  };

  const { data: memory, isLoading, error, refetch } = useQuery({
    queryKey: ['vaultMemory', id],
    queryFn: async () => {
      const token = await getToken();
      if (!id) throw new Error('Memory ID not found');
      return getVaultMemoryDetail(token, id);
    },
    enabled: authState === 'unlocked',
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

  const { mutate: deleteMemoryMutation, isPending: isDeleting } = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      if (!id) throw new Error('Memory ID not found');
      return deleteVaultMemory(token, id);
    },
    onSuccess: () => {
      Alert.alert('Success', 'Memory deleted. It can be restored within 30 days.');
      queryClient.invalidateQueries({ queryKey: ['vaultMemories'] });
      router.push('/(tabs)/vault');
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to delete memory';
      Alert.alert('Error', message);
    },
  });

  const { data: people = [] } = useQuery({
    queryKey: ['people'],
    queryFn: async () => {
      const token = await getToken();
      return listPeople(token);
    },
  });

  const { mutate: assignPerson, isPending: isAssigning } = useMutation({
    mutationFn: async (personId: string) => {
      const token = await getToken();
      if (!id) throw new Error('Memory ID not found');
      return assignPersonToMemory(token, personId, id);
    },
    onSuccess: () => {
      setShowPersonPicker(false);
      refetch();
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to assign person';
      Alert.alert('Error', message);
    },
  });

  const { mutate: unassignPerson, isPending: isUnassigning } = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      if (!id || !memory?.personId) throw new Error('Missing data');
      return unassignPersonFromMemory(token, memory.personId, id);
    },
    onSuccess: () => {
      refetch();
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to unassign person';
      Alert.alert('Error', message);
    },
  });

  const { mutate: saveNotes, isPending: isSavingNotes } = useMutation({
    mutationFn: async (notes: string) => {
      const token = await getToken();
      if (!id) throw new Error('Memory ID not found');
      return confirmVaultField(token, id, 'notes', notes);
    },
    onSuccess: () => {
      setShowNotesModal(false);
      refetch();
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to save notes';
      Alert.alert('Error', message);
    },
  });

  const getAIInferencesByField = (field: string): AIInference[] => {
    return memory?.aiInferences?.filter((inf) => inf.field === field) || [];
  };

  const getFieldValue = (field: string): any => {
    // Check userConfirmations first (spec §6 precedence rule)
    const confirmation = memory?.userConfirmations?.find((uc) => uc.field === field);
    if (confirmation) return confirmation.confirmedValue;

    const inferences = getAIInferencesByField(field);
    if (inferences.length === 0) return null;
    return inferences[0].valueJson;
  };

  const getFieldConfidence = (field: string): number | null => {
    const inferences = getAIInferencesByField(field);
    if (inferences.length === 0) return null;
    return inferences[0].confidence;
  };

  const isFieldConfirmed = (field: string): boolean => {
    return memory?.userConfirmations?.some((uc) => uc.field === field) || false;
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
    Alert.alert(
      'Share Vault Item?',
      'This will share the title of this Vault document outside the app. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Share',
          style: 'destructive',
          onPress: async () => {
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
          },
        },
      ]
    );
  };

  const handleAddPhoto = async () => {
    try {
      setIsAddingPhoto(true);
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 1,
      });

      if (!result.canceled && result.assets[0] && id) {
        const asset = result.assets[0];
        const mimeType = asset.mimeType || 'image/jpeg';
        const token = await getToken();

        if (!token || !asset.uri) {
          throw new Error('Authentication or image data missing');
        }

        // Upload photo to existing memory
        await uploadPhotoToExistingMemory(token, id, asset.uri, mimeType);

        // Trigger reprocessing
        await reprocessMemory(token, id);

        // Refetch the memory to show updated data
        await refetch();

        Alert.alert('Success', 'Photo added! Analyzing details...');
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to add photo');
    } finally {
      setIsAddingPhoto(false);
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

  // Checking enrollment
  if (authState === 'checking' || !enrollmentChecked) {
    return (
      <View className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text className="text-gray-600 mt-4">Preparing vault...</Text>
      </View>
    );
  }

  // Locked state - need authentication
  if (authState === 'locked') {
    return (
      <View className="flex-1 bg-white px-6 py-8 items-center justify-center">
        <View className="items-center mb-8">
          <Text className="text-3xl mb-4">🔒</Text>
          <Text className="text-2xl font-bold text-gray-900 mb-2">Vault Locked</Text>
          <Text className="text-center text-gray-600 mb-6">
            Authenticate to access this vault item
          </Text>
        </View>
        <TouchableOpacity
          onPress={handleUnlockVault}
          className="w-full bg-blue-600 rounded-lg py-3 px-4 mb-3"
        >
          <Text className="text-white text-center font-semibold">Unlock Vault</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // No biometric/passcode enrolled
  if (authState === 'no_enrollment') {
    return (
      <View className="flex-1 bg-white px-6 py-8 items-center justify-center">
        <View className="items-center mb-8">
          <Text className="text-4xl mb-4">⚠️</Text>
          <Text className="text-2xl font-bold text-gray-900 mb-2">No Security Setup</Text>
          <Text className="text-center text-gray-600 mb-6">
            Your device doesn't have a passcode or biometric lock set up. For better security, consider enabling one in your device settings.
          </Text>
        </View>
        <TouchableOpacity
          onPress={handleContinueWithoutBiometric}
          className="w-full bg-blue-600 rounded-lg py-3 px-4"
        >
          <Text className="text-white text-center font-semibold">Continue Anyway</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Authentication failed
  if (authState === 'failed') {
    return (
      <View className="flex-1 bg-white px-6 py-8 items-center justify-center">
        <View className="items-center mb-8">
          <Text className="text-4xl mb-4">❌</Text>
          <Text className="text-2xl font-bold text-gray-900 mb-2">Authentication Failed</Text>
          <Text className="text-center text-gray-600 mb-6">
            Unable to authenticate. Please try again.
          </Text>
        </View>
        <TouchableOpacity
          onPress={handleRetryAuthentication}
          className="w-full bg-blue-600 rounded-lg py-3 px-4"
        >
          <Text className="text-white text-center font-semibold">Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Unlocked - show content
  if (authState !== 'unlocked') {
    return null;
  }

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
  const aiBrand = getFieldValue('brand');
  const aiModel = getFieldValue('model');
  const aiPrice = getFieldValue('price');
  const aiCategory = getFieldValue('category');
  const aiMerchant = getFieldValue('merchant');
  const aiOriginalPrice = getFieldValue('originalPrice');
  const aiOfferPrice = getFieldValue('offerPrice');
  const aiDiscount = getFieldValue('discount');
  const aiPromoCode = getFieldValue('promoCode');

  // Check if banner should show: URL-sourced event with no date and no existing assets (vault memories are excluded since reprocessing is blocked for vault content)
  const shouldShowPhotoPrompt = memory
    && memory.sourceType === 'url'
    && memory.memoryType === 'event'
    && !aiDate
    && (!memory.assets || memory.assets.length === 0)
    && memory.securityScope !== 'vault';

  return (
    <ScrollView className="flex-1 bg-white">
      <View className="px-6 py-8">
        {/* Vault Status Badge */}
        <View className="mb-6 p-4 rounded-lg bg-amber-50 border border-amber-200">
          <Text className="text-amber-900 font-semibold">
            🔒 In Vault
          </Text>
        </View>

        {/* Person Assignment Section */}
        <View className="mb-6 p-4 rounded-lg bg-blue-50 border border-blue-200">
          {memory.personId ? (
            <View>
              <View className="flex-row items-center justify-between mb-3">
                <View>
                  <Text className="text-sm text-blue-700 font-semibold">Linked to Person</Text>
                  <Text className="text-lg font-bold text-blue-900 mt-1">
                    {people.find((p) => p.id === memory.personId)?.name || 'Unknown'}
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={() => {
                  Alert.alert('Unlink Person?', 'Remove this person from the document?', [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Unlink',
                      style: 'destructive',
                      onPress: () => unassignPerson(),
                    },
                  ]);
                }}
                disabled={isUnassigning}
                className={`py-2 px-3 rounded-lg ${isUnassigning ? 'bg-blue-200' : 'bg-blue-600'}`}
              >
                <Text className="text-white text-center font-semibold text-sm">
                  {isUnassigning ? 'Unlinking...' : 'Unlink'}
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View>
              <Text className="text-sm text-blue-700 font-semibold mb-3">No Person Linked</Text>
              <TouchableOpacity
                onPress={() => setShowPersonPicker(true)}
                disabled={people.length === 0}
                className={`py-2 px-3 rounded-lg ${
                  people.length === 0 ? 'bg-gray-300' : 'bg-blue-600'
                }`}
              >
                <Text className="text-white text-center font-semibold text-sm">
                  {people.length === 0 ? 'No People Added' : 'Link Person'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Person Picker Modal */}
        <Modal
          visible={showPersonPicker}
          transparent
          animationType="slide"
          onRequestClose={() => setShowPersonPicker(false)}
        >
          <View className="flex-1 bg-black/50">
            <View className="flex-1 bg-white mt-auto rounded-t-2xl">
              <View className="p-4 border-b border-gray-200">
                <View className="flex-row items-center justify-between">
                  <Text className="text-lg font-bold text-gray-900">Link Person</Text>
                  <TouchableOpacity onPress={() => setShowPersonPicker(false)}>
                    <Text className="text-lg text-gray-600">✕</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <FlatList
                data={people}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    onPress={() => assignPerson(item.id)}
                    disabled={isAssigning}
                    className="p-4 border-b border-gray-100 flex-row items-center justify-between"
                  >
                    <View>
                      <Text className="text-base font-semibold text-gray-900">{item.name}</Text>
                      {item.relationship && (
                        <Text className="text-sm text-gray-600 mt-1">{item.relationship}</Text>
                      )}
                    </View>
                    {isAssigning ? (
                      <ActivityIndicator size="small" />
                    ) : (
                      <Text className="text-blue-600 font-semibold">Select</Text>
                    )}
                  </TouchableOpacity>
                )}
                ListEmptyComponent={
                  <View className="p-8 items-center">
                    <Text className="text-gray-600 text-center">
                      No people added yet. Go to the People tab to create one.
                    </Text>
                  </View>
                }
              />
            </View>
          </View>
        </Modal>

        {/* Notes Section */}
        <View className="mb-6 p-4 rounded-lg bg-purple-50 border border-purple-200">
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-sm text-purple-700 font-semibold">Notes</Text>
            <TouchableOpacity
              onPress={() => {
                setNotesText(getFieldValue('notes') || '');
                setShowNotesModal(true);
              }}
            >
              <Text className="text-blue-600 font-semibold text-sm">Edit</Text>
            </TouchableOpacity>
          </View>
          {getFieldValue('notes') ? (
            <Text className="text-base text-gray-700">{getFieldValue('notes')}</Text>
          ) : (
            <Text className="text-sm text-gray-500 italic">No notes yet. Add some context about this document.</Text>
          )}
        </View>

        {/* Notes Modal */}
        <Modal
          visible={showNotesModal}
          transparent
          animationType="slide"
          onRequestClose={() => setShowNotesModal(false)}
        >
          <View className="flex-1 bg-black/50">
            <View className="flex-1 bg-white mt-auto rounded-t-2xl">
              <View className="p-4 border-b border-gray-200">
                <View className="flex-row items-center justify-between">
                  <Text className="text-lg font-bold text-gray-900">Edit Notes</Text>
                  <TouchableOpacity onPress={() => setShowNotesModal(false)}>
                    <Text className="text-lg text-gray-600">✕</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <View className="flex-1 p-4">
                <TextInput
                  multiline
                  numberOfLines={8}
                  value={notesText}
                  onChangeText={setNotesText}
                  placeholder="Add any notes or context about this document..."
                  className="flex-1 p-3 border border-gray-300 rounded-lg text-base text-gray-900"
                  textAlignVertical="top"
                />
              </View>
              <View className="p-4 border-t border-gray-200 flex-row gap-3">
                <TouchableOpacity
                  onPress={() => setShowNotesModal(false)}
                  className="flex-1 bg-gray-300 rounded-lg py-3"
                >
                  <Text className="text-center font-semibold text-gray-900">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => saveNotes(notesText)}
                  disabled={isSavingNotes}
                  className={`flex-1 rounded-lg py-3 ${isSavingNotes ? 'bg-purple-300' : 'bg-purple-600'}`}
                >
                  <Text className="text-center font-semibold text-white">
                    {isSavingNotes ? 'Saving...' : 'Save Notes'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Add Photo Prompt */}
        {shouldShowPhotoPrompt && (
          <View className="mb-6 p-4 rounded-lg bg-amber-50 border border-amber-200">
            <View className="flex-row items-center justify-between gap-3">
              <View className="flex-1">
                <Text className="text-amber-900 font-semibold text-sm">Want a photo of this for better details?</Text>
              </View>
              <TouchableOpacity
                onPress={handleAddPhoto}
                disabled={isAddingPhoto}
                className={`rounded-lg py-2 px-4 ${isAddingPhoto ? 'bg-amber-200' : 'bg-amber-600'}`}
              >
                {isAddingPhoto ? (
                  <ActivityIndicator size="small" color="#78350f" />
                ) : (
                  <Text className="text-white font-semibold text-sm">Add Photo</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        <CardHeader title={aiTitle ? aiTitle : memory.title} />

        {/* Card Display — type-specific layout */}
        <CardIdentity memory={memory} onOpenURL={handleOpenURL} />

        {(() => {
          const cardType = resolveCardType(memory);
          const isVault = memory.securityScope === 'vault';
          switch (cardType) {
            case 'event':
              return (
                <EventCard
                  aiSummary={aiSummary}
                  aiTopics={aiTopics}
                  aiIntent={aiIntent}
                  aiEntities={aiEntities}
                  aiLocation={aiLocation}
                  aiDate={aiDate}
                  {...(!isVault && {
                    memoryId: id,
                    dateConfidence: getFieldConfidence('date'),
                    isDateConfirmed: isFieldConfirmed('date'),
                    onConfirmed: () => refetch(),
                  })}
                />
              );
            case 'place':
              return (
                <PlaceCard
                  aiSummary={aiSummary}
                  aiTopics={aiTopics}
                  aiIntent={aiIntent}
                  aiEntities={aiEntities}
                  aiLocation={aiLocation}
                  aiCategory={aiCategory}
                  {...(!isVault && {
                    memoryId: id,
                    locationConfidence: getFieldConfidence('location'),
                    isLocationConfirmed: isFieldConfirmed('location'),
                    onConfirmed: () => refetch(),
                  })}
                />
              );
            case 'product':
              return (
                <ProductCard
                  aiSummary={aiSummary}
                  aiTopics={aiTopics}
                  aiIntent={aiIntent}
                  aiEntities={aiEntities}
                  aiBrand={aiBrand}
                  aiModel={aiModel}
                  aiPrice={aiPrice}
                  aiCategory={aiCategory}
                  {...(!isVault && {
                    memoryId: id,
                    priceConfidence: getFieldConfidence('price'),
                    isPriceConfirmed: isFieldConfirmed('price'),
                    onConfirmed: () => refetch(),
                  })}
                />
              );
            case 'offer':
              return (
                <OfferCard
                  aiSummary={aiSummary}
                  aiTopics={aiTopics}
                  aiIntent={aiIntent}
                  aiEntities={aiEntities}
                  aiMerchant={aiMerchant}
                  aiOriginalPrice={aiOriginalPrice}
                  aiOfferPrice={aiOfferPrice}
                  aiDiscount={aiDiscount}
                  aiPromoCode={aiPromoCode}
                  aiDate={aiDate}
                  {...(!isVault && {
                    memoryId: id,
                    offerPriceConfidence: getFieldConfidence('offerPrice'),
                    isOfferPriceConfirmed: isFieldConfirmed('offerPrice'),
                    dateConfidence: getFieldConfidence('date'),
                    isDateConfirmed: isFieldConfirmed('date'),
                    onConfirmed: () => refetch(),
                  })}
                />
              );
            case 'article_learning':
              return (
                <ArticleLearningCard
                  aiSummary={aiSummary}
                  aiTopics={aiTopics}
                  aiIntent={aiIntent}
                  aiEntities={aiEntities}
                />
              );
            case 'video_social':
              return (
                <VideoSocialCard
                  aiSummary={aiSummary}
                  aiTopics={aiTopics}
                  aiIntent={aiIntent}
                  aiEntities={aiEntities}
                  sourceUri={memory.sourceUri}
                />
              );
            case 'document':
              return (
                <DocumentCard
                  aiSummary={aiSummary}
                  aiTopics={aiTopics}
                  aiIntent={aiIntent}
                  aiEntities={aiEntities}
                  aiDate={aiDate}
                  aiCategory={aiCategory}
                  aiIssuer={getFieldValue('issuer')}
                  aiOwner={getFieldValue('owner')}
                  aiDocumentNumber={getFieldValue('documentNumber')}
                  aiIssueDate={getFieldValue('issueDate')}
                />
              );
            case 'generic':
            default:
              return (
                <GenericCard
                  aiSummary={aiSummary}
                  aiTopics={aiTopics}
                  aiIntent={aiIntent}
                  aiEntities={aiEntities}
                  aiLocation={aiLocation}
                  aiDate={aiDate}
                />
              );
          }
        })()}

        {/* Assets */}
        {memory.assets && memory.assets.length > 0 ? (
          <View className="mb-6">
            <Text className="text-lg font-semibold text-gray-900 mb-3">Attachments</Text>
            {memory.assets
              .sort((a, b) => {
                const aPageIndex = a.pageIndex ?? Number.MAX_SAFE_INTEGER;
                const bPageIndex = b.pageIndex ?? Number.MAX_SAFE_INTEGER;
                return aPageIndex - bPageIndex;
              })
              .map((asset) => {
                const isImageMimeType = asset.mimeType?.startsWith('image/');
                return (
                  <View key={asset.id} className="mb-3">
                    {isImageMimeType && asset.url ? (
                      <Image
                        source={{ uri: asset.url }}
                        style={{ width: '100%', resizeMode: 'contain', aspectRatio: 1 }}
                      />
                    ) : (
                      <View className="bg-gray-50 p-4 rounded-lg">
                        <Text className="text-sm text-gray-600">
                          <Text className="font-semibold">Type:</Text> {asset.mimeType}
                        </Text>
                        <Text className="text-sm text-gray-600">
                          <Text className="font-semibold">Size:</Text> {asset.variant || 'original'}
                        </Text>
                      </View>
                    )}
                  </View>
                );
              })}
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

            {/* Delete Memory Button */}
            <TouchableOpacity
              onPress={() => {
                Alert.alert(
                  'Delete Memory?',
                  'This memory will be permanently deleted after 30 days. You can restore it during this grace period.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Delete',
                      style: 'destructive',
                      onPress: () => deleteMemoryMutation(),
                    },
                  ],
                );
              }}
              disabled={isDeleting}
              className={`rounded-lg py-3 mb-4 ${isDeleting ? 'bg-gray-300' : 'bg-red-600'}`}
            >
              {isDeleting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text className="text-white text-center font-semibold">Delete Memory</Text>
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
