import { getActionsForMemory } from './memory-actions';
import { Memory, AIInference } from '@/src/api/client';

describe('getActionsForMemory', () => {
  // Helper to create mock memory
  const createMemory = (overrides?: Partial<Memory>): Memory => ({
    id: 'mem-123',
    userId: 'user-123',
    title: 'Test Memory',
    sourceUri: 'https://example.com',
    sourceType: 'web',
    content: 'test content',
    processingState: 'understood' as const,
    memoryType: 'event',
    securityScope: 'public' as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    capturedAt: new Date().toISOString(),
    ...overrides,
  });

  // Helper to create mock AIInference
  const createInference = (field: string, valueJson: any, confidence: number): AIInference => ({
    id: `inf-${field}`,
    memoryId: 'mem-123',
    field,
    valueJson,
    confidence,
    modelVersion: 'claude-3-sonnet',
    provenance: 'llm_extraction',
    createdAt: new Date().toISOString(),
  });

  describe('Type-specific actions based on classification confidence', () => {
    it('should show Share Event when memoryType is EVENT with confidence >= 0.7', () => {
      const memory = createMemory({ memoryType: 'EVENT' });
      const inferences = [
        createInference('type', 'EVENT', 0.95),
      ];

      const actions = getActionsForMemory(memory, inferences);
      const shareEventAction = actions.find((a) => a.label === 'Share Event');

      expect(shareEventAction).toBeDefined();
      expect(shareEventAction?.kind).toBe('share');
    });

    it('should NOT show Share Event when EVENT memoryType has confidence < 0.7', () => {
      const memory = createMemory({ memoryType: 'EVENT' });
      const inferences = [
        createInference('type', 'EVENT', 0.65),
      ];

      const actions = getActionsForMemory(memory, inferences);
      const shareEventAction = actions.find((a) => a.label === 'Share Event');

      expect(shareEventAction).toBeUndefined();
    });

    it('should show generic field-based actions (Add to Calendar) even with low-confidence classification', () => {
      const memory = createMemory({ memoryType: 'EVENT' });
      const inferences = [
        createInference('type', 'EVENT', 0.5),
        createInference('date', '2026-09-20', 0.9),
      ];

      const actions = getActionsForMemory(memory, inferences);
      const calendarAction = actions.find((a) => a.label === 'Add to Calendar');

      expect(calendarAction).toBeDefined();
      expect(calendarAction?.kind).toBe('calendar');
    });

    it('should treat missing type confidence as low-confidence (no type-specific actions)', () => {
      const memory = createMemory({ memoryType: 'event' });
      // No type inference provided
      const inferences = [
        createInference('date', '2026-09-20', 0.9),
      ];

      const actions = getActionsForMemory(memory, inferences);
      const shareEventAction = actions.find((a) => a.label === 'Share Event');

      expect(shareEventAction).toBeUndefined();
    });

    it('should show location-based actions (Open Location) even with low-confidence classification', () => {
      const memory = createMemory({ memoryType: 'EVENT' });
      const inferences = [
        createInference('type', 'EVENT', 0.4),
        createInference('location', 'San Francisco, CA', 0.9),
      ];

      const actions = getActionsForMemory(memory, inferences);
      const locationAction = actions.find((a) => a.label === 'Open Location');

      expect(locationAction).toBeDefined();
      expect(locationAction?.kind).toBe('maps');
    });

    it('should show Save for Trip when memoryType is PLACE with confidence >= 0.7', () => {
      const memory = createMemory({ memoryType: 'PLACE' });
      const inferences = [
        createInference('type', 'PLACE', 0.8),
      ];

      const actions = getActionsForMemory(memory, inferences);
      const saveTripAction = actions.find((a) => a.label === 'Save for Trip');

      expect(saveTripAction).toBeDefined();
      expect(saveTripAction?.kind).toBe('comingSoon');
    });

    it('should NOT show Save for Trip when PLACE memoryType has confidence < 0.7', () => {
      const memory = createMemory({ memoryType: 'PLACE' });
      const inferences = [
        createInference('type', 'PLACE', 0.6),
      ];

      const actions = getActionsForMemory(memory, inferences);
      const saveTripAction = actions.find((a) => a.label === 'Save for Trip');

      expect(saveTripAction).toBeUndefined();
    });

    it('should show Compare when memoryType is PRODUCT with confidence >= 0.7', () => {
      const memory = createMemory({ memoryType: 'PRODUCT' });
      const inferences = [
        createInference('type', 'PRODUCT', 0.88),
      ];

      const actions = getActionsForMemory(memory, inferences);
      const compareAction = actions.find((a) => a.label === 'Compare');

      expect(compareAction).toBeDefined();
      expect(compareAction?.kind).toBe('compare');
    });

    it('should NOT show Compare when PRODUCT memoryType has confidence < 0.7', () => {
      const memory = createMemory({ memoryType: 'PRODUCT' });
      const inferences = [
        createInference('type', 'PRODUCT', 0.69),
      ];

      const actions = getActionsForMemory(memory, inferences);
      const compareAction = actions.find((a) => a.label === 'Compare');

      expect(compareAction).toBeUndefined();
    });

    it('should show Summarize when memoryType is ARTICLE_LEARNING with confidence >= 0.7', () => {
      const memory = createMemory({ memoryType: 'ARTICLE_LEARNING' });
      const inferences = [
        createInference('type', 'ARTICLE_LEARNING', 0.92),
      ];

      const actions = getActionsForMemory(memory, inferences);
      const summarizeAction = actions.find((a) => a.label === 'Summarize');

      expect(summarizeAction).toBeDefined();
      expect(summarizeAction?.kind).toBe('summarize');
    });

    it('should NOT show Summarize when ARTICLE_LEARNING has confidence < 0.7', () => {
      const memory = createMemory({ memoryType: 'ARTICLE_LEARNING' });
      const inferences = [
        createInference('type', 'ARTICLE_LEARNING', 0.68),
      ];

      const actions = getActionsForMemory(memory, inferences);
      const summarizeAction = actions.find((a) => a.label === 'Summarize');

      expect(summarizeAction).toBeUndefined();
    });

    it('should show Expiry Reminder for DOCUMENT with confidence >= 0.7 and a date', () => {
      const memory = createMemory({ memoryType: 'DOCUMENT' });
      const inferences = [
        createInference('type', 'DOCUMENT', 0.85),
        createInference('date', '2026-12-31', 0.9),
      ];

      const actions = getActionsForMemory(memory, inferences);
      const expiryAction = actions.find((a) => a.label === 'Expiry Reminder');

      expect(expiryAction).toBeDefined();
      expect(expiryAction?.kind).toBe('calendar');
    });

    it('should NOT show Expiry Reminder for DOCUMENT with confidence < 0.7, even with a date', () => {
      const memory = createMemory({ memoryType: 'DOCUMENT' });
      const inferences = [
        createInference('type', 'DOCUMENT', 0.5),
        createInference('date', '2026-12-31', 0.9),
      ];

      const actions = getActionsForMemory(memory, inferences);
      const expiryAction = actions.find((a) => a.label === 'Expiry Reminder');

      expect(expiryAction).toBeUndefined();
      // But should still show generic Add to Calendar for documents with date if type confidence is low? No, per spec documents get Expiry Reminder, not Add to Calendar
    });
  });

  describe('Field-based actions independent of classification confidence', () => {
    it('should always show Add to Calendar if date exists and memoryType is not document-like', () => {
      const memory = createMemory({ memoryType: 'OTHER' });
      const inferences = [
        createInference('type', 'OTHER', 0.3), // Low confidence
        createInference('date', '2026-10-15', 0.9),
      ];

      const actions = getActionsForMemory(memory, inferences);
      const calendarAction = actions.find((a) => a.label === 'Add to Calendar');

      expect(calendarAction).toBeDefined();
    });

    it('should always show Open Map if location exists, with correct label based on memoryType', () => {
      const memoryEvent = createMemory({ memoryType: 'EVENT' });
      const inferencesEvent = [
        createInference('type', 'EVENT', 0.85),
        createInference('location', 'Paris, France', 0.9),
      ];

      const actionsEvent = getActionsForMemory(memoryEvent, inferencesEvent);
      const locationActionEvent = actionsEvent.find((a) => a.kind === 'maps');
      expect(locationActionEvent?.label).toBe('Open Location'); // Event uses "Open Location"

      const memoryPlace = createMemory({ memoryType: 'PLACE' });
      const inferencesPlace = [
        createInference('type', 'PLACE', 0.85),
        createInference('location', 'Tokyo, Japan', 0.9),
      ];

      const actionsPlace = getActionsForMemory(memoryPlace, inferencesPlace);
      const locationActionPlace = actionsPlace.find((a) => a.kind === 'maps');
      expect(locationActionPlace?.label).toBe('Open Map'); // Place uses "Open Map"
    });

    it('should handle missing aiInferences gracefully', () => {
      const memory = createMemory({ memoryType: 'event' });

      const actions = getActionsForMemory(memory, undefined);
      // Should fall back to memory.memoryType and not crash
      expect(Array.isArray(actions)).toBe(true);
    });
  });

  describe('Edge cases around 0.7 threshold', () => {
    it('should include type-specific actions at exactly 0.7 confidence', () => {
      const memory = createMemory({ memoryType: 'EVENT' });
      const inferences = [
        createInference('type', 'EVENT', 0.7),
      ];

      const actions = getActionsForMemory(memory, inferences);
      const shareEventAction = actions.find((a) => a.label === 'Share Event');

      expect(shareEventAction).toBeDefined();
    });

    it('should exclude type-specific actions just below 0.7', () => {
      const memory = createMemory({ memoryType: 'EVENT' });
      const inferences = [
        createInference('type', 'EVENT', 0.6999),
      ];

      const actions = getActionsForMemory(memory, inferences);
      const shareEventAction = actions.find((a) => a.label === 'Share Event');

      expect(shareEventAction).toBeUndefined();
    });
  });
});
