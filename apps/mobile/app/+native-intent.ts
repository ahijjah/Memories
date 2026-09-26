import { hasExpoSharingMarker, logShareDiag, type NativeIntentOutcome } from '@/src/diagnostics/share-diag';

// Diagnostic only: logs the branch taken as an enum, never the path. Cannot throw.
function logNativeIntent(outcome: NativeIntentOutcome, path: string, initial: boolean) {
  logShareDiag({
    event: 'native_intent',
    initial: initial === true,
    outcome,
    expoSharingMarker: hasExpoSharingMarker(path),
  });
}

export async function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  try {
    if (new URL(path).hostname === 'expo-sharing') {
      logNativeIntent('expo_sharing', path, initial);
      return '/handle-share';
    }
    logNativeIntent('passthrough', path, initial);
    return path;
  } catch {
    logNativeIntent('parse_error', path, initial);
    return '/';
  }
}
