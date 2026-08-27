import { useAuth, useUser } from "@clerk/clerk-expo";
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity, Modal, Alert, TextInput } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { exportAccountData, deleteAccount } from '@/src/api/client';

export default function AccountScreen() {
  const { user } = useUser();
  const { getToken, signOut } = useAuth();
  const router = useRouter();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState('');

  const { mutate: exportData, isPending: isExporting } = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      const data = await exportAccountData(token);
      const jsonString = JSON.stringify(data, null, 2);
      const fileName = `memories-export-${new Date().toISOString().split('T')[0]}.json`;
      const filePath = `${FileSystem.cacheDirectory}${fileName}`;
      await FileSystem.writeAsStringAsync(filePath, jsonString);
      await Sharing.shareAsync(filePath, { mimeType: 'application/json', UTI: 'public.json' });
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to export data';
      Alert.alert('Error', message);
    },
  });

  const { mutate: removeAccount, isPending: isDeleting } = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      return deleteAccount(token, deleteConfirmEmail);
    },
    onSuccess: async () => {
      Alert.alert('Account Deleted', 'Your account has been permanently deleted.');
      await signOut();
      router.push('/(auth)/sign-in');
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to delete account';
      Alert.alert('Error', message);
    },
  });

  const handleDeleteAccount = () => {
    if (!deleteConfirmEmail.trim()) {
      Alert.alert('Error', 'Please enter your email to confirm deletion');
      return;
    }
    removeAccount();
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      router.push('/(auth)/sign-in');
    } catch (err) {
      Alert.alert('Error', 'Failed to sign out');
    }
  };

  return (
    <>
      <ScrollView className="flex-1 bg-white">
        <View className="px-6 py-6">
          {/* Profile Section */}
          <View className="mb-8">
            <Text className="text-lg font-semibold text-gray-900 mb-4">Profile</Text>

            <View className="bg-gray-50 rounded-lg p-4 mb-4">
              <Text className="text-sm text-gray-600 mb-2">
                <Text className="font-semibold">Email:</Text> {user?.emailAddresses[0]?.emailAddress || 'N/A'}
              </Text>
              {user?.firstName && (
                <Text className="text-sm text-gray-600">
                  <Text className="font-semibold">Name:</Text> {user.firstName} {user.lastName || ''}
                </Text>
              )}
            </View>
          </View>

          {/* Data Management Section */}
          <View className="mb-8">
            <Text className="text-lg font-semibold text-gray-900 mb-4">Data</Text>

            <TouchableOpacity
              onPress={() => exportData()}
              disabled={isExporting}
              className={`rounded-lg py-3 mb-3 ${isExporting ? 'bg-gray-300' : 'bg-blue-600'}`}
            >
              {isExporting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text className="text-white text-center font-semibold">Export My Data</Text>
              )}
            </TouchableOpacity>

            <View className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <Text className="text-xs text-blue-900">
                Download a JSON file containing all your memories, collections, reminders, and account data.
              </Text>
            </View>
          </View>

          {/* Danger Zone */}
          <View className="mb-8">
            <Text className="text-lg font-semibold text-red-900 mb-4">Danger Zone</Text>

            <TouchableOpacity
              onPress={() => setShowDeleteModal(true)}
              className="bg-red-600 rounded-lg py-3 mb-4"
            >
              <Text className="text-white text-center font-semibold">Delete Account</Text>
            </TouchableOpacity>

            <View className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
              <Text className="text-xs text-red-900 font-semibold mb-1">This action is permanent</Text>
              <Text className="text-xs text-red-900">
                Deleting your account will permanently remove all your data and cannot be undone.
              </Text>
            </View>

            <TouchableOpacity
              onPress={handleSignOut}
              className="bg-gray-200 rounded-lg py-3"
            >
              <Text className="text-gray-900 text-center font-semibold">Sign Out</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* Delete Account Confirmation Modal */}
      <Modal visible={showDeleteModal} animationType="slide" transparent={true}>
        <View className="flex-1 bg-black/50 justify-end">
          <View className="bg-white rounded-t-lg px-6 py-6">
            <Text className="text-2xl font-bold text-red-900 mb-2">Delete Account?</Text>
            <Text className="text-gray-600 mb-6">
              This action is permanent and cannot be undone. All your data will be deleted.
            </Text>

            <View className="mb-6">
              <Text className="text-sm font-medium text-gray-700 mb-2">
                Type your email to confirm:
              </Text>
              <TextInput
                value={deleteConfirmEmail}
                placeholder={user?.emailAddresses[0]?.emailAddress || 'your@email.com'}
                onChangeText={setDeleteConfirmEmail}
                editable={!isDeleting}
                keyboardType="email-address"
                autoCapitalize="none"
                className="border border-gray-300 rounded-lg px-4 py-3 text-base"
                placeholderTextColor="#999"
              />
            </View>

            <View className="flex-row gap-3">
              <TouchableOpacity
                onPress={() => {
                  setShowDeleteModal(false);
                  setDeleteConfirmEmail('');
                }}
                disabled={isDeleting}
                className="flex-1 bg-gray-200 rounded-lg py-3"
              >
                <Text className="text-gray-900 text-center font-semibold">Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleDeleteAccount}
                disabled={isDeleting || !deleteConfirmEmail.trim()}
                className={`flex-1 rounded-lg py-3 ${
                  isDeleting || !deleteConfirmEmail.trim() ? 'bg-red-300' : 'bg-red-600'
                }`}
              >
                {isDeleting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text className="text-white text-center font-semibold">Delete My Account</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}
