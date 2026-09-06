import { Memory } from '@/src/api/client';

export type CardType = 'event' | 'generic';

export function resolveCardType(memory: Memory | undefined): CardType {
  if (!memory) return 'generic';

  const memoryType = memory.memoryType || 'generic';
  const normalizedType = memoryType.toLowerCase();

  // Event-specific card
  if (normalizedType === 'event' || normalizedType === 'EVENT') {
    return 'event';
  }

  // All other types use generic card (for now)
  // SC-P1 will add PLACE, PRODUCT, ARTICLE_LEARNING, etc.
  return 'generic';
}
