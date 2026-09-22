import React, { useEffect } from 'react';
import { Image, ActivityIndicator, View, Text, StyleProp, ImageStyle } from 'react-native';
import { useAuthenticatedAssetDownload } from '../hooks/useAuthenticatedAssetDownload';

interface AuthenticatedAssetImageProps {
  assetId: string;
  contentUrl: string;
  style?: StyleProp<ImageStyle>;
  onError?: (error: Error) => void;
}

export function AuthenticatedAssetImage({
  assetId,
  contentUrl,
  style,
  onError,
}: AuthenticatedAssetImageProps) {
  const { localUri, state, error } = useAuthenticatedAssetDownload(assetId, contentUrl);

  // Notify parent of errors via useEffect, not during render
  useEffect(() => {
    if (state === 'error' && error && onError) {
      onError(error);
    }
  }, [state, error, onError]);

  // Render state machine
  if (state === 'idle' || state === 'loading') {
    return (
      <View style={style}>
        <ActivityIndicator />
      </View>
    );
  }

  if (state === 'error' || !localUri) {
    return (
      <View
        style={[
          style,
          { justifyContent: 'center', alignItems: 'center', backgroundColor: '#f0f0f0' },
        ]}
      >
        <Text style={{ color: '#666', fontSize: 12 }}>Failed to load image</Text>
      </View>
    );
  }

  // state === 'loaded' && localUri exists
  return (
    <Image
      source={{ uri: localUri }}
      style={style}
    />
  );
}
