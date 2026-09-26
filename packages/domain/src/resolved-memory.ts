/**
 * Public Resolved Memory contract (see docs/adr/ADR-003-public-resolved-memory-contract.md).
 *
 * Prisma-independent types shared by the API and, later, its clients. The API owns resolution
 * (apps/api/src/common/resolved-memory.projection.ts); this package only describes the output.
 */

/** Where a resolved value came from: a user confirmation, the AI pipeline, or original capture. */
export type ResolvedSource = 'user' | 'ai' | 'original';

export interface ResolvedFieldView<T> {
  value: T;
  source: ResolvedSource;
  /**
   * The AI pipeline's stored per-field confidence (0..1) for AI-sourced values, otherwise null.
   * Model self-assessment, not a calibrated probability.
   */
  confidence: number | null;
}

/** Current content-type taxonomy. Legacy lowercase `memoryType` values normalize into it. */
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

/** Value type of each field that can appear in `resolved`. */
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

/**
 * The `resolved` object on Memory-shaped responses. Unresolved fields are omitted, and each
 * endpoint returns only its own field set.
 */
export type ResolvedMemoryView = {
  [K in ResolvedMemoryField]?: ResolvedFieldView<ResolvedMemoryFieldValues[K]>;
};
