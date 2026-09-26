import { Memory } from '@/src/api/client';

export type ActionKind = 'calendar' | 'maps' | 'share' | 'openUrl' | 'ask' | 'collection' | 'summarize' | 'keyPoints' | 'compare' | 'call' | 'whatsapp' | 'comingSoon';

export interface MemoryAction {
  label: string;
  kind: ActionKind;
  payload?: any;
}

export function getActionsForMemory(memory: Memory): MemoryAction[] {
  const actions: MemoryAction[] = [];
  const resolved = memory.resolved ?? {};

  // Type-specific actions need a trusted classification: a user-confirmed type, or an AI type
  // with stored confidence >= 0.7. Low or unknown confidence falls back to generic field actions.
  const resolvedType = resolved.type;
  const hasTrustedType =
    resolvedType !== undefined &&
    (resolvedType.source === 'user' ||
      (resolvedType.source === 'ai' && resolvedType.confidence !== null && resolvedType.confidence >= 0.7));
  const memoryType = hasTrustedType ? resolvedType.value : null;

  const title = resolved.title?.value ?? memory.title;
  const location = resolved.location?.value;
  const date = resolved.date?.value;
  const phone = resolved.phone?.value;
  const serviceArea = resolved.serviceArea?.value;

  // Field-based actions: these apply across all types based on field presence
  // For date: add "Add to Calendar" unless it's a document (which gets "Expiry Reminder" instead)
  // isDocumentType uses the trusted type only, so low-confidence classifications
  // stay neutral instead of showing "Expiry Reminder"
  const isDocumentType = memoryType === 'DOCUMENT';
  if (date && !isDocumentType) {
    actions.push({
      label: 'Add to Calendar',
      kind: 'calendar',
      payload: { date, title },
    });
  }

  // For location or service area: offer "Open Map" for any type that has a location or service area
  // (events call it "Open Location", places call it "Open Map", but the action is the same)
  // isEventType uses the trusted type only, so low-confidence EVENT classifications
  // show "Open Map" instead of "Open Location"
  // serviceArea enables map actions even when only a coverage area (not a specific venue) is present
  const effectiveLocation = location || serviceArea;
  const isEventType = memoryType === 'EVENT';
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

  // Type-specific actions: only for a trusted classification (see hasTrustedType)
  if (!hasTrustedType) {
    return actions;
  }

  // Resolved types are always canonical uppercase (the server normalizes legacy values)
  switch (memoryType) {
    case 'EVENT':
      // Calendar and location actions already added above
      actions.push({ label: 'Share Event', kind: 'share' });
      break;

    case 'PLACE':
      // Map action already added above
      actions.push({
        label: 'Save for Trip',
        kind: 'comingSoon',
        payload: { message: 'Save places to an itinerary' },
      });
      actions.push({ label: 'Share Place', kind: 'share' });
      break;

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

    case 'ARTICLE_LEARNING':
      actions.push({
        label: 'Ask About This',
        kind: 'ask',
        payload: { prefill: `Tell me more about "${title || 'this article'}"` },
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
      actions.push({
        label: 'Key Points',
        kind: 'keyPoints',
      });
      break;

    case 'DOCUMENT':
      actions.push({ label: 'Share Copy', kind: 'share' });
      // For documents with date, add "Expiry Reminder" instead of "Add to Calendar"
      if (date) {
        actions.push({
          label: 'Expiry Reminder',
          kind: 'calendar',
          payload: { date, title: `Expiry: ${title}` },
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
