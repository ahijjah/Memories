import * as LocalAuthentication from 'expo-local-authentication';

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
