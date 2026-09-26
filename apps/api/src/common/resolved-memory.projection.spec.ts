import { CANONICAL_MEMORY_TYPES } from '@memory-app/domain';
import { SENSITIVE_FIELDS } from './crypto/sensitive-fields';
import {
  buildResolvedMemory,
  DETAIL_RESOLVED_FIELDS,
  LIST_QUERY_CONFIRMATION_FIELDS,
  LIST_QUERY_INFERENCE_FIELDS,
  LIST_RAW_INFERENCE_FIELDS,
  LIST_RESOLVED_FIELDS,
  normalizeMemoryType,
  ResolvableMemory,
} from './resolved-memory.projection';

const t1 = new Date('2026-01-01T00:00:00.000Z');
const t2 = new Date('2026-02-01T00:00:00.000Z');
const t3 = new Date('2026-03-01T00:00:00.000Z');

let seq = 0;
function inf(field: string, valueJson: unknown, overrides: Record<string, unknown> = {}) {
  seq += 1;
  return {
    id: `inf-${String(seq).padStart(4, '0')}`,
    field,
    valueJson,
    confidence: 0.8,
    provenance: 'llm_extraction',
    modelVersion: 'model-v1',
    createdAt: t1,
    ...overrides,
  };
}

function conf(field: string, confirmedValue: unknown, createdAt: Date = t1) {
  return { field, confirmedValue, createdAt };
}

function resolve(memory: ResolvableMemory, fields = DETAIL_RESOLVED_FIELDS) {
  return buildResolvedMemory(memory, fields);
}

describe('buildResolvedMemory', () => {
  describe('general resolution', () => {
    it('confirmation > AI > raw title fallback', () => {
      expect(
        resolve({ title: 'Raw', aiInferences: [inf('title', 'AI')], userConfirmations: [conf('title', 'User')] }).title,
      ).toEqual({ value: 'User', source: 'user', confidence: null });
      expect(resolve({ title: 'Raw', aiInferences: [inf('title', 'AI', { confidence: 0.61 })] }).title).toEqual({
        value: 'AI',
        source: 'ai',
        confidence: 0.61,
      });
      expect(resolve({ title: 'Raw' }).title).toEqual({ value: 'Raw', source: 'original', confidence: null });
    });

    it('omits unresolved fields entirely, with no null values', () => {
      const resolved = resolve({ title: null, memoryType: null, aiInferences: [inf('price', '$5')] });
      expect(resolved).toEqual({ price: { value: '$5', source: 'ai', confidence: 0.8 } });
      expect(Object.values(resolved).every((view) => view !== null && view !== undefined)).toBe(true);
    });

    it('empty and whitespace confirmations fall through', () => {
      const resolved = resolve({
        title: 'Raw',
        aiInferences: [inf('title', 'AI'), inf('summary', 'AI summary')],
        userConfirmations: [conf('title', '   '), conf('summary', '')],
      });
      expect(resolved.title).toMatchObject({ value: 'AI', source: 'ai' });
      expect(resolved.summary).toMatchObject({ value: 'AI summary', source: 'ai' });
    });

    it('preserves "0" string values and false booleans', () => {
      const resolved = resolve({
        userConfirmations: [conf('price', '0')],
        aiInferences: [inf('dateYearInferred', false, { confidence: 0.4 })],
      });
      expect(resolved.price).toEqual({ value: '0', source: 'user', confidence: null });
      expect(resolved.dateYearInferred).toEqual({ value: false, source: 'ai', confidence: 0.4 });
    });

    it('omits malformed typed values and falls back to the latest valid one', () => {
      const resolved = resolve({
        title: 'Raw',
        aiInferences: [
          inf('title', 'Older valid', { createdAt: t1 }),
          inf('title', { not: 'a string' }, { createdAt: t2 }),
          inf('summary', 42, { createdAt: t2 }),
          inf('dateYearInferred', 'true', { createdAt: t2 }),
          inf('price', 0, { createdAt: t2 }),
        ],
        userConfirmations: [conf('title', 123)],
      });
      expect(resolved.title).toMatchObject({ value: 'Older valid', source: 'ai' });
      expect(resolved).not.toHaveProperty('summary');
      expect(resolved).not.toHaveProperty('dateYearInferred');
      expect(resolved).not.toHaveProperty('price');
    });

    it('validates array fields as non-empty string arrays', () => {
      const resolved = resolve({
        aiInferences: [
          inf('topics', ['travel', 'food'], { createdAt: t1 }),
          inf('topics', [], { createdAt: t2 }),
          inf('entities', ['Ada', 7], { createdAt: t2 }),
          inf('entities', 'Ada', { createdAt: t3 }),
        ],
      });
      expect(resolved.topics).toMatchObject({ value: ['travel', 'food'], source: 'ai' });
      expect(resolved).not.toHaveProperty('entities');
      expect(resolve({ aiInferences: [inf('entities', ['Ada', 'Acme'])] }).entities).toMatchObject({
        value: ['Ada', 'Acme'],
      });
    });

    it('does not mutate its inputs', () => {
      const aiInferences = Object.freeze([
        inf('title', 'A', { createdAt: t1 }),
        inf('type', 'EVENT', { createdAt: t3 }),
        inf('title', 'B', { createdAt: t2 }),
      ]);
      const userConfirmations = Object.freeze([conf('type', 'place'), conf('title', ' ')]);
      const memory = Object.freeze({ title: 'Raw', memoryType: 'EVENT', aiInferences, userConfirmations });
      const snapshot = JSON.stringify(memory);

      resolve(memory);

      expect(JSON.stringify(memory)).toBe(snapshot);
    });

    it('exposes only value, source and confidence', () => {
      const resolved = resolve({
        title: 'Raw',
        memoryType: 'EVENT',
        aiInferences: DETAIL_RESOLVED_FIELDS.map((field) =>
          inf(field, field === 'topics' || field === 'entities' ? ['x'] : field === 'dateYearInferred' ? true : 'EVENT'),
        ),
        userConfirmations: [conf('summary', 'User summary', t2)],
      });
      expect(Object.keys(resolved).sort()).toEqual([...DETAIL_RESOLVED_FIELDS].sort());
      for (const view of Object.values(resolved)) {
        expect(Object.keys(view!).sort()).toEqual(['confidence', 'source', 'value']);
      }
    });

    it('returns only the requested fields', () => {
      const resolved = buildResolvedMemory(
        { title: 'Raw', aiInferences: [inf('summary', 'S'), inf('price', '$1')] },
        ['title', 'price'],
      );
      expect(Object.keys(resolved).sort()).toEqual(['price', 'title']);
    });

    it('treats a sensitive field like any other field when its rows are passed in (already decrypted)', () => {
      const resolved = resolve({
        aiInferences: [inf('documentNumber', 'P1234567', { confidence: 0.9 })],
        userConfirmations: [conf('owner', 'Jane Doe')],
      });
      expect(resolved.documentNumber).toEqual({ value: 'P1234567', source: 'ai', confidence: 0.9 });
      expect(resolved.owner).toEqual({ value: 'Jane Doe', source: 'user', confidence: null });
    });
  });

  describe('title', () => {
    it('latest valid AI title wins without a confirmation; raw title is not changed', () => {
      const memory = {
        title: 'https://example.com/raw',
        aiInferences: [inf('title', 'A', { createdAt: t1 }), inf('title', 'B', { createdAt: t2 })],
      };
      expect(resolve(memory).title).toMatchObject({ value: 'B', source: 'ai' });
      expect(memory.title).toBe('https://example.com/raw');
    });

    it('confirmation wins over a newer AI title', () => {
      const resolved = resolve({
        title: 'Raw',
        aiInferences: [inf('title', 'Later AI', { createdAt: t3 })],
        userConfirmations: [conf('title', 'Confirmed', t1)],
      });
      expect(resolved.title).toEqual({ value: 'Confirmed', source: 'user', confidence: null });
    });

    it('omits the title when neither a value nor a raw title exists', () => {
      expect(resolve({ title: '  ' })).not.toHaveProperty('title');
      expect(resolve({ title: null })).not.toHaveProperty('title');
    });
  });

  describe('type', () => {
    it('a valid user confirmation wins, with null confidence', () => {
      const resolved = resolve({
        memoryType: 'EVENT',
        aiInferences: [inf('type', 'EVENT', { confidence: 0.95 })],
        userConfirmations: [conf('type', 'PLACE')],
      });
      expect(resolved.type).toEqual({ value: 'PLACE', source: 'user', confidence: null });
    });

    it('normalizes legacy and case variants of a confirmed type', () => {
      expect(resolve({ memoryType: 'EVENT', userConfirmations: [conf('type', 'tutorial')] }).type).toMatchObject({
        value: 'ARTICLE_LEARNING',
        source: 'user',
      });
      expect(resolve({ memoryType: 'EVENT', userConfirmations: [conf('type', ' product ')] }).type).toMatchObject({
        value: 'PRODUCT',
        source: 'user',
      });
      expect(resolve({ memoryType: 'EVENT', userConfirmations: [conf('type', 'Offer')] }).type).toMatchObject({
        value: 'OFFER',
        source: 'user',
      });
    });

    it('invalid, empty or unknown confirmations fall through to memoryType', () => {
      for (const value of ['', '  ', 'banana', 42, null, ['EVENT']]) {
        expect(resolve({ memoryType: 'PLACE', userConfirmations: [conf('type', value)] }).type).toMatchObject({
          value: 'PLACE',
          source: 'ai',
        });
      }
    });

    it('memoryType determines the value, never the type inference history', () => {
      const resolved = resolve({
        memoryType: 'PLACE',
        aiInferences: [inf('type', 'EVENT', { createdAt: t3, confidence: 0.99 })],
      });
      expect(resolved.type).toEqual({ value: 'PLACE', source: 'ai', confidence: null });
    });

    it('passes canonical uppercase memoryType through', () => {
      for (const type of CANONICAL_MEMORY_TYPES) {
        expect(resolve({ memoryType: type }).type).toMatchObject({ value: type, source: 'ai' });
      }
    });

    it.each([
      ['event', 'EVENT'],
      ['place', 'PLACE'],
      ['product', 'PRODUCT'],
      ['article', 'ARTICLE_LEARNING'],
      ['tutorial', 'ARTICLE_LEARNING'],
      ['video', 'VIDEO_SOCIAL'],
      ['post', 'VIDEO_SOCIAL'],
      ['document', 'DOCUMENT'],
      ['image', 'GENERIC'],
      ['note', 'GENERIC'],
      ['other', 'GENERIC'],
    ])('maps legacy memoryType %s to %s', (legacy, canonical) => {
      expect(resolve({ memoryType: legacy }).type).toMatchObject({ value: canonical, source: 'ai' });
      expect(normalizeMemoryType(legacy)).toBe(canonical);
    });

    it('emits a stored GENERIC as a real classification', () => {
      const resolved = resolve({ memoryType: 'GENERIC', aiInferences: [inf('type', 'GENERIC', { confidence: 0.55 })] });
      expect(resolved.type).toEqual({ value: 'GENERIC', source: 'ai', confidence: 0.55 });
    });

    it('omits type when memoryType is null (no manufactured GENERIC)', () => {
      const resolved = resolve({ memoryType: null, aiInferences: [inf('type', 'EVENT')] });
      expect(resolved).not.toHaveProperty('type');
    });

    it('has no legacy alias for OFFER and rejects unknown values', () => {
      expect(normalizeMemoryType('offer')).toBe('OFFER');
      expect(normalizeMemoryType('deal')).toBeNull();
      expect(normalizeMemoryType(undefined)).toBeNull();
    });

    it('uses the newest type inference confidence when it matches, including after legacy normalization', () => {
      expect(
        resolve({
          memoryType: 'event',
          aiInferences: [
            inf('type', 'EVENT', { createdAt: t1, confidence: 0.3 }),
            inf('type', 'event', { createdAt: t2, confidence: 0.87 }),
          ],
        }).type,
      ).toEqual({ value: 'EVENT', source: 'ai', confidence: 0.87 });
    });

    it('newest mismatching inference gives null confidence, even if an older one matches', () => {
      const resolved = resolve({
        memoryType: 'PRODUCT',
        aiInferences: [
          inf('type', 'PRODUCT', { createdAt: t1, confidence: 0.9 }),
          inf('type', 'OFFER', { createdAt: t2, confidence: 0.8 }),
        ],
      });
      expect(resolved.type).toEqual({ value: 'PRODUCT', source: 'ai', confidence: null });
    });

    it('breaks equal createdAt by id when choosing the newest type inference', () => {
      const resolved = resolve({
        memoryType: 'EVENT',
        aiInferences: [
          inf('type', 'EVENT', { id: 'b', createdAt: t2, confidence: 0.7 }),
          inf('type', 'PLACE', { id: 'a', createdAt: t2, confidence: 0.9 }),
        ],
      });
      expect(resolved.type).toEqual({ value: 'EVENT', source: 'ai', confidence: 0.7 });
    });

    it('no type inference gives null confidence (e.g. inferences removed after reprocessing)', () => {
      expect(resolve({ memoryType: 'VIDEO_SOCIAL', aiInferences: [] }).type).toEqual({
        value: 'VIDEO_SOCIAL',
        source: 'ai',
        confidence: null,
      });
    });
  });
});

describe('field sets', () => {
  it('Detail catalog is the approved 27 fields and excludes notes', () => {
    expect(DETAIL_RESOLVED_FIELDS).toHaveLength(27);
    expect(new Set(DETAIL_RESOLVED_FIELDS).size).toBe(27);
    expect(DETAIL_RESOLVED_FIELDS).not.toContain('notes');
  });

  it('list preview is exactly title/type/date/location/price/category', () => {
    expect([...LIST_RESOLVED_FIELDS].sort()).toEqual(['category', 'date', 'location', 'price', 'title', 'type']);
  });

  it('no list field set contains a sensitive field', () => {
    for (const set of [LIST_RESOLVED_FIELDS, LIST_RAW_INFERENCE_FIELDS, LIST_QUERY_INFERENCE_FIELDS, LIST_QUERY_CONFIRMATION_FIELDS]) {
      for (const sensitive of SENSITIVE_FIELDS) {
        expect(set).not.toContain(sensitive);
      }
    }
  });

  it('list raw inference fields stay exactly the original four', () => {
    expect([...LIST_RAW_INFERENCE_FIELDS].sort()).toEqual(['category', 'date', 'location', 'price']);
  });

  it('sensitive rows cannot leak through the list preview even if passed in', () => {
    const resolved = buildResolvedMemory(
      {
        title: 'Raw',
        aiInferences: [inf('documentNumber', 'P1'), inf('owner', 'Jane'), inf('issuer', 'Gov')],
        userConfirmations: [conf('documentNumber', 'P2')],
      },
      LIST_RESOLVED_FIELDS,
    );
    expect(Object.keys(resolved)).toEqual(['title']);
  });
});
