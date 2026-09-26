import { Memory } from '@/src/api/client';
import type { CanonicalMemoryType } from '@/src/api/resolved';

export type CardType = 'event' | 'place' | 'product' | 'offer' | 'article_learning' | 'video_social' | 'document' | 'generic';

const CARD_TYPE_BY_RESOLVED_TYPE: Record<CanonicalMemoryType, CardType> = {
  EVENT: 'event',
  PLACE: 'place',
  PRODUCT: 'product',
  OFFER: 'offer',
  ARTICLE_LEARNING: 'article_learning',
  VIDEO_SOCIAL: 'video_social',
  DOCUMENT: 'document',
  GENERIC: 'generic',
};

export function resolveCardType(memory: Memory | undefined): CardType {
  if (!memory) return 'generic';

  // Server-resolved type is authoritative whenever the endpoint returns `resolved`; a missing
  // type means unresolved and renders generic. It is never re-derived from raw memoryType.
  if (memory.resolved) {
    const resolvedType = memory.resolved.type?.value;
    return (resolvedType && CARD_TYPE_BY_RESOLVED_TYPE[resolvedType]) || 'generic';
  }

  // Legacy mapping, only for Memory-shaped responses without `resolved`
  // (Collections, Vault list, Workspaces).
  const memoryType = memory.memoryType || 'generic';
  const normalizedType = memoryType.toLowerCase();

  // Map both legacy lowercase and new uppercase values
  if (normalizedType === 'event') return 'event';
  if (normalizedType === 'place') return 'place';
  if (normalizedType === 'product') return 'product';
  if (normalizedType === 'offer') return 'offer';
  if (normalizedType === 'article' || normalizedType === 'article_learning') return 'article_learning';
  if (normalizedType === 'tutorial') return 'article_learning';
  if (normalizedType === 'video' || normalizedType === 'video_social') return 'video_social';
  if (normalizedType === 'post') return 'video_social';
  if (normalizedType === 'document') return 'document';

  // All others fall back to generic
  return 'generic';
}
