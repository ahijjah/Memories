import { useAuth } from "@clerk/clerk-expo";
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { useIncomingShare, type ResolvedSharePayload } from 'expo-sharing';
import { v4 as uuidv4 } from 'uuid';
import { createMemory } from '@/src/api/client';
import { uploadPhotoToMemory } from '@/src/utils/photo-upload';

type ProcessingState = 'loading' | 'processing' | 'success' | 'error';

export default function HandleShareScreen() {
  const { getToken } = useAuth();
  const router = useRouter();
  const { resolvedSharedPayloads, isResolving, error, clearSharedPayloads } = useIncomingShare();

  const [state, setState] = useState<ProcessingState>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [memoryId, setMemoryId] = useState<string>('');

  useEffect(() => {
    if (isResolving) {
      setState('loading');
      return;
    }

    if (error) {
      setErrorMessage(error.message || 'Failed to receive shared content');
      setState('error');
      return;
    }

    if (resolvedSharedPayloads && resolvedSharedPayloads.length > 0) {
      processShare(resolvedSharedPayloads[0]);
    }
  }, [isResolving, error, resolvedSharedPayloads]);

  useEffect(() => {
    if (state === 'success' && memoryId) {
      const timeout = setTimeout(() => {
        clearSharedPayloads();
        router.replace(`/memory/${memoryId}`);
      }, 500);
      return () => clearTimeout(timeout);
    }
  }, [state, memoryId]);

  const processShare = async (payload: ResolvedSharePayload) => {
    try {
      setState('processing');
      const token = await getToken();

      if (!token) {
        throw new Error('Authentication required');
      }

      if (payload.contentType === 'text' || payload.contentType === 'website') {
        await handleTextOrUrl(token, payload);
      } else if (payload.contentType === 'image') {
        await handleImage(token, payload);
      } else {
        setErrorMessage(`${payload.contentType} sharing is not supported yet`);
        setState('error');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to process shared content');
      setState('error');
    }
  };

  const handleTextOrUrl = async (token: string, payload: ResolvedSharePayload) => {
    const text = (payload as any).value || (payload as any).text || '';

    const isUrl =
      text.startsWith('http://') ||
      text.startsWith('https://') ||
      text.startsWith('www.');

    const idempotencyKey = uuidv4();
    const memory = await createMemory(
      token,
      isUrl ? 'url' : 'text',
      idempotencyKey,
      isUrl ? text : undefined,
      isUrl ? text : text.substring(0, 100),
    );

    setMemoryId(memory.id);
    setState('success');
  };

  const handleImage = async (token: string, payload: ResolvedSharePayload) => {
    if (!payload.contentUri) {
      throw new Error('Image content missing');
    }

    const mimeType = payload.contentMimeType || 'image/jpeg';
    const fileName = payload.originalName || 'shared-image.jpg';

    const id = await uploadPhotoToMemory(token, payload.contentUri, mimeType, fileName);
    setMemoryId(id);
    setState('success');
  };

  return (
    <ScrollView className="flex-1 bg-white">
      <View className="flex-1 justify-center items-center px-6 py-8 min-h-screen">
        {state === 'loading' && (
          <View className="items-center gap-4">
            <ActivityIndicator size="large" color="#2563eb" />
            <Text className="text-gray-600">Receiving shared content...</Text>
          </View>
        )}

        {state === 'processing' && (
          <View className="items-center gap-4">
            <ActivityIndicator size="large" color="#2563eb" />
            <Text className="text-gray-600">Saving to memories...</Text>
          </View>
        )}

        {state === 'success' && (
          <View className="items-center gap-4">
            <View className="w-12 h-12 rounded-full bg-green-100 justify-center items-center">
              <Text className="text-3xl">✓</Text>
            </View>
            <Text className="text-lg font-semibold text-gray-900">Saved!</Text>
            <Text className="text-gray-600">Navigating to your memory...</Text>
          </View>
        )}

        {state === 'error' && (
          <View className="items-center gap-4">
            <View className="w-12 h-12 rounded-full bg-red-100 justify-center items-center">
              <Text className="text-2xl">⚠</Text>
            </View>
            <Text className="text-lg font-semibold text-gray-900">Error</Text>
            <Text className="text-center text-red-600">{errorMessage}</Text>
            <Text className="text-sm text-gray-500 text-center mt-4">
              Please try again or use the Capture screen to manually save this content.
            </Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}
