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

  // Field-based actions: these apply across all types based on field presence
  // For date: add "Add to Calendar" unless it's a document (which gets "Expiry Reminder" instead)
  if (date && memoryType !== 'document') {
    actions.push({
      label: 'Add to Calendar',
      kind: 'calendar',
      payload: { date, title: memory.title },
    });
  }

  // For location: offer "Open Map" for any type that has a location
  // (events call it "Open Location", places call it "Open Map", but the action is the same)
  if (location) {
    actions.push({
      label: memoryType === 'event' ? 'Open Location' : 'Open Map',
      kind: 'maps',
      payload: { location },
    });
  }

  // Type-specific actions
  switch (memoryType) {
    case 'event':
      // Calendar and location actions already added above
      actions.push({ label: 'Share Event', kind: 'share' });
      break;

    case 'place':
      // Map action already added above
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
      // For documents with date, add "Expiry Reminder" instead of "Add to Calendar"
      if (date) {
        actions.push({
          label: 'Expiry Reminder',
          kind: 'calendar',
          payload: { date, title: `Expiry: ${memory.title}` },
        });
      }
      break;

    default:
      // No additional type-specific actions for other types
      break;
  }

  return actions;
}
