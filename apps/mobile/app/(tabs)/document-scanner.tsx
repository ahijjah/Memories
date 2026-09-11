import { useRouter } from 'expo-router';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useState, useEffect } from 'react';
import { useAuth } from '@clerk/clerk-expo';
import { v4 as uuidv4 } from 'uuid';
import { createMemory } from '@/src/api/client';
import { DocumentScanner } from '@/src/components/document-scanner';

export default function DocumentScannerScreen() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [memoryId, setMemoryId] = useState<string | null>(null);
  const [isCreatingMemory, setIsCreatingMemory] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initializeMemory = async () => {
      try {
        const token = await getToken();
        const timestamp = new Date().toLocaleString();
        const idempotencyKey = uuidv4();
        const memory = await createMemory(
          token,
          'camera',
          idempotencyKey,
          undefined,
          `Document ${timestamp}`
        );
        setMemoryId(memory.id);
        setIsCreatingMemory(false);
      } catch (err) {
        setError((err as Error).message || 'Failed to create memory');
        setIsCreatingMemory(false);
      }
    };

    initializeMemory();
  }, [getToken]);

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
          const initializeMemory = async () => {
            try {
              const token = await getToken();
              const timestamp = new Date().toLocaleString();
              const idempotencyKey = uuidv4();
              const memory = await createMemory(
                token,
                'camera',
                idempotencyKey,
                undefined,
                `Document ${timestamp}`
              );
              setMemoryId(memory.id);
              setIsCreatingMemory(false);
            } catch (err) {
              setError((err as Error).message || 'Failed to create memory');
              setIsCreatingMemory(false);
            }
          };
          initializeMemory();
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
