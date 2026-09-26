/**
 * Mobile mirror of the public Resolved Memory contract (packages/domain/src/resolved-memory.ts,
 * ADR-003). Kept local so the app bundle has no dependency on the domain package; a drift test
 * (__tests__/resolved-contract-drift.test.ts) compares it with the source.
 *
 * `resolved` is returned by GET /memories/:id, GET /vault/:id and (as a preview) GET /memories.
 * When a Memory has `resolved`, it is authoritative: a missing field key means unresolved.
 */

export type ResolvedSource = 'user' | 'ai' | 'original';

export interface ResolvedFieldView<T> {
  value: T;
  source: ResolvedSource;
  /** Stored AI per-field confidence for AI-sourced values, otherwise null. Not a calibrated probability. */
  confidence: number | null;
}

export const CANONICAL_MEMORY_TYPES = [
  'GENERIC',
  'EVENT',
  'PLACE',
  'PRODUCT',
  'ARTICLE_LEARNING',
  'VIDEO_SOCIAL',
  'OFFER',
  'DOCUMENT',
] as const;

export type CanonicalMemoryType = (typeof CANONICAL_MEMORY_TYPES)[number];

export interface ResolvedMemoryFieldValues {
  title: string;
  type: CanonicalMemoryType;
  summary: string;
  topics: string[];
  intent: string;
  entities: string[];
  location: string;
  date: string;
  dateYearInferred: boolean;
  eventTime: string;
  brand: string;
  model: string;
  price: string;
  category: string;
  merchant: string;
  originalPrice: string;
  offerPrice: string;
  discount: string;
  promoCode: string;
  author: string;
  publishedDate: string;
  issueDate: string;
  issuer: string;
  owner: string;
  documentNumber: string;
  phone: string;
  serviceArea: string;
}

export type ResolvedMemoryField = keyof ResolvedMemoryFieldValues;

export type ResolvedMemoryView = {
  [K in ResolvedMemoryField]?: ResolvedFieldView<ResolvedMemoryFieldValues[K]>;
};

/** Every field name in the contract; used by the drift test. */
export const RESOLVED_MEMORY_FIELDS: readonly ResolvedMemoryField[] = [
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
