import { useRouter } from 'expo-router';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@clerk/clerk-expo';
import { v4 as uuidv4 } from 'uuid';
import { createMemory, lockMemory } from '@/src/api/client';
import { DocumentScanner } from '@/src/components/document-scanner';

export default function DocumentScannerScreen() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [memoryId, setMemoryId] = useState<string | null>(null);
  const [isCreatingMemory, setIsCreatingMemory] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const initializeAndLockMemory = useCallback(async () => {
    try {
      const token = await getToken();
      const timestamp = new Date().toLocaleString();
      const idempotencyKey = uuidv4();

      // Create the memory
      const memory = await createMemory(
        token,
        'camera',
        idempotencyKey,
        undefined,
        `Document ${timestamp}`
      );

      // CRITICAL: Lock to vault immediately before showing camera or uploading any pages
      // This ensures securityScope='vault' is set before completeUpload() enqueues AI processing
      try {
        await lockMemory(token, memory.id);
      } catch (lockErr) {
        // Lock failed—do not proceed to camera
        throw new Error(`Failed to secure document in Vault: ${(lockErr as Error).message}`);
      }

      setMemoryId(memory.id);
      setIsCreatingMemory(false);
    } catch (err) {
      setError((err as Error).message || 'Failed to create and secure document');
      setIsCreatingMemory(false);
    }
  }, [getToken]);

  useEffect(() => {
    initializeAndLockMemory();
  }, [initializeAndLockMemory]);

  const handleComplete = () => {
    Alert.alert('Success', 'Document saved to Vault', [
      {
        text: 'View Document',
        onPress: () => {
          if (memoryId) {
            router.push(`/vault/${memoryId}`);
          }
        },
      },
      {
        text: 'Scan Another',
        onPress: () => {
          setMemoryId(null);
          setIsCreatingMemory(true);
          initializeAndLockMemory();
        },
      },
      {
        text: 'Done',
        onPress: () => {
          router.back();
        },
      },
    ]);
  };

  const handleCancel = () => {
    router.back();
  };

  if (isCreatingMemory) {
    return (
      <View className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text className="text-gray-600 mt-4">Preparing document...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View className="flex-1 bg-white px-6 py-8 items-center justify-center">
        <View className="items-center mb-8">
          <Text className="text-4xl mb-4">❌</Text>
          <Text className="text-2xl font-bold text-gray-900 mb-2">Error</Text>
          <Text className="text-center text-gray-600 mb-6">
            {error}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => router.back()}
          className="w-full bg-blue-600 rounded-lg py-3 px-4"
        >
          <Text className="text-white text-center font-semibold">Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!memoryId) {
    return (
      <View className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text className="text-gray-600 mt-4">Preparing document...</Text>
      </View>
    );
  }

  return (
    <DocumentScanner
      memoryId={memoryId}
      onComplete={handleComplete}
      onCancel={handleCancel}
    />
  );
}
