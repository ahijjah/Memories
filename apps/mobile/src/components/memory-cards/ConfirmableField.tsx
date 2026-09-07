import { View, Text, TouchableOpacity, TextInput, Modal, ActivityIndicator } from 'react-native';
import { useState } from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';
import { confirmField } from '@/src/api/client';
import { useAuth } from '@clerk/clerk-expo';

interface ConfirmableFieldProps {
  label: string;
  value: any;
  confidence?: number | null;
  fieldType: 'date' | 'text';
  memoryId: string;
  field: string;
  isConfirmed: boolean;
  onConfirmed: () => void;
}

const formatDate = (dateStr: string | null): string | null => {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return null;
  }
};

export function ConfirmableField({
  label,
  value,
  confidence,
  fieldType,
  memoryId,
  field,
  isConfirmed,
  onConfirmed,
}: ConfirmableFieldProps) {
  const { getToken } = useAuth();
  const [showConfirmPrompt, setShowConfirmPrompt] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const shouldShowConfirm =
    confidence !== undefined &&
    confidence !== null &&
    confidence < 0.7 &&
    !isConfirmed;

  const displayValue =
    fieldType === 'date' ? formatDate(value) || value : value;

  const handleConfirmWithoutChanges = async () => {
    try {
      setIsSubmitting(true);
      const token = await getToken();
      if (!token) throw new Error('No auth token');
      await confirmField(token, memoryId, field, value);
      setShowConfirmPrompt(false);
      onConfirmed();
    } catch (err) {
      console.error('Failed to confirm field:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmWithChanges = async () => {
    try {
      setIsSubmitting(true);
      const token = await getToken();
      if (!token) throw new Error('No auth token');
      await confirmField(token, memoryId, field, editValue);
      setShowConfirmPrompt(false);
      setIsEditing(false);
      onConfirmed();
    } catch (err) {
      console.error('Failed to confirm field:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!value) return null;

  return (
    <>
      <View className="flex-row items-center justify-between gap-3 mb-2">
        <View className="flex-1">
          <Text className="text-xs text-gray-600 mb-1">{label}</Text>
          <Text className="text-base text-gray-900">{displayValue}</Text>
        </View>

        {shouldShowConfirm && (
          <TouchableOpacity
            onPress={() => setShowConfirmPrompt(true)}
            className="bg-blue-50 rounded-lg px-2 py-1"
          >
            <Text className="text-xs text-blue-600 font-semibold">Confirm</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Confirm Prompt Modal */}
      <Modal
        visible={showConfirmPrompt}
        animationType="fade"
        transparent={true}
        onRequestClose={() => !isSubmitting && setShowConfirmPrompt(false)}
      >
        <View className="flex-1 bg-black/50 justify-center px-4">
          <View className="bg-white rounded-lg p-4">
            <Text className="text-base font-semibold text-gray-900 mb-4">
              {isEditing ? `Edit ${label}` : `Confirm ${label}`}
            </Text>

            {isEditing ? (
              <>
                {fieldType === 'date' ? (
                  <View className="mb-4">
                    <TouchableOpacity
                      onPress={() => setShowDatePicker(true)}
                      className="border border-gray-300 rounded-lg px-4 py-3 mb-4"
                    >
                      <Text className="text-base text-gray-900">
                        {editValue ? formatDate(editValue) || editValue : 'Select date'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TextInput
                    value={editValue}
                    onChangeText={setEditValue}
                    placeholder={label}
                    className="border border-gray-300 rounded-lg px-4 py-3 text-base mb-4"
                    placeholderTextColor="#999"
                    editable={!isSubmitting}
                  />
                )}
              </>
            ) : (
              <Text className="text-base text-gray-700 mb-4">
                Is "{displayValue}" correct?
              </Text>
            )}

            <View className="flex-row gap-3">
              {!isEditing && (
                <TouchableOpacity
                  onPress={() => setIsEditing(true)}
                  disabled={isSubmitting}
                  className="flex-1 bg-gray-200 rounded-lg py-2"
                >
                  <Text className="text-gray-900 text-center font-semibold text-sm">
                    Edit
                  </Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                onPress={() => {
                  setShowConfirmPrompt(false);
                  setIsEditing(false);
                  setEditValue(value);
                }}
                disabled={isSubmitting}
                className="flex-1 bg-gray-200 rounded-lg py-2"
              >
                <Text className="text-gray-900 text-center font-semibold text-sm">
                  Cancel
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={
                  isEditing
                    ? handleConfirmWithChanges
                    : handleConfirmWithoutChanges
                }
                disabled={isSubmitting}
                className="flex-1 bg-blue-600 rounded-lg py-2"
              >
                {isSubmitting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text className="text-white text-center font-semibold text-sm">
                    {isEditing ? 'Save' : 'Yes'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Date Picker Modal */}
      {showDatePicker && (
        <DateTimePicker
          value={editValue ? new Date(editValue) : new Date()}
          mode="date"
          display="default"
          onChange={(event, selectedDate) => {
            if (selectedDate) {
              setEditValue(selectedDate.toISOString());
            }
            setShowDatePicker(false);
          }}
        />
      )}
    </>
  );
}
