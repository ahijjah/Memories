import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, PanResponder, Dimensions, Image as RNImage, GestureResponderEvent } from 'react-native';
import { Canvas, Image as SkiaImage, Skia, Paint, Circle } from '@shopify/react-native-skia';

const CORNER_RADIUS = 16;
const PADDING_RATIO = 0.08;

interface Corner {
  id: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
  x: number;
  y: number;
}

interface CropScreenProps {
  imageUri: string;
  onCropConfirmed: (quad: {
    topLeft: [number, number];
    topRight: [number, number];
    bottomLeft: [number, number];
    bottomRight: [number, number];
  }) => void;
  onCancel: () => void;
}

export function CropScreen({ imageUri, onCropConfirmed, onCancel }: CropScreenProps) {
  const [skiaImage, setSkiaImage] = useState<any>(null);
  const [corners, setCorners] = useState<{ [key in Corner['id']]: Corner }>({
    topLeft: { id: 'topLeft', x: 0, y: 0 },
    topRight: { id: 'topRight', x: 0, y: 0 },
    bottomLeft: { id: 'bottomLeft', x: 0, y: 0 },
    bottomRight: { id: 'bottomRight', x: 0, y: 0 },
  });
  const [imageDims, setImageDims] = useState({ width: 0, height: 0 });
  const [activeCorner, setActiveCorner] = useState<Corner['id'] | null>(null);
  const canvasRef = useRef(null);
  const screenDims = Dimensions.get('window');

  // Load image and initialize corners
  const loadImage = async () => {
    try {
      const imageSize = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        RNImage.getSize(
          imageUri,
          (imgWidth, imgHeight) => resolve({ width: imgWidth, height: imgHeight }),
          reject,
        );
      });

      const scale = Math.min(
        screenDims.width / imageSize.width,
        (screenDims.height * 0.85) / imageSize.height,
      );
      const displayWidth = imageSize.width * scale;
      const displayHeight = imageSize.height * scale;
      const offsetX = (screenDims.width - displayWidth) / 2;
      const offsetY = screenDims.height * 0.1;

      setImageDims({ width: displayWidth, height: displayHeight });

      // Initialize corners with padding inset
      const padding = Math.min(displayWidth, displayHeight) * PADDING_RATIO;
      setCorners({
        topLeft: { id: 'topLeft', x: offsetX + padding, y: offsetY + padding },
        topRight: { id: 'topRight', x: offsetX + displayWidth - padding, y: offsetY + padding },
        bottomLeft: { id: 'bottomLeft', x: offsetX + padding, y: offsetY + displayHeight - padding },
        bottomRight: { id: 'bottomRight', x: offsetX + displayWidth - padding, y: offsetY + displayHeight - padding },
      });

      // Load with Skia
      const imageData = await Skia.Data.fromURI(imageUri);
      const img = Skia.Image.MakeImageFromEncoded(imageData);
      if (img) {
        setSkiaImage(img);
      } else {
        console.error('Failed to decode image with Skia');
      }
    } catch (err) {
      console.error('Failed to load image:', err);
    }
  };

  React.useEffect(() => {
    loadImage();
  }, [imageUri]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => activeCorner !== null,
      onMoveShouldSetPanResponder: () => activeCorner !== null,
      onPanResponderMove: (evt: GestureResponderEvent) => {
        if (activeCorner) {
          const { pageX: x, pageY: y } = evt.nativeEvent;
          setCorners((prev) => ({
            ...prev,
            [activeCorner]: { id: activeCorner, x, y },
          }));
        }
      },
      onPanResponderRelease: () => {
        setActiveCorner(null);
      },
    }),
  ).current;

  const handleCornerPress = (cornerId: Corner['id']) => {
    setActiveCorner(cornerId);
  };

  const handleConfirmCrop = () => {
    const { topLeft, topRight, bottomLeft, bottomRight } = corners;
    onCropConfirmed({
      topLeft: [topLeft.x, topLeft.y],
      topRight: [topRight.x, topRight.y],
      bottomLeft: [bottomLeft.x, bottomLeft.y],
      bottomRight: [bottomRight.x, bottomRight.y],
    });
  };

  const strokePaint = Skia.Paint();
  strokePaint.setStrokeWidth(3);
  strokePaint.setColor(Skia.Color('rgba(100, 200, 255, 1)'));

  const cornerPaint = Skia.Paint();
  cornerPaint.setColor(Skia.Color('rgba(100, 200, 255, 0.8)'));

  return (
    <View className="flex-1 bg-black">
      <View className="flex-1" {...panResponder.panHandlers}>
        {skiaImage && imageDims.width > 0 && (
          <Canvas style={{ flex: 1 }}>
            {/* Draw image */}
            <SkiaImage
              image={skiaImage}
              x={(screenDims.width - imageDims.width) / 2}
              y={screenDims.height * 0.1}
              width={imageDims.width}
              height={imageDims.height}
            />

            {/* Draw quad outline and corner handles */}
            {(() => {
              const { topLeft, topRight, bottomLeft, bottomRight } = corners;

              // Draw quad outline
              const path = Skia.Path.Make();
              path.moveTo(topLeft.x, topLeft.y);
              path.lineTo(topRight.x, topRight.y);
              path.lineTo(bottomRight.x, bottomRight.y);
              path.lineTo(bottomLeft.x, bottomLeft.y);
              path.close();

              return (
                <>
                  {/* This would need DrawPath component or similar - using placeholder */}
                  {/* Draw corner handles as circles */}
                  <Circle
                    cx={topLeft.x}
                    cy={topLeft.y}
                    r={CORNER_RADIUS}
                    color="rgba(100, 200, 255, 0.8)"
                  />
                  <Circle
                    cx={topRight.x}
                    cy={topRight.y}
                    r={CORNER_RADIUS}
                    color="rgba(100, 200, 255, 0.8)"
                  />
                  <Circle
                    cx={bottomLeft.x}
                    cy={bottomLeft.y}
                    r={CORNER_RADIUS}
                    color="rgba(100, 200, 255, 0.8)"
                  />
                  <Circle
                    cx={bottomRight.x}
                    cy={bottomRight.y}
                    r={CORNER_RADIUS}
                    color="rgba(100, 200, 255, 0.8)"
                  />
                </>
              );
            })()}
          </Canvas>
        )}
      </View>

      <View className="absolute bottom-0 left-0 right-0 bg-black/80 px-6 py-4 flex-row gap-3">
        <TouchableOpacity onPress={onCancel} className="flex-1 bg-gray-600 rounded-lg py-3">
          <Text className="text-white text-center font-semibold">Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleConfirmCrop} className="flex-1 bg-blue-600 rounded-lg py-3">
          <Text className="text-white text-center font-semibold">Confirm Crop</Text>
        </TouchableOpacity>
      </View>

      {/* Draggable corner overlays for touch detection */}
      {Object.values(corners).map((corner) => (
        <TouchableOpacity
          key={corner.id}
          onPress={() => handleCornerPress(corner.id)}
          style={{
            position: 'absolute',
            left: corner.x - CORNER_RADIUS,
            top: corner.y - CORNER_RADIUS,
            width: CORNER_RADIUS * 2,
            height: CORNER_RADIUS * 2,
          }}
          className="rounded-full"
        />
      ))}
    </View>
  );
}
