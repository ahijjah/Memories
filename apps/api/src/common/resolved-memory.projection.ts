import {
  CANONICAL_MEMORY_TYPES,
  CanonicalMemoryType,
  ResolvedFieldView,
  ResolvedMemoryField,
  ResolvedMemoryView,
} from '@memory-app/domain';
import {
  compareLatestFirst,
  ConfirmationInput,
  FieldShape,
  InferenceInput,
  isPresentValue,
  resolveMemoryField,
} from './resolve-memory-field.util';

/**
 * Public Resolved Memory projection (see docs/adr/ADR-003-public-resolved-memory-contract.md).
 *
 * Builds the `resolved` object for Memory-shaped responses from rows the endpoint has already
 * authorized, selected and decrypted. Pure: no queries, no authorization, no decryption, no
 * logging, no input mutation.
 */

/** Full catalog for Memory Detail and Vault Detail. */
export const DETAIL_RESOLVED_FIELDS: readonly ResolvedMemoryField[] = [
  'title',
  'type',
  'summary',
  'topics',
  'intent',
  'entities',
  'location',
  'date',
  'dateYearInferred',
  'eventTime',
  'brand',
  'model',
  'price',
  'category',
  'merchant',
  'originalPrice',
  'offerPrice',
  'discount',
  'promoCode',
  'author',
  'publishedDate',
  'issueDate',
  'issuer',
  'owner',
  'documentNumber',
  'phone',
  'serviceArea',
];

/** Preview set for the Memories list. Must never contain a sensitive field. */
export const LIST_RESOLVED_FIELDS: readonly ResolvedMemoryField[] = [
  'title',
  'type',
  'date',
  'location',
  'price',
  'category',
];

/** Inference fields the Memories list has always returned in its raw `aiInferences`. */
export const LIST_RAW_INFERENCE_FIELDS: readonly string[] = ['date', 'location', 'price', 'category'];

/** Inference fields the Memories list loads: its raw fields plus helper rows for the preview. */
export const LIST_QUERY_INFERENCE_FIELDS: readonly string[] = [...LIST_RAW_INFERENCE_FIELDS, 'title', 'type'];

/** Confirmation fields the Memories list loads to resolve the preview (never serialized). */
export const LIST_QUERY_CONFIRMATION_FIELDS: readonly string[] = LIST_RESOLVED_FIELDS;

const FIELD_SHAPES: Record<Exclude<ResolvedMemoryField, 'type'>, FieldShape> = {
  title: 'string',
  summary: 'string',
  topics: 'array',
  intent: 'string',
  entities: 'array',
  location: 'string',
  date: 'string',
  dateYearInferred: 'boolean',
  eventTime: 'string',
  brand: 'string',
  model: 'string',
  price: 'string',
  category: 'string',
  merchant: 'string',
  originalPrice: 'string',
  offerPrice: 'string',
  discount: 'string',
  promoCode: 'string',
  author: 'string',
  publishedDate: 'string',
  issueDate: 'string',
  issuer: 'string',
  owner: 'string',
  documentNumber: 'string',
  phone: 'string',
  serviceArea: 'string',
};

const LEGACY_MEMORY_TYPES: Record<string, CanonicalMemoryType> = {
  event: 'EVENT',
  place: 'PLACE',
  product: 'PRODUCT',
  article: 'ARTICLE_LEARNING',
  tutorial: 'ARTICLE_LEARNING',
  video: 'VIDEO_SOCIAL',
  post: 'VIDEO_SOCIAL',
  document: 'DOCUMENT',
  image: 'GENERIC',
  note: 'GENERIC',
  other: 'GENERIC',
};

/**
 * Maps a stored or confirmed type to the canonical taxonomy (case-insensitive), or null when it
 * has no canonical form.
 */
export function normalizeMemoryType(value: unknown): CanonicalMemoryType | null {
  if (typeof value !== 'string') return null;
  const key = value.trim();
  if (!key) return null;
  const upper = key.toUpperCase();
  const canonical = CANONICAL_MEMORY_TYPES.find((type) => type === upper);
  return canonical ?? LEGACY_MEMORY_TYPES[key.toLowerCase()] ?? null;
}

/** Shape check plus element types for arrays (every current array field is a list of strings). */
function isValidFieldValue(value: unknown, shape: FieldShape): boolean {
  if (!isPresentValue(value, shape)) return false;
  if (shape === 'array') return (value as unknown[]).every((item) => typeof item === 'string');
  return true;
}

export interface ResolvableMemory {
  title?: string | null;
  memoryType?: string | null;
  aiInferences?: ReadonlyArray<InferenceInput> | null;
  userConfirmations?: ReadonlyArray<ConfirmationInput> | null;
}

function resolveOrdinaryField(
  memory: ResolvableMemory,
  field: Exclude<ResolvedMemoryField, 'type'>,
): ResolvedFieldView<unknown> | undefined {
  const shape = FIELD_SHAPES[field];
  // Only valid rows are candidates, so a malformed newer value falls back to the latest valid one.
  const resolved = resolveMemoryField(field, {
    aiInferences: (memory.aiInferences ?? []).filter(
      (row) => row.field === field && isValidFieldValue(row.valueJson, shape),
    ),
    userConfirmations: (memory.userConfirmations ?? []).filter(
      (row) => row.field === field && isValidFieldValue(row.confirmedValue, shape),
    ),
    rawFallback: field === 'title' ? memory.title : undefined,
    shape,
  });

  switch (resolved.source) {
    case 'user':
    case 'original':
      return { value: resolved.value, source: resolved.source, confidence: null };
    case 'ai':
      return { value: resolved.value, source: 'ai', confidence: resolved.confidence ?? null };
    default:
      return undefined;
  }
}

/**
 * Type authority: a valid user confirmation, else the persisted Memory.memoryType (AI-written),
 * else unresolved. Type inference history never supplies the value; the newest type inference
 * only supplies confidence, and only when it normalizes to the resolved value.
 */
function resolveType(memory: ResolvableMemory): ResolvedFieldView<CanonicalMemoryType> | undefined {
  const confirmed = [...(memory.userConfirmations ?? [])]
    .filter((row) => row.field === 'type')
    .sort(compareLatestFirst)
    .map((row) => normalizeMemoryType(row.confirmedValue))
    .find((value): value is CanonicalMemoryType => value !== null);
  if (confirmed) {
    return { value: confirmed, source: 'user', confidence: null };
  }

  const stored = normalizeMemoryType(memory.memoryType);
  if (!stored) return undefined;

  const newestTypeInference = [...(memory.aiInferences ?? [])]
    .filter((row) => row.field === 'type')
    .sort(compareLatestFirst)[0];
  const confidence =
    newestTypeInference && normalizeMemoryType(newestTypeInference.valueJson) === stored
      ? newestTypeInference.confidence ?? null
      : null;

  return { value: stored, source: 'ai', confidence };
}

/** Builds the public `resolved` object for the requested fields, omitting unresolved ones. */
export function buildResolvedMemory(
  memory: ResolvableMemory,
  fields: readonly ResolvedMemoryField[],
): ResolvedMemoryView {
  const resolved: Record<string, ResolvedFieldView<unknown>> = {};
  for (const field of fields) {
    const view = field === 'type' ? resolveType(memory) : resolveOrdinaryField(memory, field);
    if (view) resolved[field] = view;
  }
  return resolved as ResolvedMemoryView;
}
