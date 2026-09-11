import * as FileSystem from 'expo-file-system/legacy';
import { Skia, ImageFormat, ColorType, AlphaType } from '@shopify/react-native-skia';

export interface CapturedPage {
  id: string;
  uri: string;
  croppedUri?: string;
  timestamp: number;
  processed: boolean;
}

export interface ScanSession {
  pages: CapturedPage[];
  addPage: (uri: string) => Promise<CapturedPage>;
  removePage: (id: string) => void;
  reorderPages: (fromIndex: number, toIndex: number) => void;
  clear: () => void;
}

let sessionPages: CapturedPage[] = [];

export function createScanSession(): ScanSession {
  sessionPages = [];

  return {
    pages: sessionPages,

    async addPage(uri: string): Promise<CapturedPage> {
      const page: CapturedPage = {
        id: `page-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        uri,
        timestamp: Date.now(),
        processed: false,
      };
      sessionPages.push(page);
      return page;
    },

    removePage(id: string) {
      const index = sessionPages.findIndex((p) => p.id === id);
      if (index >= 0) {
        sessionPages.splice(index, 1);
      }
    },

    reorderPages(fromIndex: number, toIndex: number) {
      if (fromIndex < 0 || fromIndex >= sessionPages.length) return;
      if (toIndex < 0 || toIndex >= sessionPages.length) return;

      const [movedPage] = sessionPages.splice(fromIndex, 1);
      sessionPages.splice(toIndex, 0, movedPage);
    },

    clear() {
      sessionPages = [];
    },
  };
}

// Simple perspective correction using basic scaling
export async function applyPerspectiveCorrection(
  imageUri: string,
  quad: { topLeft: [number, number]; topRight: [number, number]; bottomLeft: [number, number]; bottomRight: [number, number] },
): Promise<string> {
  // For Phase 1, we'll do basic cropping based on detected quadrilateral
  // Full perspective transform would require canvas manipulation or native module
  // This is a placeholder that returns the original URI
  // In a real implementation, this would use canvas to warp the quad to rectangle

  return imageUri;
}

// Apply contrast/brightness normalization for readability using Skia
// Uses fixed values: contrast +15%, brightness +10 (out of 255)
// Applies per-pixel linear transform: newValue = (oldValue - 128) * contrastFactor + 128 + brightnessOffset
export async function enhanceImageReadability(imageUri: string): Promise<string> {
  const CONTRAST_FACTOR = 1.15;
  const BRIGHTNESS_OFFSET = 10;

  try {
    // Read original image file as base64
    const base64Data = await FileSystem.readAsStringAsync(imageUri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    // Load image using Skia
    const imageData = Skia.Data.fromBase64(base64Data);
    const originalImage = Skia.Image.MakeImageFromEncoded(imageData);

    if (!originalImage) {
      throw new Error('Failed to decode image with Skia');
    }

    const width = originalImage.width();
    const height = originalImage.height();

    // Compute color matrix for contrast/brightness transformation
    // newValue = (oldValue - 128) * contrast + 128 + brightness
    // Expands to: newValue = oldValue * contrast + (128 * (1 - contrast) + brightness)
    // Offset is in 0-255 byte space; Skia.ColorFilter.MakeMatrix expects normalized 0.0-1.0, so divide by 255
    const offset = (128 * (1 - CONTRAST_FACTOR) + BRIGHTNESS_OFFSET) / 255;

    // Color matrix in Skia format: [R_mult, R_add, G_mult, G_add, B_mult, B_add, A_mult, A_add]
    // Actually Skia uses 5x4 matrix: [a b c d e, f g h i j, k l m n o, p q r s t]
    // Each row: [multiply coefficients | add coefficient]
    // CRITICAL: Each channel row must read from its own channel (diagonal), not all from R
    const colorMatrix = [
      CONTRAST_FACTOR, 0, 0, 0, offset,
      0, CONTRAST_FACTOR, 0, 0, offset,
      0, 0, CONTRAST_FACTOR, 0, offset,
      0, 0, 0, 1, 0,
    ];

    // Create paint with color filter
    const paint = Skia.Paint();
    paint.setColorFilter(Skia.ColorFilter.MakeMatrix(colorMatrix));

    // Create offscreen surface for rendering
    const surface = Skia.Surface.Make(width, height);
    if (!surface) {
      throw new Error('Failed to create Skia surface');
    }

    const canvas = surface.getCanvas();

    // Draw original image with color filter applied
    canvas.drawImage(originalImage, 0, 0, paint);

    // Capture enhanced image
    const enhancedImage = surface.makeImageSnapshot();
    if (!enhancedImage) {
      throw new Error('Failed to create image snapshot');
    }

    // Encode enhanced image to JPEG base64
    const base64Enhanced = enhancedImage.encodeToBase64(ImageFormat.JPEG, 80);

    // Save enhanced image to cache
    const enhancedPath = `${FileSystem.cacheDirectory}enhanced_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}.jpg`;

    await FileSystem.writeAsStringAsync(enhancedPath, base64Enhanced, {
      encoding: FileSystem.EncodingType.Base64,
    });

    // Measure actual luminance before and after
    // Explicit ImageInfo to ensure 8-bit RGBA format (0-255 byte values)
    const imageInfo = {
      width,
      height,
      colorType: ColorType.RGBA_8888,
      alphaType: AlphaType.Unpremul,
    };
    const originalPixels = originalImage.readPixels(0, 0, imageInfo);
    const enhancedPixels = enhancedImage.readPixels(0, 0, imageInfo);

    let originalLuminance = 0;
    let enhancedLuminance = 0;
    let sampleCount = 0;

    if (originalPixels && enhancedPixels) {
      const pixelLength = originalPixels.length;
      for (let i = 0; i < pixelLength; i += 4) {
        const origR = originalPixels[i];
        const origG = originalPixels[i + 1];
        const origB = originalPixels[i + 2];

        const enhR = enhancedPixels[i];
        const enhG = enhancedPixels[i + 1];
        const enhB = enhancedPixels[i + 2];

        originalLuminance += 0.299 * origR + 0.587 * origG + 0.114 * origB;
        enhancedLuminance += 0.299 * enhR + 0.587 * enhG + 0.114 * enhB;
        sampleCount++;
      }

      if (sampleCount > 0) {
        originalLuminance = originalLuminance / sampleCount;
        enhancedLuminance = enhancedLuminance / sampleCount;
      }
    }

    // Get file stats
    const originalStats = await FileSystem.getInfoAsync(imageUri);
    const enhancedStats = await FileSystem.getInfoAsync(enhancedPath);

    const metrics = {
      enhancement: {
        contrastFactor: CONTRAST_FACTOR,
        brightnessOffset: BRIGHTNESS_OFFSET,
        transformFormula: 'newValue = (oldValue - 128) * contrastFactor + 128 + brightnessOffset',
        appliedPerRgbChannel: true,
      },
      imageDimensions: {
        width,
        height,
        totalPixels: width * height,
      },
      fileMetrics: {
        originalSize: originalStats.exists && 'size' in originalStats ? originalStats.size : 'unknown',
        enhancedSize: enhancedStats.exists && 'size' in enhancedStats ? enhancedStats.size : 'unknown',
      },
      measuredLuminance: {
        originalAverage: originalLuminance.toFixed(2),
        enhancedAverage: enhancedLuminance.toFixed(2),
        increase: (enhancedLuminance - originalLuminance).toFixed(2),
        percentageIncrease:
          originalLuminance > 0
            ? ((enhancedLuminance - originalLuminance) / originalLuminance * 100).toFixed(1)
            : 'N/A',
      },
      files: {
        original: imageUri,
        enhanced: enhancedPath,
      },
    };

    console.log('[Document Enhancement] Skia real transformation applied', metrics);

    return enhancedPath;
  } catch (err) {
    console.error('Failed to enhance image readability:', err);
    return imageUri;
  }
}
