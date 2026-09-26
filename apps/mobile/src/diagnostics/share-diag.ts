/**
 * Privacy-safe diagnostics for the incoming-share path (FACEBOOK-SHARE-INGESTION-01).
 *
 * Every event is a closed shape of enums, booleans and small counts, so no share text, URL,
 * content URI, path, token, identifier or error message can be logged. Logging never throws and
 * returns nothing, so calling it cannot change control flow, timing or navigation.
 */
export const SHARE_DIAG_PREFIX = '[share-diag]';

export type NativeIntentOutcome = 'expo_sharing' | 'passthrough' | 'parse_error';

export type ShareDiagEvent =
  | {
      event: 'native_intent';
      initial: boolean;
      outcome: NativeIntentOutcome;
      // Whether the path contains the fixed `expo-sharing` marker the native module emits. Tells a
      // share URI that failed hostname matching (passthrough) apart from an unrelated link.
      expoSharingMarker: boolean;
    }
  | { event: 'root_auth_state'; clerkLoaded: boolean; signedIn: boolean }
  | { event: 'handle_share_mount' }
  | {
      event: 'share_hook_state';
      isResolving: boolean;
      hasError: boolean;
      sharedCount: number;
      resolvedCount: number;
    };

const MAX_COUNT = 99;

function boundedCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(MAX_COUNT, Math.trunc(value))) : 0;
}

export function logShareDiag(diag: ShareDiagEvent): void {
  try {
    const payload =
      diag.event === 'share_hook_state'
        ? { ...diag, sharedCount: boundedCount(diag.sharedCount), resolvedCount: boundedCount(diag.resolvedCount) }
        : diag;
    console.info(SHARE_DIAG_PREFIX, JSON.stringify(payload));
  } catch {
    // Diagnostics must never affect the share flow.
  }
}

export function hasExpoSharingMarker(path: unknown): boolean {
  try {
    return typeof path === 'string' && path.includes('expo-sharing');
  } catch {
    return false;
  }
}
