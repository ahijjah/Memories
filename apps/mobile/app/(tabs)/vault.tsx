import { useAuth } from "@clerk/clerk-expo";
import { useRouter, useFocusEffect } from 'expo-router';
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listVaultMemories, Memory } from '@/src/api/client';
import { CompactCard } from '@/src/components/memory-cards/CompactCard';
import { checkBiometricEnrollment, authenticateVault, type VaultAuthState } from '@/src/utils/vault-auth';

export default function VaultScreen() {
  const { getToken } = useAuth();
  const router = useRouter();
  const [authState, setAuthState] = useState<VaultAuthState>('locked');
  const [enrollmentChecked, setEnrollmentChecked] = useState(false);

  useFocusEffect(
    useCallback(() => {
      checkVaultAuthentication();
    }, [])
  );

  const checkVaultAuthentication = async () => {
    setAuthState('checking');
    const { hasHardware, isEnrolled } = await checkBiometricEnrollment();

    if (!hasHardware || !isEnrolled) {
      setEnrollmentChecked(true);
      setAuthState('no_enrollment');
      return;
    }

    setEnrollmentChecked(true);
    setAuthState('locked');
  };

  const handleUnlockVault = async () => {
    const success = await authenticateVault();
    if (success) {
      setAuthState('unlocked');
    } else {
      setAuthState('failed');
    }
  };

  const handleRetryAuthentication = () => {
    setAuthState('locked');
  };

  const handleContinueWithoutBiometric = () => {
    setAuthState('unlocked');
  };

  const { data: memories = [], isLoading, error, refetch } = useQuery({
    queryKey: ['vaultMemories'],
    queryFn: async () => {
      const token = await getToken();
      return listVaultMemories(token);
    },
    enabled: authState === 'unlocked',
  });

  const handleMemoryPress = (memoryId: string) => {
    router.push(`/vault/${memoryId}`);
  };

  // Checking enrollment
  if (authState === 'checking' || !enrollmentChecked) {
    return (
      <View className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text className="text-gray-600 mt-4">Preparing vault...</Text>
      </View>
    );
  }

  // Locked state - need authentication
  if (authState === 'locked') {
    return (
      <View className="flex-1 bg-white px-6 py-8 items-center justify-center">
        <View className="items-center mb-8">
          <Text className="text-3xl mb-4">🔒</Text>
          <Text className="text-2xl font-bold text-gray-900 mb-2">Vault Locked</Text>
          <Text className="text-center text-gray-600 mb-6">
            Authenticate to access your private vault
          </Text>
        </View>
        <TouchableOpacity
          onPress={handleUnlockVault}
          className="w-full bg-blue-600 rounded-lg py-3 px-4 mb-3"
        >
          <Text className="text-white text-center font-semibold">Unlock Vault</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // No biometric/passcode enrolled
  if (authState === 'no_enrollment') {
    return (
      <View className="flex-1 bg-white px-6 py-8 items-center justify-center">
        <View className="items-center mb-8">
          <Text className="text-4xl mb-4">⚠️</Text>
          <Text className="text-2xl font-bold text-gray-900 mb-2">No Security Setup</Text>
          <Text className="text-center text-gray-600 mb-6">
            Your device doesn't have a passcode or biometric lock set up. For better security, consider enabling one in your device settings.
          </Text>
        </View>
        <TouchableOpacity
          onPress={handleContinueWithoutBiometric}
          className="w-full bg-blue-600 rounded-lg py-3 px-4"
        >
          <Text className="text-white text-center font-semibold">Continue Anyway</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Authentication failed
  if (authState === 'failed') {
    return (
      <View className="flex-1 bg-white px-6 py-8 items-center justify-center">
        <View className="items-center mb-8">
          <Text className="text-4xl mb-4">❌</Text>
          <Text className="text-2xl font-bold text-gray-900 mb-2">Authentication Failed</Text>
          <Text className="text-center text-gray-600 mb-6">
            Unable to authenticate. Please try again.
          </Text>
        </View>
        <TouchableOpacity
          onPress={handleRetryAuthentication}
          className="w-full bg-blue-600 rounded-lg py-3 px-4"
        >
          <Text className="text-white text-center font-semibold">Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Unlocked - show content
  if (authState === 'unlocked') {
    if (isLoading) {
      return (
        <View className="flex-1 bg-white items-center justify-center">
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text className="text-gray-600 mt-4">Loading vault...</Text>
        </View>
      );
    }

    if (error) {
      return (
        <View className="flex-1 bg-white px-6 py-8">
          <View className="bg-red-50 rounded-lg p-4">
            <Text className="text-red-900 font-semibold mb-2">Error</Text>
            <Text className="text-red-700 text-sm mb-4">
              {error instanceof Error ? error.message : 'Failed to load vault'}
            </Text>
            <TouchableOpacity
              onPress={() => refetch()}
              className="bg-red-600 rounded-lg py-2 px-4"
            >
              <Text className="text-white text-center font-semibold text-sm">Retry</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    return (
      <ScrollView className="flex-1 bg-white">
        <View className="px-6 py-6">
          {memories.length === 0 ? (
            <View className="items-center justify-center py-12">
              <Text className="text-lg font-semibold text-gray-900 mb-2">Vault Empty</Text>
              <Text className="text-gray-600 text-center">
                Move memories here from the Memories tab to keep them private
              </Text>
            </View>
          ) : (
            <View>
              {memories.map((memory: Memory) => (
                <View
                  key={memory.id}
                  className="bg-amber-50 border border-amber-200 rounded-lg mb-3 overflow-hidden"
                >
                  <TouchableOpacity
                    onPress={() => handleMemoryPress(memory.id)}
                  >
                    <CompactCard memory={memory} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    );
  }

  return null;
}
