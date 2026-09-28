import { useAuth } from "@clerk/clerk-expo";
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useIncomingShare, type ResolvedSharePayload } from 'expo-sharing';
import { saveSharedPayloads, ShareSaveError } from '@/src/utils/save-share';
import { beginShare, endShare, getShareAttempt, shareFingerprint } from '@/src/utils/share-dedupe';

type ProcessingState = 'loading' | 'processing' | 'success' | 'notice' | 'error';

export default function HandleShareScreen() {
  const { getToken } = useAuth();
  const router = useRouter();
  const { resolvedSharedPayloads, isResolving, error, clearSharedPayloads } = useIncomingShare();

  const [state, setState] = useState<ProcessingState>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [notices, setNotices] = useState<string[]>([]);
  const [memoryId, setMemoryId] = useState<string>('');
  // URL shares open Detail with fromShare=1, which offers a source screenshot if the link
  // can't be understood. Text and image shares navigate as before.
  const [isUrlShare, setIsUrlShare] = useState(false);

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
      processShare(resolvedSharedPayloads);
    }
  }, [isResolving, error, resolvedSharedPayloads]);

  const openMemory = (id: string, url: boolean) => {
    clearSharedPayloads();
    router.replace(url ? `/memory/${id}?fromShare=1` : `/memory/${id}`);
  };

  useEffect(() => {
    // Everything was saved: continue automatically. With notices, the user continues by hand.
    if (state === 'success' && memoryId) {
      const timeout = setTimeout(() => openMemory(memoryId, isUrlShare), 500);
      return () => clearTimeout(timeout);
    }
  }, [state, memoryId, isUrlShare]);

  const processShare = async (payloads: ResolvedSharePayload[]) => {
    // One delivery at a time; the same delivery within the dedupe window reuses its key.
    const fingerprint = shareFingerprint(payloads);
    if (!beginShare(fingerprint)) return;
    try {
      setState('processing');
      const token = await getToken();

      if (!token) {
        throw new Error('Authentication required');
      }

      const saved = await saveSharedPayloads(token, payloads, getShareAttempt(fingerprint));
      setIsUrlShare(saved.isUrl);
      setMemoryId(saved.memoryId);
      setNotices(saved.notices);
      setState(saved.notices.length > 0 ? 'notice' : 'success');
    } catch (err: any) {
      setMemoryId(err instanceof ShareSaveError && err.memoryId ? err.memoryId : '');
      setErrorMessage(err?.message || 'Failed to process shared content');
      setState('error');
    } finally {
      endShare(fingerprint);
    }
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

        {state === 'notice' && (
          <View className="items-center gap-4" testID="share-notice">
            <View className="w-12 h-12 rounded-full bg-amber-100 justify-center items-center">
              <Text className="text-2xl">!</Text>
            </View>
            <Text className="text-lg font-semibold text-gray-900">Saved, with exceptions</Text>
            {notices.map((notice) => (
              <Text key={notice} className="text-center text-amber-800">{notice}</Text>
            ))}
            <TouchableOpacity
              testID="share-open-memory"
              onPress={() => openMemory(memoryId, isUrlShare)}
              className="bg-blue-600 rounded-lg py-3 px-6 mt-2"
            >
              <Text className="text-white font-semibold">Open memory</Text>
            </TouchableOpacity>
          </View>
        )}

        {state === 'error' && (
          <View className="items-center gap-4">
            <View className="w-12 h-12 rounded-full bg-red-100 justify-center items-center">
              <Text className="text-2xl">⚠</Text>
            </View>
            <Text className="text-lg font-semibold text-gray-900">Error</Text>
            <Text className="text-center text-red-600">{errorMessage}</Text>
            {memoryId ? (
              <TouchableOpacity
                testID="share-open-memory"
                onPress={() => openMemory(memoryId, isUrlShare)}
                className="bg-blue-600 rounded-lg py-3 px-6 mt-2"
              >
                <Text className="text-white font-semibold">Open saved memory</Text>
              </TouchableOpacity>
            ) : (
              <Text className="text-sm text-gray-500 text-center mt-4">
                Please try again or use the Capture screen to manually save this content.
              </Text>
            )}
          </View>
        )}
      </View>
    </ScrollView>
  );
}
