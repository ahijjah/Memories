import { useSignUp } from "@clerk/expo/legacy";
import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { View, TextInput, TouchableOpacity, Text, ScrollView, Alert } from 'react-native';

export default function SignUp() {
  const { signUp, setActive, isLoaded } = useSignUp();
  const router = useRouter();
  const [emailAddress, setEmailAddress] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const onSignUpPress = async () => {
    if (!isLoaded) return;

    setLoading(true);
    try {
      const completeSignUp = await signUp.create({
        emailAddress,
        password,
      });

      if (completeSignUp.status === 'complete') {
        await setActive({ session: completeSignUp.createdSessionId });
        router.replace('/(tabs)/');
      } else {
        console.error(JSON.stringify(completeSignUp, null, 2));
        Alert.alert('Error', 'Sign up failed. Please try again.');
      }
    } catch (err: any) {
      console.error(JSON.stringify(err, null, 2));
      Alert.alert('Error', err.errors?.[0]?.message || 'Sign up failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-white">
      <View className="flex-1 justify-center px-6 py-12">
        <View className="mb-8">
          <Text className="text-3xl font-bold text-gray-900 mb-2">Create Account</Text>
          <Text className="text-base text-gray-600">Join Memories today</Text>
        </View>

        <View>
          <View className="mb-4">
            <Text className="text-sm font-medium text-gray-700 mb-1">Email</Text>
            <TextInput
              autoCapitalize="none"
              value={emailAddress}
              placeholder="Enter your email"
              onChangeText={setEmailAddress}
              className="border border-gray-300 rounded-lg px-4 py-3 text-base"
              editable={!loading}
              placeholderTextColor="#999"
            />
          </View>

          <View className="mb-4">
            <Text className="text-sm font-medium text-gray-700 mb-1">Password</Text>
            <TextInput
              value={password}
              placeholder="Create a password"
              onChangeText={setPassword}
              secureTextEntry
              className="border border-gray-300 rounded-lg px-4 py-3 text-base"
              editable={!loading}
              placeholderTextColor="#999"
            />
          </View>
        </View>

        <TouchableOpacity
          onPress={onSignUpPress}
          disabled={loading}
          className="mt-8 bg-blue-600 rounded-lg py-3"
        >
          <Text className="text-white text-center font-semibold text-base">
            {loading ? 'Creating Account...' : 'Sign Up'}
          </Text>
        </TouchableOpacity>

        <View className="mt-6 flex-row justify-center">
          <Text className="text-gray-600 mr-2">Already have an account? </Text>
          <Link href="/(auth)/sign-in" asChild>
            <TouchableOpacity>
              <Text className="text-blue-600 font-semibold">Sign In</Text>
            </TouchableOpacity>
          </Link>
        </View>
      </View>
    </ScrollView>
  );
}
