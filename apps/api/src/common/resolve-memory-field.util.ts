import { AIInference, Prisma, UserConfirmation } from '@prisma/client';

/**
 * Resolved Memory field primitive (see docs/adr/ADR-002-resolved-memory-field-resolution.md).
 *
 * Precedence for a single field:
 *   user confirmation → latest valid AI inference → explicit raw fallback → none
 *
 * Pure: no queries, no authorization, no decryption, no logging, no input mutation.
 * Callers pass rows they have already authorized, selected and (for sensitive fields) decrypted.
 */

/** Deterministic newest-first order for AI inference relations and queries. */
export const LATEST_AI_INFERENCE_ORDER: Prisma.AIInferenceOrderByWithRelationInput[] = [
  { createdAt: 'desc' },
  { id: 'desc' },
];

export type ResolvedFieldSource = 'user' | 'ai' | 'original' | 'none';

/** Expected value shape of a field. A present value of another shape is treated as absent. */
export type FieldShape = 'string' | 'array' | 'object' | 'number' | 'boolean' | 'any';

export type InferenceInput = Pick<AIInference, 'field'> & { valueJson: unknown } & Partial<
    Pick<AIInference, 'id' | 'createdAt' | 'confidence' | 'provenance' | 'modelVersion'>
  >;

export type ConfirmationInput = Pick<UserConfirmation, 'field'> & { confirmedValue: unknown } & Partial<
    Pick<UserConfirmation, 'createdAt'>
  >;

export interface ResolvedField<T = unknown> {
  value: T | null;
  source: ResolvedFieldSource;
  confidence?: number;
  provenance?: string | null;
  modelVersion?: string;
  inferredAt?: Date;
  confirmedAt?: Date;
}

export interface ResolveFieldOptions {
  aiInferences?: ReadonlyArray<InferenceInput> | null;
  userConfirmations?: ReadonlyArray<ConfirmationInput> | null;
  /** Original/raw value to use when neither a confirmation nor an AI inference is present. */
  rawFallback?: unknown;
  shape?: FieldShape;
}

/**
 * Whether a value counts as present for the expected shape.
 * null/undefined, blank strings and empty arrays are absent; 0 and false are present.
 */
export function isPresentValue(value: unknown, shape: FieldShape = 'any'): boolean {
  if (value === null || value === undefined) return false;

  if (typeof value === 'string') {
    return (shape === 'string' || shape === 'any') && value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return (shape === 'array' || shape === 'any') && value.length > 0;
  }
  if (typeof value === 'number') {
    return (shape === 'number' || shape === 'any') && Number.isFinite(value);
  }
  if (typeof value === 'boolean') {
    return shape === 'boolean' || shape === 'any';
  }
  if (typeof value === 'object') {
    return shape === 'object' || shape === 'any';
  }
  return false;
}

function timeOf(value: Date | string | null | undefined): number {
  if (value === null || value === undefined) return Number.NEGATIVE_INFINITY;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

/** Comparator: createdAt DESC, then id DESC. Rows missing both keep their input order. */
export function compareLatestFirst(
  a: { createdAt?: Date | string | null; id?: string | null },
  b: { createdAt?: Date | string | null; id?: string | null },
): number {
  const timeDiff = timeOf(b.createdAt) - timeOf(a.createdAt);
  if (timeDiff !== 0 && !Number.isNaN(timeDiff)) return timeDiff > 0 ? 1 : -1;
  const aId = a.id ?? '';
  const bId = b.id ?? '';
  if (aId === bId) return 0;
  return aId < bId ? 1 : -1;
}

function toDate(value: Date | string | null | undefined): Date | undefined {
  if (value === null || value === undefined) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function resolveMemoryField<T = unknown>(
  field: string,
  options: ResolveFieldOptions,
): ResolvedField<T> {
  const shape = options.shape ?? 'any';

  const confirmation = [...(options.userConfirmations ?? [])]
    .filter((c) => c.field === field)
    .sort(compareLatestFirst)
    .find((c) => isPresentValue(c.confirmedValue, shape));
  if (confirmation) {
    return {
      value: confirmation.confirmedValue as T,
      source: 'user',
      confirmedAt: toDate(confirmation.createdAt),
    };
  }

  const inference = [...(options.aiInferences ?? [])]
    .filter((i) => i.field === field)
    .sort(compareLatestFirst)
    .find((i) => isPresentValue(i.valueJson, shape));
  if (inference) {
    return {
      value: inference.valueJson as T,
      source: 'ai',
      confidence: inference.confidence,
      provenance: inference.provenance,
      modelVersion: inference.modelVersion,
      inferredAt: toDate(inference.createdAt),
    };
  }

  if (isPresentValue(options.rawFallback, shape)) {
    return { value: options.rawFallback as T, source: 'original' };
  }

  return { value: null, source: 'none' };
}
