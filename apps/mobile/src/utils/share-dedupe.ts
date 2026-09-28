import { v4 as uuidv4 } from 'uuid';

/**
 * LOSSLESS-CAPTURE-01: bounded same-delivery dedupe for incoming shares.
 *
 * The same delivery (Android delivering it twice, the app re-resolving it on resume, a retry after
 * an error) reuses one idempotency key for SHARE_DEDUPE_TTL_MS, so the API returns the Memory it
 * already created instead of a duplicate. After the window (or an app restart: nothing is
 * persisted) the same content can be saved again on purpose. This is not a content uniqueness rule.
 */
export const SHARE_DEDUPE_TTL_MS = 10 * 60 * 1000;

export interface ShareAttempt {
  idempotencyKey: string;
  createdAt: number;
  /** Set once the Memory exists, so a retry never creates it again. */
  memoryId?: string;
  /** Set once the image of the share is attached, so a retry never uploads it twice. */
  imageUploaded?: boolean;
  /** Set once everything in the share was saved; a repeated delivery then only reopens it. */
  completed?: boolean;
}

const attempts = new Map<string, ShareAttempt>();
const inFlight = new Set<string>();

/** Identity of one delivery: what was shared, in order. Never stored beyond this process. */
export function shareFingerprint(payloads: { contentType?: string | null; value?: string | null; contentUri?: string | null }[]): string {
  return JSON.stringify(payloads.map((p) => [p.contentType ?? null, p.value ?? null, p.contentUri ?? null]));
}

function prune(now: number): void {
  for (const [fingerprint, attempt] of attempts) {
    if (now - attempt.createdAt >= SHARE_DEDUPE_TTL_MS) attempts.delete(fingerprint);
  }
}

/** The attempt for this delivery: the existing one within the TTL, otherwise a new key. */
export function getShareAttempt(fingerprint: string, now: number = Date.now()): ShareAttempt {
  prune(now);
  let attempt = attempts.get(fingerprint);
  if (!attempt) {
    attempt = { idempotencyKey: uuidv4(), createdAt: now };
    attempts.set(fingerprint, attempt);
  }
  return attempt;
}

/** In-flight guard: false if the same delivery is already being processed. */
export function beginShare(fingerprint: string): boolean {
  if (inFlight.has(fingerprint)) return false;
  inFlight.add(fingerprint);
  return true;
}

export function endShare(fingerprint: string): void {
  inFlight.delete(fingerprint);
}

/** Test helper. */
export function resetShareDedupe(): void {
  attempts.clear();
  inFlight.clear();
}
