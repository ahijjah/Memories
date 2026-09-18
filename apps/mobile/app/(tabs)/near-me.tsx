import { useAuth } from "@clerk/clerk-expo";
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from 'react-native';
import * as Location from 'expo-location';
import { getNearMe, NearMeResult } from '@/src/api/client';
import { CompactCard } from '@/src/components/memory-cards/CompactCard';
import { useState, useEffect } from 'react';

export default function NearMeScreen() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationPermission, setLocationPermission] = useState<boolean | null>(null);
  const [radiusKm, setRadiusKm] = useState(5);

  useEffect(() => {
    requestLocationPermission();
  }, []);

  const requestLocationPermission = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      setLocationPermission(status === 'granted');

      if (status === 'granted') {
        const currentLocation = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        setLocation({
          latitude: currentLocation.coords.latitude,
          longitude: currentLocation.coords.longitude,
        });
      }
    } catch (err) {
      setLocationPermission(false);
    }
  };

  const { data: nearbyMemories = [], isLoading, error, refetch } = useQuery({
    queryKey: ['nearMe', location, radiusKm],
    queryFn: async () => {
      if (!location) return [];
      const token = await getToken();
      return getNearMe(token, location.latitude, location.longitude, radiusKm);
    },
    enabled: location !== null,
  });

  const handleMemoryPress = (id: string) => {
    router.push(`/memory/${id}`);
  };

  const formatDistance = (km: number): string => {
    if (km < 1) {
      return `${Math.round(km * 1000)}m`;
    }
    return `${km.toFixed(1)}km`;
  };

  if (locationPermission === false) {
    return (
      <View className="flex-1 bg-white items-center justify-center px-6">
        <Text className="text-xl font-bold text-gray-900 mb-4 text-center">Location Access Required</Text>
        <Text className="text-gray-600 mb-6 text-center">
          Enable location permission to browse memories near you
        </Text>
        <TouchableOpacity
          onPress={requestLocationPermission}
          className="bg-blue-600 rounded-lg py-3 px-6 w-full"
        >
          <Text className="text-white text-center font-semibold">Enable Location</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!location) {
    return (
      <View className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text className="text-gray-600 mt-4">Getting your location...</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white">
      <ScrollView className="flex-1">
        <View className="px-6 py-8">
          <View className="mb-8">
            <Text className="text-3xl font-bold text-gray-900 mb-2">Near Me</Text>
            <Text className="text-sm text-gray-600">
              Memories within {radiusKm}km of your location
            </Text>
          </View>

          {/* Radius Selector */}
          <View className="mb-6">
            <View className="flex-row gap-2 justify-between">
              {[1, 5, 10, 25].map((r) => (
                <TouchableOpacity
                  key={r}
                  onPress={() => setRadiusKm(r)}
                  className={`flex-1 rounded-lg py-2 ${
                    radiusKm === r ? 'bg-blue-600' : 'bg-gray-200'
                  }`}
                >
                  <Text
                    className={`text-center font-semibold text-sm ${
                      radiusKm === r ? 'text-white' : 'text-gray-900'
                    }`}
                  >
                    {r}km
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {isLoading ? (
            <View className="items-center justify-center py-12">
              <ActivityIndicator size="large" color="#3b82f6" />
              <Text className="text-gray-600 mt-4">Loading nearby memories...</Text>
            </View>
          ) : error ? (
            <View className="bg-red-50 rounded-lg p-4 mb-6">
              <Text className="text-red-900 font-semibold mb-2">Error</Text>
              <Text className="text-red-700 text-sm mb-4">
                {error instanceof Error ? error.message : 'Failed to load nearby memories'}
              </Text>
              <TouchableOpacity
                onPress={() => refetch()}
                className="bg-red-600 rounded-lg py-2 px-4"
              >
                <Text className="text-white text-center font-semibold text-sm">Retry</Text>
              </TouchableOpacity>
            </View>
          ) : nearbyMemories.length === 0 ? (
            <View className="items-center justify-center py-12">
              <Text className="text-lg font-semibold text-gray-900 mb-2">No Memories Nearby</Text>
              <Text className="text-gray-600 text-center">
                Capture memories with location to see them here
              </Text>
            </View>
          ) : (
            <View>
              {nearbyMemories.map((memory: NearMeResult) => (
                <TouchableOpacity
                  key={memory.id}
                  onPress={() => handleMemoryPress(memory.id)}
                  className="mb-3"
                >
                  <View className="bg-gray-50 rounded-lg p-4">
                    <View className="flex-row justify-between items-start mb-2">
                      <Text className="text-base font-semibold text-gray-900 flex-1">
                        {memory.title || 'Untitled'}
                      </Text>
                      <Text className="text-sm font-medium text-blue-600 ml-2">
                        {formatDistance(memory.distance)}
                      </Text>
                    </View>
                    {memory.summary && (
                      <Text className="text-sm text-gray-600 mb-2" numberOfLines={2}>
                        {memory.summary}
                      </Text>
                    )}
                    {memory.sourceUri && (
                      <Text className="text-xs text-gray-500 mt-1" numberOfLines={1}>
                        {memory.sourceUri}
                      </Text>
                    )}
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
