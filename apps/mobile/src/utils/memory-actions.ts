import { Memory, AIInference } from '@/src/api/client';

export type ActionKind = 'calendar' | 'maps' | 'share' | 'openUrl' | 'ask' | 'collection' | 'summarize' | 'keyPoints' | 'compare' | 'call' | 'whatsapp' | 'comingSoon';

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

  // Helper to extract field confidence
  const getFieldConfidence = (field: string): number | null => {
    if (!aiInferences) return null;
    const inference = aiInferences.find((inf) => inf.field === field);
    return inference?.confidence ?? null;
  };

  // Get type with confidence threshold check: treat missing/low confidence as unreliable
  const typeInferenceValue = getFieldValue('type');
  const typeConfidence = getFieldConfidence('type');
  const hasHighConfidenceType = typeConfidence !== null && typeConfidence >= 0.7;
  // Use high-confidence type only; low confidence uses neutral 'other' (never memory.memoryType,
  // which is the same untrusted source as the low-confidence inference). This ensures
  // generic action labels (Add to Calendar vs Expiry Reminder, Open Location vs Open Map)
  // don't leak the untrusted classification.
  const memoryType = hasHighConfidenceType ? typeInferenceValue : 'other';

  const location = getFieldValue('location');
  const date = getFieldValue('date');
  const phone = getFieldValue('phone');
  const serviceArea = getFieldValue('serviceArea');

  // Field-based actions: these apply across all types based on field presence
  // For date: add "Add to Calendar" unless it's a document (which gets "Expiry Reminder" instead)
  // isDocumentType uses confidence-gated memoryType, so low-confidence classifications
  // default to 'other' (neutral) instead of showing "Expiry Reminder"
  const isDocumentType = memoryType === 'document' || memoryType === 'DOCUMENT';
  if (date && !isDocumentType) {
    actions.push({
      label: 'Add to Calendar',
      kind: 'calendar',
      payload: { date, title: memory.title },
    });
  }

  // For location or service area: offer "Open Map" for any type that has a location or service area
  // (events call it "Open Location", places call it "Open Map", but the action is the same)
  // isEventType uses confidence-gated memoryType, so low-confidence EVENT classifications
  // default to 'other' and show "Open Map" instead of "Open Location"
  // serviceArea enables map actions even when only a coverage area (not a specific venue) is present
  const effectiveLocation = location || serviceArea;
  const isEventType = memoryType === 'event' || memoryType === 'EVENT';
  if (effectiveLocation) {
    actions.push({
      label: isEventType ? 'Open Location' : 'Open Map',
      kind: 'maps',
      payload: { location: effectiveLocation },
    });
  }

  // Phone-based actions: field-based, not gated by classification confidence
  // Presence of phone is the relevant signal, not the memory type
  if (phone) {
    actions.push({
      label: 'Call',
      kind: 'call',
      payload: { phone },
    });
    actions.push({
      label: 'WhatsApp',
      kind: 'whatsapp',
      payload: { phone },
    });
  }

  // Type-specific actions: only if classification confidence is high (>= 0.7)
  // Low-confidence classifications skip type-specific actions, preserving generic field-based actions
  if (!hasHighConfidenceType) {
    return actions;
  }

  // Type-specific actions (handles both legacy lowercase and new uppercase taxonomy)
  switch (memoryType) {
    case 'event':
    case 'EVENT':
      // Calendar and location actions already added above
      actions.push({ label: 'Share Event', kind: 'share' });
      break;

    case 'place':
    case 'PLACE':
      // Map action already added above
      actions.push({
        label: 'Save for Trip',
        kind: 'comingSoon',
        payload: { message: 'Save places to an itinerary' },
      });
      actions.push({ label: 'Share Place', kind: 'share' });
      break;

    case 'product':
    case 'PRODUCT':
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
        kind: 'compare',
        payload: { memoryId: memory.id },
      });
      break;

    case 'tutorial':
    case 'article':
    case 'ARTICLE_LEARNING':
      actions.push({
        label: 'Ask About This',
        kind: 'ask',
        payload: { prefill: `Tell me more about "${memory.title || 'this article'}"` },
      });
      actions.push({
        label: 'Summarize',
        kind: 'summarize',
      });
      actions.push({
        label: 'Related Memories',
        kind: 'comingSoon',
        payload: { message: 'Find similar content you saved' },
      });
      if (memoryType === 'article' || memoryType === 'ARTICLE_LEARNING') {
        actions.push({
          label: 'Key Points',
          kind: 'keyPoints',
        });
      }
      break;

    case 'document':
    case 'DOCUMENT':
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

    // New uppercase taxonomy types without dedicated card work yet (SC-P1)
    case 'GENERIC':
    case 'VIDEO_SOCIAL':
    case 'OFFER':
      // Fall through to default — no type-specific actions for now
      break;

    default:
      // No additional type-specific actions for other types
      break;
  }

  return actions;
}
