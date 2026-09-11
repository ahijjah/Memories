import * as FileSystem from 'expo-file-system/legacy';
import { Image } from 'react-native';

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

// Apply contrast/brightness normalization for readability
export async function enhanceImageReadability(imageUri: string): Promise<string> {
  // For Phase 1, this is a placeholder
  // Full enhancement would use canvas to adjust contrast/brightness
  // This ensures human readability without OCR preprocessing

  return imageUri;
}
