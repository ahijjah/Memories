import { Memory, AIInference } from '@/src/api/client';

export type ActionKind = 'calendar' | 'maps' | 'share' | 'openUrl' | 'ask' | 'collection' | 'comingSoon';

export interface MemoryAction {
  label: string;
  kind: ActionKind;
  payload?: any;
}

export function getActionsForMemory(
  memory: Memory,
  aiInferences?: AIInference[],
): MemoryAction[] {
  const actions: MemoryAction[] = [];

  // Helper to extract AI inference field values
  const getFieldValue = (field: string): any => {
    if (!aiInferences) return null;
    const inferences = aiInferences.filter((inf) => inf.field === field);
    if (inferences.length === 0) return null;
    return inferences[0].valueJson;
  };

  const memoryType = getFieldValue('type') || memory.memoryType || 'other';
  const location = getFieldValue('location');
  const date = getFieldValue('date');

  // Type-specific actions
  switch (memoryType) {
    case 'event':
      if (date) {
        actions.push({
          label: 'Add to Calendar',
          kind: 'calendar',
          payload: { date, title: memory.title },
        });
      }
      if (location) {
        actions.push({
          label: 'Open Location',
          kind: 'maps',
          payload: { location },
        });
      }
      actions.push({ label: 'Share Event', kind: 'share' });
      break;

    case 'place':
      if (location) {
        actions.push({
          label: 'Open Map',
          kind: 'maps',
          payload: { location },
        });
      }
      actions.push({
        label: 'Save for Trip',
        kind: 'comingSoon',
        payload: { message: 'Save places to an itinerary' },
      });
      actions.push({ label: 'Share Place', kind: 'share' });
      break;

    case 'product':
      if (memory.sourceUri) {
        actions.push({
          label: 'Open Product',
          kind: 'openUrl',
          payload: { url: memory.sourceUri },
        });
      }
      actions.push({
        label: 'Save for Later',
        kind: 'collection',
        payload: { message: 'Add to a collection' },
      });
      actions.push({
        label: 'Compare',
        kind: 'comingSoon',
        payload: { message: 'Compare with similar products' },
      });
      break;

    case 'tutorial':
    case 'article':
      actions.push({
        label: 'Ask About This',
        kind: 'ask',
        payload: { prefill: `Tell me more about "${memory.title || 'this article'}"` },
      });
      actions.push({
        label: 'Summarize',
        kind: 'comingSoon',
        payload: { message: 'Generate a quick summary' },
      });
      actions.push({
        label: 'Related Memories',
        kind: 'comingSoon',
        payload: { message: 'Find similar content you saved' },
      });
      if (memoryType === 'article') {
        actions.push({
          label: 'Key Points',
          kind: 'comingSoon',
          payload: { message: 'Extract key takeaways' },
        });
      }
      break;

    case 'document':
      actions.push({ label: 'Share Copy', kind: 'share' });
      if (date) {
        actions.push({
          label: 'Expiry Reminder',
          kind: 'calendar',
          payload: { date, title: `Expiry: ${memory.title}` },
        });
      }
      break;

    default:
      // No type-specific actions for other types
      break;
  }

  return actions;
}
