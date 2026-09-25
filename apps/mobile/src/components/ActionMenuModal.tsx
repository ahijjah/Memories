import { useRef } from 'react';
import { Modal, Platform, Pressable, ScrollView, Text, TouchableOpacity, View } from 'react-native';

export interface ActionMenuItem {
  key: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}

interface ActionMenuModalProps {
  visible: boolean;
  title?: string;
  items: ActionMenuItem[];
  onClose: () => void;
}

export function ActionMenuModal({ visible, title = 'More actions', items, onClose }: ActionMenuModalProps) {
  const pendingAction = useRef<(() => void) | null>(null);

  const runPendingAction = () => {
    const action = pendingAction.current;
    pendingAction.current = null;
    action?.();
  };

  const handleSelect = (item: ActionMenuItem) => {
    pendingAction.current = item.onPress;
    onClose();
    // iOS cannot present a share sheet or alert while a modal is still dismissing,
    // so defer to onDismiss there.
    if (Platform.OS !== 'ios') runPendingAction();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
      onDismiss={runPendingAction}
    >
      <View className="flex-1 bg-black/50 justify-end">
        <Pressable
          className="flex-1"
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close menu"
        />
        <View className="bg-white rounded-t-lg max-h-[70%]">
          <View className="border-b border-gray-200 px-6 py-4">
            <Text className="text-lg font-semibold text-gray-900">{title}</Text>
          </View>

          <ScrollView className="px-6 py-2">
            {items.map((item) => (
              <TouchableOpacity
                key={item.key}
                onPress={() => handleSelect(item)}
                disabled={item.disabled}
                accessibilityRole="button"
                accessibilityState={{ disabled: !!item.disabled }}
                className="py-4 border-b border-gray-100"
              >
                <Text className={`text-base ${item.disabled ? 'text-gray-400' : 'text-gray-900'}`}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View className="border-t border-gray-200 px-6 py-4">
            <TouchableOpacity
              onPress={onClose}
              accessibilityRole="button"
              className="bg-gray-200 rounded-lg py-3"
            >
              <Text className="text-gray-900 text-center font-semibold">Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
