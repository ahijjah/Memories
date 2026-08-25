import { useAuth } from "@clerk/clerk-expo";
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View, TextInput, TouchableOpacity, Text, ScrollView, Alert, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { v4 as uuidv4 } from 'uuid';
import { createMemory, createUpload, completeUpload } from '@/src/api/client';

type CaptureMode = 'text' | 'url' | 'photo';

export default function CaptureScreen() {
  const { getToken } = useAuth();
  const router = useRouter();

  const [mode, setMode] = useState<CaptureMode>('text');
  const [input, setInput] = useState('');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleTextCapture = async () => {
    if (!input.trim()) {
      setError('Please enter some text');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const token = await getToken();
      const idempotencyKey = uuidv4();

      const memory = await createMemory(
        token,
        'text',
        idempotencyKey,
        undefined,
        title || input.substring(0, 100),
      );

      router.push(`/memory/${memory.id}`);
    } catch (err: any) {
      setError(err.message || 'Failed to capture text');
    } finally {
      setLoading(false);
    }
  };

  const handleUrlCapture = async () => {
    if (!input.trim()) {
      setError('Please enter a URL');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const token = await getToken();
      const idempotencyKey = uuidv4();

      const memory = await createMemory(
        token,
        'url',
        idempotencyKey,
        input.trim(),
        title || input.trim(),
      );

      router.push(`/memory/${memory.id}`);
    } catch (err: any) {
      setError(err.message || 'Failed to capture URL');
    } finally {
      setLoading(false);
    }
  };

  const handlePhotoCapture = async () => {
    setError('');
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 1,
      });

      if (!result.canceled && result.assets[0]) {
        await uploadPhoto(result.assets[0]);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to pick image');
    }
  };

  const handleCameraCapture = async () => {
    setError('');
    try {
      const { granted } = await ImagePicker.requestCameraPermissionsAsync();
      if (!granted) {
        setError('Camera permission required');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 1,
      });

      if (!result.canceled && result.assets[0]) {
        await uploadPhoto(result.assets[0]);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to capture image');
    }
  };

  const uploadPhoto = async (asset: ImagePicker.ImagePickerAsset) => {
    setLoading(true);
    setError('');
    try {
      const token = await getToken();
      const idempotencyKey = uuidv4();

      // 1. Create memory record
      const memory = await createMemory(
        token,
        'camera',
        idempotencyKey,
        undefined,
        title || `Photo ${new Date().toLocaleString()}`,
      );

      // 2. Get upload target
      const mimeType = asset.mimeType || 'image/jpeg';
      const uploadTarget = await createUpload(token, memory.id, mimeType);

      // 3. Read binary image data from file URI and upload directly to presigned URL
      if (!asset.uri) {
        throw new Error('Failed to get image data');
      }

      const fileResponse = await fetch(asset.uri);
      const blob = await fileResponse.blob();

      const uploadResponse = await fetch(uploadTarget.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': mimeType,
        },
        body: blob,
      });

      if (!uploadResponse.ok) {
        throw new Error(`Upload failed with status ${uploadResponse.status}`);
      }

      // 4. Compute MD5 checksum from file and complete upload
      const fileInfo = await FileSystem.getInfoAsync(asset.uri, { md5: true });
      const checksum = fileInfo.exists ? fileInfo.md5 : undefined;

      await completeUpload(
        token,
        memory.id,
        uploadTarget.objectKey,
        uploadTarget.mimeType,
        checksum,
      );

      router.push(`/memory/${memory.id}`);
    } catch (err: any) {
      setError(err.message || 'Failed to upload photo');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-white">
      <View className="flex-1 px-6 py-8">
        {/* Mode Selector */}
        <View className="mb-8">
          <Text className="text-2xl font-bold text-gray-900 mb-4">Capture a Memory</Text>
          <View className="gap-3">
            <TouchableOpacity
              onPress={() => { setMode('text'); setError(''); }}
              className={`rounded-lg py-3 px-4 ${mode === 'text' ? 'bg-blue-600' : 'bg-gray-200'}`}
            >
              <Text className={`text-center font-semibold ${mode === 'text' ? 'text-white' : 'text-gray-900'}`}>
                Text
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => { setMode('url'); setError(''); }}
              className={`rounded-lg py-3 px-4 ${mode === 'url' ? 'bg-blue-600' : 'bg-gray-200'}`}
            >
              <Text className={`text-center font-semibold ${mode === 'url' ? 'text-white' : 'text-gray-900'}`}>
                URL
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => { setMode('photo'); setError(''); }}
              className={`rounded-lg py-3 px-4 ${mode === 'photo' ? 'bg-blue-600' : 'bg-gray-200'}`}
            >
              <Text className={`text-center font-semibold ${mode === 'photo' ? 'text-white' : 'text-gray-900'}`}>
                Photo
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Error Message */}
        {error ? (
          <View className="bg-red-50 rounded-lg p-4 mb-6">
            <Text className="text-red-900 font-semibold mb-1">Error</Text>
            <Text className="text-red-700 text-sm">{error}</Text>
          </View>
        ) : null}

        {/* Text/URL Input */}
        {mode !== 'photo' ? (
          <View className="mb-6">
            <View className="mb-4">
              <Text className="text-sm font-medium text-gray-700 mb-1">Title (optional)</Text>
              <TextInput
                value={title}
                placeholder="Give this memory a title"
                onChangeText={setTitle}
                className="border border-gray-300 rounded-lg px-4 py-3 text-base"
                editable={!loading}
                placeholderTextColor="#999"
              />
            </View>

            <View className="mb-4">
              <Text className="text-sm font-medium text-gray-700 mb-1">
                {mode === 'text' ? 'Text Content' : 'URL'}
              </Text>
              <TextInput
                value={input}
                placeholder={mode === 'text' ? 'Enter text to remember...' : 'https://example.com'}
                onChangeText={setInput}
                multiline={mode === 'text'}
                numberOfLines={mode === 'text' ? 5 : 1}
                className="border border-gray-300 rounded-lg px-4 py-3 text-base"
                editable={!loading}
                placeholderTextColor="#999"
              />
            </View>

            <TouchableOpacity
              onPress={mode === 'text' ? handleTextCapture : handleUrlCapture}
              disabled={loading}
              className="bg-blue-600 rounded-lg py-3"
            >
              {loading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text className="text-white text-center font-semibold">
                  {mode === 'text' ? 'Save Text' : 'Save URL'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Photo Options */}
        {mode === 'photo' ? (
          <View className="gap-3">
            <TouchableOpacity
              onPress={handleCameraCapture}
              disabled={loading}
              className="bg-blue-600 rounded-lg py-3"
            >
              {loading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text className="text-white text-center font-semibold">Take Photo</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handlePhotoCapture}
              disabled={loading}
              className="bg-gray-200 rounded-lg py-3"
            >
              <Text className="text-gray-900 text-center font-semibold">Choose from Library</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}
