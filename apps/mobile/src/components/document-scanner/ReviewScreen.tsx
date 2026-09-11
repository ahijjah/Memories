import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Image, Alert, ActivityIndicator } from 'react-native';
import { CapturedPage } from '@/src/utils/document-scanner';

interface ReviewScreenProps {
  pages: CapturedPage[];
  onAddMorePages: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  onRemovePage: (id: string) => void;
  onReorderPages: (fromIndex: number, toIndex: number) => void;
  saving?: boolean;
}

export function ReviewScreen({
  pages,
  onAddMorePages,
  onConfirm,
  onCancel,
  onRemovePage,
  onReorderPages,
  saving,
}: ReviewScreenProps) {
  const [selectedPageId, setSelectedPageId] = useState<string | null>(
    pages.length > 0 ? pages[0].id : null,
  );
  const [fullViewPageId, setFullViewPageId] = useState<string | null>(null);

  const selectedPage = pages.find((p) => p.id === selectedPageId);
  const fullViewPage = pages.find((p) => p.id === fullViewPageId);

  if (fullViewPage) {
    return (
      <View className="flex-1 bg-black">
        <Image
          source={{ uri: fullViewPage.uri }}
          style={{ flex: 1 }}
          resizeMode="contain"
        />
        <View className="bg-black/70 px-4 py-4 gap-3 flex-row justify-center">
          <TouchableOpacity
            onPress={() => setFullViewPageId(null)}
            className="bg-gray-700 rounded-lg px-6 py-3 flex-1"
          >
            <Text className="text-white text-center font-semibold">Back</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              onRemovePage(fullViewPage.id);
              setFullViewPageId(null);
            }}
            className="bg-red-600 rounded-lg px-6 py-3 flex-1"
          >
            <Text className="text-white text-center font-semibold">Delete</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white">
      {/* Header */}
      <View className="bg-gray-50 px-6 py-4 border-b border-gray-200">
        <Text className="text-2xl font-bold text-gray-900 mb-1">
          Review Pages
        </Text>
        <Text className="text-gray-600">
          {pages.length} {pages.length === 1 ? 'page' : 'pages'} captured
        </Text>
      </View>

      <ScrollView className="flex-1 px-6 py-4">
        {/* Thumbnail strip */}
        <View className="mb-6">
          <Text className="text-lg font-semibold text-gray-900 mb-3">
            Pages
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="gap-2"
          >
            {pages.map((page, index) => (
              <View key={page.id} className="relative">
                <TouchableOpacity
                  onPress={() => setSelectedPageId(page.id)}
                  className={`rounded-lg overflow-hidden border-2 ${
                    selectedPageId === page.id
                      ? 'border-blue-600'
                      : 'border-gray-200'
                  }`}
                  style={{ width: 100, height: 140 }}
                >
                  <Image
                    source={{ uri: page.uri }}
                    style={{ flex: 1 }}
                    resizeMode="cover"
                  />
                </TouchableOpacity>
                <Text className="absolute bottom-1 right-1 bg-blue-600 text-white text-xs font-semibold px-2 py-1 rounded">
                  {index + 1}
                </Text>
              </View>
            ))}
          </ScrollView>
        </View>

        {/* Selected page preview */}
        {selectedPage && (
          <View className="mb-6">
            <Text className="text-lg font-semibold text-gray-900 mb-3">
              Preview
            </Text>
            <TouchableOpacity
              onPress={() => setFullViewPageId(selectedPage.id)}
              className="bg-gray-100 rounded-lg overflow-hidden"
              style={{ height: 300 }}
            >
              <Image
                source={{ uri: selectedPage.uri }}
                style={{ flex: 1 }}
                resizeMode="contain"
              />
            </TouchableOpacity>

            {/* Page controls */}
            <View className="mt-4 gap-2 flex-row">
              <TouchableOpacity
                onPress={() => {
                  const index = pages.findIndex((p) => p.id === selectedPage.id);
                  if (index > 0) {
                    onReorderPages(index, index - 1);
                  }
                }}
                disabled={pages.findIndex((p) => p.id === selectedPage.id) === 0}
                className="flex-1 bg-gray-200 rounded-lg py-2"
              >
                <Text className="text-center font-semibold">↑ Move Up</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  const index = pages.findIndex((p) => p.id === selectedPage.id);
                  if (index < pages.length - 1) {
                    onReorderPages(index, index + 1);
                  }
                }}
                disabled={
                  pages.findIndex((p) => p.id === selectedPage.id) ===
                  pages.length - 1
                }
                className="flex-1 bg-gray-200 rounded-lg py-2"
              >
                <Text className="text-center font-semibold">↓ Move Down</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  Alert.alert(
                    'Delete Page',
                    'Are you sure you want to delete this page?',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Delete',
                        onPress: () => {
                          onRemovePage(selectedPage.id);
                          setSelectedPageId(pages[0]?.id || null);
                        },
                        style: 'destructive',
                      },
                    ],
                  );
                }}
                className="flex-1 bg-red-100 rounded-lg py-2"
              >
                <Text className="text-center font-semibold text-red-600">
                  🗑 Delete
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Action buttons */}
      <View className="bg-gray-50 border-t border-gray-200 px-6 py-4 gap-3">
        <TouchableOpacity
          onPress={onAddMorePages}
          className="bg-blue-600 rounded-lg py-4"
        >
          <Text className="text-white text-center font-semibold">
            + Add More Pages
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={onConfirm}
          disabled={saving || pages.length === 0}
          className={`rounded-lg py-4 ${
            saving || pages.length === 0 ? 'bg-gray-300' : 'bg-green-600'
          }`}
        >
          {saving ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text className="text-white text-center font-semibold">
              ✓ Confirm & Save
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={onCancel}
          className="bg-gray-300 rounded-lg py-4"
        >
          <Text className="text-gray-700 text-center font-semibold">Cancel</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
