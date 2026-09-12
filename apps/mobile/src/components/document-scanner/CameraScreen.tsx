import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { CapturedPage, enhanceImageReadability, applyPerspectiveCorrection } from '@/src/utils/document-scanner';
import { CropScreen } from './CropScreen';

interface CameraScreenProps {
  pageNumber: number;
  onCapture: (page: CapturedPage) => void;
  onCancel: () => void;
}

// Simple edge detection - detects high-contrast areas that might be document edges
function detectDocumentEdges(
  pixelData: Uint8ClampedArray,
  width: number,
  height: number,
): { topLeft: [number, number]; topRight: [number, number]; bottomLeft: [number, number]; bottomRight: [number, number] } | null {
  // For Phase 1: placeholder implementation that returns approximate document quadrilateral
  // A full implementation would use Hough line detection or contour detection

  const padding = 40;
  return {
    topLeft: [padding, padding],
    topRight: [width - padding, padding],
    bottomLeft: [padding, height - padding],
    bottomRight: [width - padding, height - padding],
  };
}

export function CameraScreen({ pageNumber, onCapture, onCancel }: CameraScreenProps) {
  const [permission, requestPermission] = useCameraPermissions('camera');
  const [capturing, setCapturing] = useState(false);
  const [isStable, setIsStable] = useState(false);
  const [stabilityCount, setStabilityCount] = useState(0);
  const [showCropScreen, setShowCropScreen] = useState(false);
  const [rawImageUri, setRawImageUri] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const cameraRef = useRef<CameraView>(null);
  const stabilityTimerRef = useRef<any>(null);

  useEffect(() => {
    if (!permission?.granted) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  const handleManualCapture = async () => {
    if (capturing || !cameraRef.current) return;

    setCapturing(true);
    try {
      // Use the camera to take a photo
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
        skipProcessing: false,
      });

      if (photo?.uri) {
        // Show crop screen for perspective correction
        setRawImageUri(photo.uri);
        setShowCropScreen(true);
      }
    } catch (err) {
      Alert.alert('Capture Error', 'Failed to capture image');
      console.error('Camera capture error:', err);
    } finally {
      setCapturing(false);
    }
  };

  const handleLibraryPick = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 1,
      });

      if (!result.canceled && result.assets[0]) {
        // Show crop screen for perspective correction
        setRawImageUri(result.assets[0].uri);
        setShowCropScreen(true);
      }
    } catch (err) {
      Alert.alert('Library Error', 'Failed to pick image');
      console.error('Library pick error:', err);
    }
  };

  const handleCropConfirmed = async (quad: {
    topLeft: [number, number];
    topRight: [number, number];
    bottomLeft: [number, number];
    bottomRight: [number, number];
  }) => {
    if (!rawImageUri) return;

    setShowCropScreen(false);
    setIsProcessing(true);

    try {
      // Apply perspective correction (homography warp)
      const warpedUri = await applyPerspectiveCorrection(rawImageUri, quad);

      // Enhance for readability
      const enhancedUri = await enhanceImageReadability(warpedUri);

      const page: CapturedPage = {
        id: `page-${Date.now()}`,
        uri: enhancedUri,
        timestamp: Date.now(),
        processed: true,
      };
      onCapture(page);
    } catch (err) {
      Alert.alert('Processing Error', 'Failed to process image');
      console.error('Image processing error:', err);
    } finally {
      setIsProcessing(false);
      setRawImageUri(null);
    }
  };

  if (isProcessing) {
    return (
      <View className="flex-1 bg-black justify-center items-center">
        <ActivityIndicator size="large" color="#fff" />
        <Text className="text-white mt-4">Processing image...</Text>
      </View>
    );
  }

  if (showCropScreen && rawImageUri) {
    return (
      <CropScreen
        imageUri={rawImageUri}
        onCropConfirmed={handleCropConfirmed}
        onCancel={() => {
          setShowCropScreen(false);
          setRawImageUri(null);
        }}
      />
    );
  }

  if (!permission?.granted) {
    return (
      <View className="flex-1 bg-gray-900 justify-center items-center">
        <Text className="text-white text-lg mb-4">Camera permission required</Text>
        <TouchableOpacity
          onPress={requestPermission}
          className="bg-blue-600 px-6 py-3 rounded-lg"
        >
          <Text className="text-white font-semibold">Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-black">
      <CameraView
        ref={cameraRef}
        style={{ flex: 1 }}
        facing="back"
        ratio="16:9"
        enableTorch={false}
      >
        {/* Edge detection overlay placeholder */}
        <View className="absolute inset-0 justify-center items-center">
          <View
            className="border-2 border-yellow-400 opacity-60"
            style={{
              width: '90%',
              aspectRatio: 8.5 / 11,
            }}
          >
            <Text className="absolute top-2 left-2 text-yellow-400 text-xs bg-black/50 px-2 py-1 rounded">
              Align document with frame
            </Text>
            {isStable && (
              <Text className="absolute top-2 right-2 text-green-400 text-xs bg-black/50 px-2 py-1 rounded">
                ✓ Stable
              </Text>
            )}
          </View>
        </View>

        {/* Controls */}
        <View className="absolute bottom-0 left-0 right-0 bg-black/70 px-6 py-4">
          <View className="gap-3">
            <Text className="text-white text-center mb-2">
              Page {pageNumber} {isStable ? '(Ready)' : ''}
            </Text>

            <TouchableOpacity
              onPress={handleManualCapture}
              disabled={capturing}
              className="bg-white rounded-full py-4 items-center"
            >
              {capturing ? (
                <ActivityIndicator color="black" />
              ) : (
                <Text className="text-black font-bold text-lg">📸 Capture</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleLibraryPick}
              className="bg-gray-700 rounded-lg py-3 items-center"
            >
              <Text className="text-white">Choose from Library</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={onCancel}
              className="bg-red-600 rounded-lg py-3 items-center"
            >
              <Text className="text-white">Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </CameraView>
    </View>
  );
}
