import { useAuth, useClerk } from '@clerk/clerk-expo';
import { useQuery } from '@tanstack/react-query';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { fetchHealth } from '@/src/api/client';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  header: {
    marginBottom: 32,
  },
  title: {
    fontSize: 30,
    fontWeight: 'bold',
    color: '#111827',
  },
  subtitle: {
    fontSize: 16,
    color: '#4b5563',
    marginTop: 8,
  },
  statusCard: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    padding: 24,
    marginBottom: 24,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 16,
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  loadingText: {
    color: '#4b5563',
    marginTop: 16,
  },
  errorBox: {
    backgroundColor: '#fef2f2',
    borderRadius: 8,
    padding: 16,
  },
  errorTitle: {
    color: '#7f1d1d',
    fontWeight: '600',
    marginBottom: 8,
  },
  errorText: {
    color: '#991b1b',
    fontSize: 14,
  },
  successContainer: {
    gap: 12,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#22c55e',
    marginRight: 12,
  },
  statusText: {
    color: '#111827',
    fontWeight: '500',
  },
  jsonBox: {
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
    padding: 16,
    marginTop: 16,
  },
  jsonText: {
    fontSize: 12,
    color: '#4b5563',
    fontFamily: 'Courier New',
  },
  buttonGroup: {
    gap: 12,
  },
  primaryButton: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    paddingVertical: 12,
  },
  secondaryButton: {
    backgroundColor: '#e5e7eb',
    borderRadius: 8,
    paddingVertical: 12,
  },
  buttonText: {
    textAlign: 'center',
    fontWeight: '600',
  },
  primaryButtonText: {
    color: '#fff',
  },
  secondaryButtonText: {
    color: '#111827',
  },
  footer: {
    marginTop: 32,
    paddingTop: 32,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  footerLabel: {
    fontSize: 12,
    color: '#9ca3af',
    marginBottom: 8,
  },
  footerText: {
    fontSize: 12,
    color: '#4b5563',
    fontFamily: 'Courier New',
    marginBottom: 4,
  },
});

export default function HomeScreen() {
  const { getToken } = useAuth();
  const { signOut } = useClerk();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const token = await getToken();
      return fetchHealth(token);
    },
  });

  const handleSignOut = async () => {
    await signOut();
  };

  const handleRefresh = () => {
    refetch();
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Welcome to Memories</Text>
          <Text style={styles.subtitle}>API Connectivity Check</Text>
        </View>

        <View style={styles.statusCard}>
          <Text style={styles.cardTitle}>Health Check Status</Text>

          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#3b82f6" />
              <Text style={styles.loadingText}>Checking API health...</Text>
            </View>
          ) : error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorTitle}>Error</Text>
              <Text style={styles.errorText}>
                {error instanceof Error ? error.message : 'Failed to check health'}
              </Text>
            </View>
          ) : data ? (
            <View style={styles.successContainer}>
              <View style={styles.statusRow}>
                <View style={styles.statusDot} />
                <Text style={styles.statusText}>API is reachable</Text>
              </View>

              <View style={styles.jsonBox}>
                <Text style={styles.jsonText}>
                  {JSON.stringify(data, null, 2)}
                </Text>
              </View>
            </View>
          ) : null}
        </View>

        <View style={styles.buttonGroup}>
          <TouchableOpacity
            onPress={handleRefresh}
            disabled={isLoading}
            style={styles.primaryButton}
          >
            <Text style={[styles.buttonText, styles.primaryButtonText]}>
              {isLoading ? 'Checking...' : 'Refresh Health Check'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleSignOut}
            style={styles.secondaryButton}
          >
            <Text style={[styles.buttonText, styles.secondaryButtonText]}>Sign Out</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerLabel}>Environment Info:</Text>
          <Text style={styles.footerText}>
            API URL: {process.env.EXPO_PUBLIC_API_URL || 'Not set'}
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}
