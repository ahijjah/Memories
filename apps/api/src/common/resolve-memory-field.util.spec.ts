import {
  compareLatestFirst,
  isPresentValue,
  LATEST_AI_INFERENCE_ORDER,
  resolveMemoryField,
} from './resolve-memory-field.util';

const t1 = new Date('2026-01-01T10:00:00.000Z');
const t2 = new Date('2026-01-02T10:00:00.000Z');
const t3 = new Date('2026-01-03T10:00:00.000Z');

function inference(overrides: Record<string, unknown>) {
  return {
    id: 'inf-default',
    field: 'title',
    valueJson: 'AI',
    confidence: 0.8,
    provenance: 'llm_extraction',
    modelVersion: 'model-v1',
    createdAt: t1,
    ...overrides,
  };
}

describe('resolveMemoryField', () => {
  describe('precedence', () => {
    it('1. confirmation wins over AI', () => {
      const result = resolveMemoryField('title', {
        aiInferences: [inference({ valueJson: 'AI Title', confidence: 1 })],
        userConfirmations: [{ field: 'title', confirmedValue: 'User Title', createdAt: t1 }],
      });
      expect(result.value).toBe('User Title');
      expect(result.source).toBe('user');
    });

    it('2. confirmation wins over a newer AI inference written by a later reprocess', () => {
      const result = resolveMemoryField('title', {
        aiInferences: [
          inference({ id: 'a', valueJson: 'A', createdAt: t1 }),
          inference({ id: 'b', valueJson: 'B', createdAt: t3, confidence: 0.99 }),
        ],
        userConfirmations: [{ field: 'title', confirmedValue: 'C', createdAt: t2 }],
      });
      expect(result.value).toBe('C');
      expect(result.source).toBe('user');
    });

    it('3. latest AI inference wins without a confirmation (reprocess A → B returns B)', () => {
      const result = resolveMemoryField('title', {
        aiInferences: [
          inference({ id: 'a', valueJson: 'A', createdAt: t1 }),
          inference({ id: 'b', valueJson: 'B', createdAt: t2 }),
        ],
      });
      expect(result.value).toBe('B');
      expect(result.source).toBe('ai');
    });

    it('4. input order does not affect the result', () => {
      const rows = [
        inference({ id: 'a', valueJson: 'A', createdAt: t1 }),
        inference({ id: 'c', valueJson: 'C', createdAt: t3 }),
        inference({ id: 'b', valueJson: 'B', createdAt: t2 }),
      ];
      const orders = [rows, [...rows].reverse(), [rows[1], rows[0], rows[2]], [rows[2], rows[1], rows[0]]];
      for (const order of orders) {
        expect(resolveMemoryField('title', { aiInferences: order }).value).toBe('C');
      }
    });

    it('5. same createdAt is broken deterministically by id DESC', () => {
      const low = inference({ id: 'id-aaa', valueJson: 'Low', createdAt: t2 });
      const high = inference({ id: 'id-bbb', valueJson: 'High', createdAt: t2 });
      expect(resolveMemoryField('title', { aiInferences: [low, high] }).value).toBe('High');
      expect(resolveMemoryField('title', { aiInferences: [high, low] }).value).toBe('High');
    });

    it('6. falls back to the explicit raw value', () => {
      const result = resolveMemoryField('title', { aiInferences: [], userConfirmations: [], rawFallback: 'Raw' });
      expect(result).toEqual({ value: 'Raw', source: 'original' });
    });

    it('7. returns none when nothing resolves and no fallback is given', () => {
      expect(resolveMemoryField('summary', {})).toEqual({ value: null, source: 'none' });
      expect(resolveMemoryField('summary', { aiInferences: null, userConfirmations: undefined })).toEqual({
        value: null,
        source: 'none',
      });
    });

    it('only considers rows for the requested field', () => {
      const result = resolveMemoryField('title', {
        aiInferences: [inference({ field: 'summary', valueJson: 'S', createdAt: t3 })],
        userConfirmations: [{ field: 'date', confirmedValue: '2026-01-01' }],
        rawFallback: 'Raw',
      });
      expect(result.value).toBe('Raw');
    });

    it('per-field latest: an older valid inference stays effective when the newer run omitted the field', () => {
      const result = resolveMemoryField('price', {
        aiInferences: [
          inference({ id: 'old', field: 'price', valueJson: '$10', createdAt: t1 }),
          inference({ id: 'new-title', field: 'title', valueJson: 'T', createdAt: t2 }),
        ],
      });
      expect(result.value).toBe('$10');
    });
  });

  describe('presence semantics (D1)', () => {
    it('8. empty confirmation falls through to AI', () => {
      const result = resolveMemoryField('title', {
        aiInferences: [inference({ valueJson: 'AI' })],
        userConfirmations: [{ field: 'title', confirmedValue: '' }],
      });
      expect(result).toMatchObject({ value: 'AI', source: 'ai' });
    });

    it('9. whitespace confirmation falls through to AI', () => {
      const result = resolveMemoryField('title', {
        aiInferences: [inference({ valueJson: 'AI' })],
        userConfirmations: [{ field: 'title', confirmedValue: '   \n\t' }],
      });
      expect(result).toMatchObject({ value: 'AI', source: 'ai' });
    });

    it('null confirmation falls through to AI', () => {
      const result = resolveMemoryField('title', {
        aiInferences: [inference({ valueJson: 'AI' })],
        userConfirmations: [{ field: 'title', confirmedValue: null }],
      });
      expect(result.value).toBe('AI');
    });

    it('10. empty latest AI value falls through to the latest valid older inference, then raw', () => {
      const withOlder = resolveMemoryField('title', {
        aiInferences: [
          inference({ id: 'a', valueJson: 'Older', createdAt: t1 }),
          inference({ id: 'b', valueJson: '', createdAt: t2 }),
        ],
        rawFallback: 'Raw',
      });
      expect(withOlder.value).toBe('Older');

      const onlyEmpty = resolveMemoryField('title', {
        aiInferences: [inference({ valueJson: ' ' })],
        rawFallback: 'Raw',
      });
      expect(onlyEmpty).toEqual({ value: 'Raw', source: 'original' });
    });

    it('11. 0 is a valid value', () => {
      const result = resolveMemoryField('price', {
        aiInferences: [inference({ field: 'price', valueJson: 5 })],
        userConfirmations: [{ field: 'price', confirmedValue: 0 }],
      });
      expect(result).toMatchObject({ value: 0, source: 'user' });
    });

    it('12. false is a valid value', () => {
      const result = resolveMemoryField('dateYearInferred', {
        aiInferences: [inference({ field: 'dateYearInferred', valueJson: false })],
      });
      expect(result).toMatchObject({ value: false, source: 'ai' });
    });

    it('13. empty array is absent', () => {
      const result = resolveMemoryField('topics', {
        aiInferences: [
          inference({ id: 'a', field: 'topics', valueJson: ['travel'], createdAt: t1 }),
          inference({ id: 'b', field: 'topics', valueJson: [], createdAt: t2 }),
        ],
      });
      expect(result.value).toEqual(['travel']);
    });

    it('14. non-empty structured values are valid', () => {
      const entities = { people: ['Ada'] };
      expect(
        resolveMemoryField('entities', {
          aiInferences: [inference({ field: 'entities', valueJson: entities })],
          shape: 'object',
        }).value,
      ).toBe(entities);
      expect(
        resolveMemoryField('topics', {
          aiInferences: [inference({ field: 'topics', valueJson: ['a', 'b'] })],
          shape: 'array',
        }).value,
      ).toEqual(['a', 'b']);
    });

    it('15. a malformed value for a typed field is ignored', () => {
      const result = resolveMemoryField('title', {
        aiInferences: [
          inference({ id: 'a', valueJson: 'Good', createdAt: t1 }),
          inference({ id: 'b', valueJson: { unexpected: true }, createdAt: t2 }),
          inference({ id: 'c', valueJson: ['x'], createdAt: t3 }),
        ],
        userConfirmations: [{ field: 'title', confirmedValue: 42 }],
        shape: 'string',
      });
      expect(result).toMatchObject({ value: 'Good', source: 'ai' });
    });

    it('applies presence rules to the raw fallback', () => {
      expect(resolveMemoryField('title', { rawFallback: '  ' })).toEqual({ value: null, source: 'none' });
      expect(resolveMemoryField('title', { rawFallback: null })).toEqual({ value: null, source: 'none' });
    });
  });

  describe('metadata', () => {
    it('16. returns AI metadata from the selected inference', () => {
      const result = resolveMemoryField('title', {
        aiInferences: [
          inference({ id: 'a', valueJson: 'Old', createdAt: t1, confidence: 0.99, modelVersion: 'old-model' }),
          inference({
            id: 'b',
            valueJson: 'New',
            createdAt: t2,
            confidence: 0.42,
            provenance: 'llm_extraction',
            modelVersion: 'new-model',
          }),
        ],
      });
      expect(result).toEqual({
        value: 'New',
        source: 'ai',
        confidence: 0.42,
        provenance: 'llm_extraction',
        modelVersion: 'new-model',
        inferredAt: t2,
      });
    });

    it('17. returns confirmation metadata without fabricating confidence', () => {
      const result = resolveMemoryField('title', {
        aiInferences: [inference({ valueJson: 'AI', confidence: 0.9 })],
        userConfirmations: [{ field: 'title', confirmedValue: 'User', createdAt: t2 }],
      });
      expect(result).toEqual({ value: 'User', source: 'user', confirmedAt: t2 });
      expect(result).not.toHaveProperty('confidence');
    });

    it('accepts ISO string timestamps', () => {
      const result = resolveMemoryField('title', {
        aiInferences: [
          inference({ id: 'a', valueJson: 'A', createdAt: t2.toISOString() }),
          inference({ id: 'b', valueJson: 'B', createdAt: t1.toISOString() }),
        ],
      });
      expect(result.value).toBe('A');
      expect(result.inferredAt).toEqual(t2);
    });
  });

  it('18. does not mutate its inputs', () => {
    const aiInferences = [
      inference({ id: 'a', valueJson: 'A', createdAt: t1 }),
      inference({ id: 'c', valueJson: 'C', createdAt: t3 }),
      inference({ id: 'b', valueJson: 'B', createdAt: t2 }),
    ];
    const userConfirmations = [
      { field: 'title', confirmedValue: '', createdAt: t1 },
      { field: 'date', confirmedValue: '2026-01-01', createdAt: t2 },
    ];
    const aiSnapshot = JSON.parse(JSON.stringify(aiInferences));
    const confSnapshot = JSON.parse(JSON.stringify(userConfirmations));
    Object.freeze(aiInferences);
    Object.freeze(userConfirmations);

    resolveMemoryField('title', { aiInferences, userConfirmations, rawFallback: 'Raw' });

    expect(JSON.parse(JSON.stringify(aiInferences))).toEqual(aiSnapshot);
    expect(JSON.parse(JSON.stringify(userConfirmations))).toEqual(confSnapshot);
    expect(aiInferences.map((row) => row.id)).toEqual(['a', 'c', 'b']);
  });

  it('keeps input order for legacy rows with no createdAt or id (first row wins)', () => {
    const result = resolveMemoryField('title', {
      aiInferences: [
        { field: 'title', valueJson: 'First' },
        { field: 'title', valueJson: 'Second' },
      ],
    });
    expect(result.value).toBe('First');
  });
});

describe('isPresentValue', () => {
  it.each([
    [null, false],
    [undefined, false],
    ['', false],
    ['   ', false],
    ['x', true],
    [[], false],
    [['x'], true],
    [{}, true],
    [0, true],
    [false, true],
  ])('any-shape %p → %p', (value, expected) => {
    expect(isPresentValue(value)).toBe(expected);
  });

  it('rejects values of the wrong shape', () => {
    expect(isPresentValue({}, 'string')).toBe(false);
    expect(isPresentValue(0, 'string')).toBe(false);
    expect(isPresentValue('x', 'array')).toBe(false);
    expect(isPresentValue(['x'], 'object')).toBe(false);
    expect(isPresentValue({ a: 1 }, 'object')).toBe(true);
    expect(isPresentValue(false, 'boolean')).toBe(true);
    expect(isPresentValue(0, 'number')).toBe(true);
    expect(isPresentValue(Number.NaN, 'number')).toBe(false);
  });
});

describe('ordering', () => {
  it('orders createdAt DESC then id DESC', () => {
    const rows = [
      { id: 'a', createdAt: t2 },
      { id: 'z', createdAt: t1 },
      { id: 'b', createdAt: t2 },
    ];
    expect([...rows].sort(compareLatestFirst).map((row) => row.id)).toEqual(['b', 'a', 'z']);
  });

  it('exposes the matching Prisma orderBy', () => {
    expect(LATEST_AI_INFERENCE_ORDER).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });
});
