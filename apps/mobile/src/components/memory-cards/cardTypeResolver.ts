import { Memory } from '@/src/api/client';

export type CardType = 'event' | 'place' | 'product' | 'offer' | 'article_learning' | 'video_social' | 'document' | 'generic';

export function resolveCardType(memory: Memory | undefined): CardType {
  if (!memory) return 'generic';

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
