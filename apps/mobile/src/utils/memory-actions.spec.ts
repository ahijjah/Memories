import { getActionsForMemory } from './memory-actions';
import { Memory, AIInference } from '@/src/api/client';
import type { CanonicalMemoryType, ResolvedMemoryView } from '@/src/api/resolved';

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

  // Builds the server-shaped `resolved` object (PR2) from AI rows: each field becomes an
  // AI-sourced value carrying its stored confidence. Non-canonical types map to GENERIC.
  const CANONICAL: CanonicalMemoryType[] = ['GENERIC', 'EVENT', 'PLACE', 'PRODUCT', 'ARTICLE_LEARNING', 'VIDEO_SOCIAL', 'OFFER', 'DOCUMENT'];
  const withResolved = (memory: Memory, inferences?: AIInference[]): Memory => {
    const resolved: Record<string, unknown> = {};
    for (const inference of inferences ?? []) {
      const value =
        inference.field === 'type'
          ? CANONICAL.find((type) => type === String(inference.valueJson).toUpperCase()) ?? 'GENERIC'
          : inference.valueJson;
      resolved[inference.field] = { value, source: 'ai', confidence: inference.confidence };
    }
    return { ...memory, resolved: resolved as ResolvedMemoryView };
  };

  describe('Type-specific actions based on classification confidence', () => {
    it('should show Share Event when memoryType is EVENT with confidence >= 0.7', () => {
      const memory = createMemory({ memoryType: 'EVENT' });
      const inferences = [
        createInference('type', 'EVENT', 0.95),
      ];

      const actions = getActionsForMemory(withResolved(memory, inferences));
      const shareEventAction = actions.find((a) => a.label === 'Share Event');

      expect(shareEventAction).toBeDefined();
      expect(shareEventAction?.kind).toBe('share');
    });

    it('should NOT show Share Event when EVENT memoryType has confidence < 0.7', () => {
      const memory = createMemory({ memoryType: 'EVENT' });
      const inferences = [
        createInference('type', 'EVENT', 0.65),
      ];

      const actions = getActionsForMemory(withResolved(memory, inferences));
      const shareEventAction = actions.find((a) => a.label === 'Share Event');

      expect(shareEventAction).toBeUndefined();
    });

    it('should show generic field-based actions (Add to Calendar) even with low-confidence classification', () => {
      const memory = createMemory({ memoryType: 'EVENT' });
      const inferences = [
        createInference('type', 'EVENT', 0.5),
        createInference('date', '2026-09-20', 0.9),
      ];

      const actions = getActionsForMemory(withResolved(memory, inferences));
      const calendarAction = actions.find((a) => a.label === 'Add to Calendar');

      expect(calendarAction).toBeDefined();
      expect(calendarAction?.kind).toBe('calendar');
    });

    it('should show neutral "Add to Calendar" label (not Expiry Reminder) for low-confidence DOCUMENT with date', () => {
      const memory = createMemory({ memoryType: 'DOCUMENT' });
      const inferences = [
        createInference('type', 'DOCUMENT', 0.5), // Low confidence
        createInference('date', '2026-12-31', 0.9),
      ];

      const actions = getActionsForMemory(withResolved(memory, inferences));
      const calendarAction = actions.find((a) => a.kind === 'calendar');
      const expiryAction = actions.find((a) => a.label === 'Expiry Reminder');

      expect(calendarAction).toBeDefined();
      expect(calendarAction?.label).toBe('Add to Calendar'); // Neutral label when confidence is low
      expect(expiryAction).toBeUndefined(); // No Expiry Reminder for low-confidence DOCUMENT
    });

    it('should show neutral "Open Map" label (not Open Location) for low-confidence EVENT with location', () => {
      const memory = createMemory({ memoryType: 'EVENT' });
      const inferences = [
        createInference('type', 'EVENT', 0.4), // Low confidence
        createInference('location', 'San Francisco, CA', 0.9),
      ];

      const actions = getActionsForMemory(withResolved(memory, inferences));
      const mapAction = actions.find((a) => a.kind === 'maps');

      expect(mapAction).toBeDefined();
      expect(mapAction?.label).toBe('Open Map'); // Neutral label when confidence is low, not "Open Location"
    });

    it('should treat missing type confidence as low-confidence (no type-specific actions)', () => {
      const memory = createMemory({ memoryType: 'event' });
      // No type inference provided
      const inferences = [
        createInference('date', '2026-09-20', 0.9),
      ];

      const actions = getActionsForMemory(withResolved(memory, inferences));
      const shareEventAction = actions.find((a) => a.label === 'Share Event');

      expect(shareEventAction).toBeUndefined();
    });

    it('should show neutral "Open Map" label (not Open Location) for low-confidence EVENT with location', () => {
      const memory = createMemory({ memoryType: 'EVENT' });
      const inferences = [
        createInference('type', 'EVENT', 0.4),
        createInference('location', 'San Francisco, CA', 0.9),
      ];

      const actions = getActionsForMemory(withResolved(memory, inferences));
      const mapAction = actions.find((a) => a.kind === 'maps');

      expect(mapAction).toBeDefined();
      expect(mapAction?.label).toBe('Open Map'); // Neutral label when confidence is low, not "Open Location"
      expect(mapAction?.kind).toBe('maps');
    });

    it('should show Save for Trip when memoryType is PLACE with confidence >= 0.7', () => {
      const memory = createMemory({ memoryType: 'PLACE' });
      const inferences = [
        createInference('type', 'PLACE', 0.8),
      ];

      const actions = getActionsForMemory(withResolved(memory, inferences));
      const saveTripAction = actions.find((a) => a.label === 'Save for Trip');

      expect(saveTripAction).toBeDefined();
      expect(saveTripAction?.kind).toBe('comingSoon');
    });

    it('should NOT show Save for Trip when PLACE memoryType has confidence < 0.7', () => {
      const memory = createMemory({ memoryType: 'PLACE' });
      const inferences = [
        createInference('type', 'PLACE', 0.6),
      ];

      const actions = getActionsForMemory(withResolved(memory, inferences));
      const saveTripAction = actions.find((a) => a.label === 'Save for Trip');

      expect(saveTripAction).toBeUndefined();
    });

    it('should show Compare when memoryType is PRODUCT with confidence >= 0.7', () => {
      const memory = createMemory({ memoryType: 'PRODUCT' });
      const inferences = [
        createInference('type', 'PRODUCT', 0.88),
      ];

      const actions = getActionsForMemory(withResolved(memory, inferences));
      const compareAction = actions.find((a) => a.label === 'Compare');

      expect(compareAction).toBeDefined();
      expect(compareAction?.kind).toBe('compare');
    });

    it('should NOT show Compare when PRODUCT memoryType has confidence < 0.7', () => {
      const memory = createMemory({ memoryType: 'PRODUCT' });
      const inferences = [
        createInference('type', 'PRODUCT', 0.69),
      ];

      const actions = getActionsForMemory(withResolved(memory, inferences));
      const compareAction = actions.find((a) => a.label === 'Compare');

      expect(compareAction).toBeUndefined();
    });

    it('should show Summarize when memoryType is ARTICLE_LEARNING with confidence >= 0.7', () => {
      const memory = createMemory({ memoryType: 'ARTICLE_LEARNING' });
      const inferences = [
        createInference('type', 'ARTICLE_LEARNING', 0.92),
      ];

      const actions = getActionsForMemory(withResolved(memory, inferences));
      const summarizeAction = actions.find((a) => a.label === 'Summarize');

      expect(summarizeAction).toBeDefined();
      expect(summarizeAction?.kind).toBe('summarize');
    });

    it('should NOT show Summarize when ARTICLE_LEARNING has confidence < 0.7', () => {
      const memory = createMemory({ memoryType: 'ARTICLE_LEARNING' });
      const inferences = [
        createInference('type', 'ARTICLE_LEARNING', 0.68),
      ];

      const actions = getActionsForMemory(withResolved(memory, inferences));
      const summarizeAction = actions.find((a) => a.label === 'Summarize');

      expect(summarizeAction).toBeUndefined();
    });

    it('should show Expiry Reminder for DOCUMENT with confidence >= 0.7 and a date', () => {
      const memory = createMemory({ memoryType: 'DOCUMENT' });
      const inferences = [
        createInference('type', 'DOCUMENT', 0.85),
        createInference('date', '2026-12-31', 0.9),
      ];

      const actions = getActionsForMemory(withResolved(memory, inferences));
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

      const actions = getActionsForMemory(withResolved(memory, inferences));
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

      const actions = getActionsForMemory(withResolved(memory, inferences));
      const calendarAction = actions.find((a) => a.label === 'Add to Calendar');

      expect(calendarAction).toBeDefined();
    });

    it('should always show Open Map if location exists, with correct label based on memoryType', () => {
      const memoryEvent = createMemory({ memoryType: 'EVENT' });
      const inferencesEvent = [
        createInference('type', 'EVENT', 0.85),
        createInference('location', 'Paris, France', 0.9),
      ];

      const actionsEvent = getActionsForMemory(withResolved(memoryEvent, inferencesEvent));
      const locationActionEvent = actionsEvent.find((a) => a.kind === 'maps');
      expect(locationActionEvent?.label).toBe('Open Location'); // Event uses "Open Location"

      const memoryPlace = createMemory({ memoryType: 'PLACE' });
      const inferencesPlace = [
        createInference('type', 'PLACE', 0.85),
        createInference('location', 'Tokyo, Japan', 0.9),
      ];

      const actionsPlace = getActionsForMemory(withResolved(memoryPlace, inferencesPlace));
      const locationActionPlace = actionsPlace.find((a) => a.kind === 'maps');
      expect(locationActionPlace?.label).toBe('Open Map'); // Place uses "Open Map"
    });

    it('should handle a memory with no resolved fields gracefully', () => {
      const memory = createMemory({ memoryType: 'event' });

      const actions = getActionsForMemory(withResolved(memory, undefined));
      // No resolved fields: no actions, and the raw memoryType is never used as a fallback
      expect(actions).toEqual([]);
    });
  });

  describe('Phone-based actions (field-based, not type-gated)', () => {
    it('should show Call and WhatsApp when phone is present', () => {
      const memory = createMemory({ memoryType: 'PRODUCT' });
      const inferences = [
        createInference('type', 'PRODUCT', 0.3), // Low confidence
        createInference('phone', '555-0100', 0.9),
      ];

      const actions = getActionsForMemory(withResolved(memory, inferences));
      const callAction = actions.find((a) => a.label === 'Call');
      const whatsappAction = actions.find((a) => a.label === 'WhatsApp');

      expect(callAction).toBeDefined();
      expect(callAction?.kind).toBe('call');
      expect(callAction?.payload?.phone).toBe('555-0100');

      expect(whatsappAction).toBeDefined();
      expect(whatsappAction?.kind).toBe('whatsapp');
      expect(whatsappAction?.payload?.phone).toBe('555-0100');
    });

    it('should NOT show Call or WhatsApp when phone is absent', () => {
      const memory = createMemory({ memoryType: 'PRODUCT' });
      const inferences = [
        createInference('type', 'PRODUCT', 0.9),
      ];

      const actions = getActionsForMemory(withResolved(memory, inferences));
      const callAction = actions.find((a) => a.label === 'Call');
      const whatsappAction = actions.find((a) => a.label === 'WhatsApp');

      expect(callAction).toBeUndefined();
      expect(whatsappAction).toBeUndefined();
    });

    it('should show Open Map when serviceArea is present (location absent)', () => {
      const memory = createMemory({ memoryType: 'PLACE' });
      const inferences = [
        createInference('type', 'PLACE', 0.85),
        createInference('serviceArea', 'Ramallah and surrounding areas', 0.9),
      ];

      const actions = getActionsForMemory(withResolved(memory, inferences));
      const mapAction = actions.find((a) => a.kind === 'maps');

      expect(mapAction).toBeDefined();
      expect(mapAction?.label).toBe('Open Map');
      expect(mapAction?.payload?.location).toBe('Ramallah and surrounding areas');
    });

    it('should prefer location over serviceArea when both present', () => {
      const memory = createMemory({ memoryType: 'PLACE' });
      const inferences = [
        createInference('type', 'PLACE', 0.85),
        createInference('location', 'Specific Cafe, Ramallah', 0.9),
        createInference('serviceArea', 'Ramallah and surrounding areas', 0.9),
      ];

      const actions = getActionsForMemory(withResolved(memory, inferences));
      const mapAction = actions.find((a) => a.kind === 'maps');

      expect(mapAction).toBeDefined();
      expect(mapAction?.payload?.location).toBe('Specific Cafe, Ramallah'); // Specific location preferred
    });
  });

  describe('Edge cases around 0.7 threshold', () => {
    it('should include type-specific actions at exactly 0.7 confidence', () => {
      const memory = createMemory({ memoryType: 'EVENT' });
      const inferences = [
        createInference('type', 'EVENT', 0.7),
      ];

      const actions = getActionsForMemory(withResolved(memory, inferences));
      const shareEventAction = actions.find((a) => a.label === 'Share Event');

      expect(shareEventAction).toBeDefined();
    });

    it('should exclude type-specific actions just below 0.7', () => {
      const memory = createMemory({ memoryType: 'EVENT' });
      const inferences = [
        createInference('type', 'EVENT', 0.6999),
      ];

      const actions = getActionsForMemory(withResolved(memory, inferences));
      const shareEventAction = actions.find((a) => a.label === 'Share Event');

      expect(shareEventAction).toBeUndefined();
    });
  });

  describe('Resolved contract (PR3)', () => {
    const typeView = (value: CanonicalMemoryType, source: 'user' | 'ai', confidence: number | null) => ({
      value,
      source,
      confidence,
    });
    const labels = (memory: Memory) => getActionsForMemory(memory).map((a) => a.label);

    it('enables type actions for a user-confirmed type, which has null confidence', () => {
      const memory = createMemory({ resolved: { type: typeView('PLACE', 'user', null) } });
      expect(labels(memory)).toEqual(['Save for Trip', 'Share Place']);
    });

    it('enables type actions for an AI type at >= 0.7 only', () => {
      expect(labels(createMemory({ resolved: { type: typeView('EVENT', 'ai', 0.7) } }))).toContain('Share Event');
      expect(labels(createMemory({ resolved: { type: typeView('EVENT', 'ai', 0.69) } }))).not.toContain('Share Event');
    });

    it('does not enable type actions for an AI type with null confidence', () => {
      expect(labels(createMemory({ resolved: { type: typeView('PRODUCT', 'ai', null) } }))).toEqual([]);
    });

    it('does not enable type actions when resolved.type is missing, whatever the raw memoryType says', () => {
      const memory = createMemory({
        memoryType: 'PRODUCT',
        aiInferences: [createInference('type', 'PRODUCT', 0.99)],
        resolved: { date: { value: '2026-10-01', source: 'ai', confidence: 0.9 } },
      });
      expect(labels(memory)).toEqual(['Add to Calendar']);
    });

    it('uses resolved (confirmed) field values, not conflicting raw inferences', () => {
      const memory = createMemory({
        title: 'https://example.com/raw',
        aiInferences: [
          createInference('date', '1999-01-01', 0.99),
          createInference('location', 'Raw Place', 0.99),
          createInference('phone', '+1 000', 0.99),
        ],
        resolved: {
          title: { value: 'Jazz Night', source: 'ai', confidence: 0.9 },
          date: { value: '2026-10-02', source: 'user', confidence: null },
          location: { value: 'Blue Hall', source: 'user', confidence: null },
          phone: { value: '+962 7 1234', source: 'ai', confidence: 0.8 },
        },
      });

      const actions = getActionsForMemory(memory);

      expect(actions.find((a) => a.kind === 'calendar')?.payload).toEqual({ date: '2026-10-02', title: 'Jazz Night' });
      expect(actions.find((a) => a.kind === 'maps')?.payload).toEqual({ location: 'Blue Hall' });
      expect(actions.find((a) => a.label === 'Call')?.payload).toEqual({ phone: '+962 7 1234' });
      expect(actions.find((a) => a.label === 'WhatsApp')?.payload).toEqual({ phone: '+962 7 1234' });
    });

    it('uses the resolved title in type-specific payloads, with raw title only as fallback', () => {
      const article = createMemory({
        title: 'https://example.com/raw',
        resolved: {
          title: { value: 'Deep Work', source: 'ai', confidence: 0.9 },
          type: typeView('ARTICLE_LEARNING', 'ai', 0.9),
        },
      });
      expect(getActionsForMemory(article).find((a) => a.kind === 'ask')?.payload).toEqual({
        prefill: 'Tell me more about "Deep Work"',
      });

      const document = createMemory({
        title: 'Raw scan',
        resolved: { type: typeView('DOCUMENT', 'user', null), date: { value: '2027-01-01', source: 'ai', confidence: 0.8 } },
      });
      expect(getActionsForMemory(document).find((a) => a.label === 'Expiry Reminder')?.payload).toEqual({
        date: '2027-01-01',
        title: 'Expiry: Raw scan',
      });
    });

    it('ignores raw memoryType and raw type inference entirely', () => {
      const memory = createMemory({
        memoryType: 'event',
        aiInferences: [createInference('type', 'event', 0.99)],
        resolved: { type: typeView('PLACE', 'ai', 0.9) },
      });
      expect(labels(memory)).toEqual(['Save for Trip', 'Share Place']);
    });
  });
});
