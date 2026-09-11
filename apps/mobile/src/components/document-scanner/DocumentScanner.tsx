import { useState, useCallback, useEffect } from 'react';
import { View } from 'react-native';
import { useAuth } from '@clerk/clerk-expo';
import { Alert } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { createScanSession, CapturedPage } from '@/src/utils/document-scanner';
import { CameraScreen } from './CameraScreen';
import { ReviewScreen } from './ReviewScreen';
import { uploadPhotoToExistingMemory } from '@/src/utils/photo-upload';

type ScanState = 'camera' | 'review';

interface DocumentScannerProps {
  memoryId: string;
  token?: string;
  onComplete: () => void;
  onCancel: () => void;
}

export function DocumentScanner({
  memoryId,
  token: providedToken,
  onComplete,
  onCancel,
}: DocumentScannerProps) {
  const { getToken } = useAuth();
  const [state, setState] = useState<ScanState>('camera');
  const [pages, setPages] = useState<CapturedPage[]>([]);
  const [saving, setSaving] = useState(false);
  const scanSession = createScanSession();

  const handleCapturePage = useCallback(
    async (page: CapturedPage) => {
      setPages((prev) => [...prev, page]);
      // After capture, ask if they want to add more pages
      Alert.alert(
        'Page Captured',
        'Add another page or proceed to review?',
        [
          { text: 'Add Another', style: 'default', onPress: () => {} },
          {
            text: 'Proceed to Review',
            style: 'default',
            onPress: () => setState('review'),
          },
        ],
      );
    },
    [],
  );

  const handleRemovePage = useCallback((id: string) => {
    setPages((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const handleReorderPages = useCallback((fromIndex: number, toIndex: number) => {
    setPages((prev) => {
      const newPages = [...prev];
      const [removed] = newPages.splice(fromIndex, 1);
      newPages.splice(toIndex, 0, removed);
      return newPages;
    });
  }, []);

  const handleConfirmAndSave = useCallback(async () => {
    if (pages.length === 0) {
      Alert.alert('No Pages', 'Please capture at least one page');
      return;
    }

    setSaving(true);
    try {
      // Upload each page with its pageIndex
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        // Fetch fresh token immediately before each upload to avoid stale token 401 errors
        const freshToken = await getToken();
        if (!freshToken) {
          throw new Error('Authentication token not available');
        }
        await uploadPhotoToExistingMemory(
          freshToken,
          memoryId,
          page.uri,
          page.uri.endsWith('.png') ? 'image/png' : 'image/jpeg',
          i, // pageIndex is 0-based
        );
      }

      Alert.alert('Success', 'Document pages saved successfully');
      onComplete();
    } catch (err) {
      Alert.alert('Save Error', (err as Error).message || 'Failed to save pages');
    } finally {
      setSaving(false);
    }
  }, [pages, memoryId, onComplete, getToken]);

  if (state === 'camera') {
    return (
      <CameraScreen
        pageNumber={pages.length + 1}
        onCapture={handleCapturePage}
        onCancel={onCancel}
      />
    );
  }

  return (
    <ReviewScreen
      pages={pages}
      onAddMorePages={() => setState('camera')}
      onConfirm={handleConfirmAndSave}
      onCancel={onCancel}
      onRemovePage={handleRemovePage}
      onReorderPages={handleReorderPages}
      saving={saving}
    />
  );
}
