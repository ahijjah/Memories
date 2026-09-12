import * as LocalAuthentication from 'expo-local-authentication';
import * as ScreenCapture from 'expo-screen-capture';
import { AppState, type AppStateStatus, Platform } from 'react-native';
import { useEffect, useRef } from 'react';

export type VaultAuthState = 'locked' | 'unauthenticated' | 'checking' | 'unlocked' | 'failed' | 'no_enrollment';

export async function checkBiometricEnrollment(): Promise<{
  hasHardware: boolean;
  isEnrolled: boolean;
}> {
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (!hasHardware) {
      return { hasHardware: false, isEnrolled: false };
    }
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    return { hasHardware: true, isEnrolled };
  } catch (err) {
    console.error('Error checking biometric enrollment:', err);
    return { hasHardware: false, isEnrolled: false };
  }
}

export async function authenticateVault(): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      disableDeviceFallback: false,
      promptMessage: 'Unlock your Vault',
    });
    return result.success;
  } catch (err) {
    console.error('Authentication error:', err);
    return false;
  }
}

export function useVaultAutoLock(
  authState: VaultAuthState,
  setAuthState: (state: VaultAuthState) => void,
): void {
  const backgroundTimeRef = useRef<number | null>(null);
  const subscriptionRef = useRef<any>(null);

  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        backgroundTimeRef.current = Date.now();
      } else if (nextAppState === 'active') {
        if (backgroundTimeRef.current !== null && authState === 'unlocked') {
          const backgroundDuration = Date.now() - backgroundTimeRef.current;
          const GRACE_PERIOD_MS = 30 * 1000; // 30 seconds

          if (backgroundDuration > GRACE_PERIOD_MS) {
            setAuthState('locked');
          }
        }
        backgroundTimeRef.current = null;
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    subscriptionRef.current = subscription;

    return () => {
      subscriptionRef.current?.remove();
    };
  }, [authState, setAuthState]);
}

export function useVaultScreenProtection(isUnlocked: boolean): void {
  useEffect(() => {
    // Android-only screen capture protection; no-op on iOS
    if (Platform.OS !== 'android') {
      return;
    }

    if (!isUnlocked) {
      return;
    }

    let isMounted = true;

    const protectScreen = async () => {
      try {
        await ScreenCapture.preventScreenCaptureAsync();
      } catch (err) {
        console.warn('Failed to prevent screen capture:', err);
      }
    };

    protectScreen();

    return () => {
      isMounted = false;
      ScreenCapture.allowScreenCaptureAsync().catch((err: any) =>
        console.warn('Failed to allow screen capture:', err),
      );
    };
  }, [isUnlocked]);
}
