import { requireOptionalNativeModule } from 'expo';

/**
 * Diagnostic-only (FACEBOOK-SHARE-INGESTION-01): logs the shape of the Android share Intent that
 * expo-sharing retained, never its contents. The native module already returns only enums,
 * booleans, bounded counts and length buckets; this layer re-validates that contract with an
 * allowlist and drops anything else, so no raw string can reach the console even if the native
 * side misbehaved. Nothing here throws or affects share handling.
 */
export const SHARE_DIAG_PREFIX = '[share-diag]';

export const MAX_CLIP_ITEMS = 10;
export const MAX_OTHER_EXTRAS = 50;

type LengthBucket = '0' | '1-100' | '101-500' | '>500';

export interface ShareIntentShape {
  action: 'send' | 'send_multiple' | 'other';
  typeCategory: 'text' | 'image' | 'other';
  hasText: boolean;
  hasSubject: boolean;
  hasTitle: boolean;
  hasHtml: boolean;
  hasStream: boolean;
  textLenBucket: LengthBucket;
  textIsSingleUrl: boolean;
  subjectLenBucket: LengthBucket;
  htmlLenBucket: LengthBucket;
  clipItemCount: number;
  clipItems: { hasText: boolean; hasUri: boolean; hasHtml: boolean }[];
  /** True only if EXTRA_TEXT is non-empty and every non-null ClipData text equals it (computed natively). */
  clipTextMatchesExtraText: boolean;
  otherExtraCount: number;
}

export type ShareIntentShapeUnavailableReason =
  | 'module_missing' // APK built without the native module
  | 'no_intent' // native: no retained share Intent
  | 'native_error' // native: inspection failed (no detail crosses the boundary)
  | 'invalid_shape' // native output failed the allowlist contract
  | 'js_error'; // unexpected JS-side failure

const ACTIONS = ['send', 'send_multiple', 'other'] as const;
const TYPE_CATEGORIES = ['text', 'image', 'other'] as const;
const LENGTH_BUCKETS = ['0', '1-100', '101-500', '>500'] as const;

function pickEnum<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T;
  throw new Error('invalid');
}

function pickBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  throw new Error('invalid');
}

function pickCount(value: unknown, max: number): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return Math.min(value, max);
  throw new Error('invalid');
}

/** Rebuilds the summary from allowlisted fields only; returns null if any field is off-contract. */
export function sanitizeShareIntentShape(raw: unknown): ShareIntentShape | null {
  try {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const clipSource = Array.isArray(r.clipItems) ? r.clipItems : null;
    if (!clipSource) return null;
    const clipItems = clipSource.slice(0, MAX_CLIP_ITEMS).map((item) => {
      const c = (item ?? {}) as Record<string, unknown>;
      return { hasText: pickBoolean(c.hasText), hasUri: pickBoolean(c.hasUri), hasHtml: pickBoolean(c.hasHtml) };
    });
    return {
      action: pickEnum(r.action, ACTIONS),
      typeCategory: pickEnum(r.typeCategory, TYPE_CATEGORIES),
      hasText: pickBoolean(r.hasText),
      hasSubject: pickBoolean(r.hasSubject),
      hasTitle: pickBoolean(r.hasTitle),
      hasHtml: pickBoolean(r.hasHtml),
      hasStream: pickBoolean(r.hasStream),
      textLenBucket: pickEnum(r.textLenBucket, LENGTH_BUCKETS),
      textIsSingleUrl: pickBoolean(r.textIsSingleUrl),
      subjectLenBucket: pickEnum(r.subjectLenBucket, LENGTH_BUCKETS),
      htmlLenBucket: pickEnum(r.htmlLenBucket, LENGTH_BUCKETS),
      clipItemCount: pickCount(r.clipItemCount, MAX_CLIP_ITEMS),
      clipItems,
      clipTextMatchesExtraText: pickBoolean(r.clipTextMatchesExtraText),
      otherExtraCount: pickCount(r.otherExtraCount, MAX_OTHER_EXTRAS),
    };
  } catch {
    return null;
  }
}

type NativeShareIntentDiag = { getShareIntentShape(): unknown };

function emit(payload: object) {
  try {
    console.info(SHARE_DIAG_PREFIX, JSON.stringify(payload));
  } catch {
    // Diagnostics must never affect the share flow.
  }
}

function unavailable(reason: ShareIntentShapeUnavailableReason) {
  emit({ event: 'share_intent_shape_unavailable', reason });
}

/**
 * Reads the retained share Intent's shape from the native module and logs one `[share-diag]`
 * line. The module is optional: an APK built before this module existed logs `module_missing`.
 */
export function logShareIntentShape(): void {
  try {
    const native = requireOptionalNativeModule<NativeShareIntentDiag>('ShareIntentDiag');
    if (!native || typeof native.getShareIntentShape !== 'function') {
      unavailable('module_missing');
      return;
    }
    // Native returns a fixed-status envelope: {status:'ok', shape} | {status:'no_intent'} |
    // {status:'native_error'}. Anything else is treated as off-contract.
    const envelope = native.getShareIntentShape() as { status?: unknown; shape?: unknown } | null;
    const status = envelope && typeof envelope === 'object' ? envelope.status : undefined;
    if (status === 'no_intent' || status === 'native_error') {
      unavailable(status);
      return;
    }
    if (status !== 'ok') {
      unavailable('invalid_shape');
      return;
    }
    const shape = sanitizeShareIntentShape(envelope?.shape);
    if (!shape) {
      unavailable('invalid_shape');
      return;
    }
    emit({ event: 'share_intent_shape', ...shape });
  } catch {
    unavailable('js_error');
  }
}
