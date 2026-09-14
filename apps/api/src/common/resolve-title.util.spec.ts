import { resolveTitle, resolveTitleFromFields } from './resolve-title.util';
import { Prisma } from '@prisma/client';

describe('resolveTitle', () => {
  it('should return user confirmation value when present', () => {
    const memory = {
      id: 'mem1',
      title: 'Original Title',
      aiInferences: [],
      userConfirmations: [
        {
          id: 'uc1',
          memoryId: 'mem1',
          field: 'title',
          confirmedValue: 'User Confirmed Title',
          createdAt: new Date(),
        },
      ],
    } as any;

    const result = resolveTitle(memory);
    expect(result).toBe('User Confirmed Title');
  });

  it('should fall back to AI inference when no user confirmation', () => {
    const memory = {
      id: 'mem1',
      title: 'Original Title',
      aiInferences: [
        {
          id: 'ai1',
          memoryId: 'mem1',
          field: 'title',
          valueJson: 'AI Extracted Title',
          confidence: 0.95,
          createdAt: new Date(),
        },
      ],
      userConfirmations: [],
    } as any;

    const result = resolveTitle(memory);
    expect(result).toBe('AI Extracted Title');
  });

  it('should fall back to raw title when neither confirmation nor inference present', () => {
    const memory = {
      id: 'mem1',
      title: 'Raw Memory Title',
      aiInferences: [],
      userConfirmations: [],
    } as any;

    const result = resolveTitle(memory);
    expect(result).toBe('Raw Memory Title');
  });

  it('should return empty string when memory is null', () => {
    const result = resolveTitle(null);
    expect(result).toBe('');
  });

  it('should prioritize user confirmation over AI inference', () => {
    const memory = {
      id: 'mem1',
      title: 'Original Title',
      aiInferences: [
        {
          id: 'ai1',
          memoryId: 'mem1',
          field: 'title',
          valueJson: 'AI Title',
          confidence: 0.95,
          createdAt: new Date(),
        },
      ],
      userConfirmations: [
        {
          id: 'uc1',
          memoryId: 'mem1',
          field: 'title',
          confirmedValue: 'User Title',
          createdAt: new Date(),
        },
      ],
    } as any;

    const result = resolveTitle(memory);
    expect(result).toBe('User Title');
  });

  it('should ignore other fields and only use title field', () => {
    const memory = {
      id: 'mem1',
      title: 'Original Title',
      aiInferences: [
        {
          id: 'ai1',
          memoryId: 'mem1',
          field: 'location',
          valueJson: 'Some Location',
          confidence: 0.95,
          createdAt: new Date(),
        },
      ],
      userConfirmations: [],
    } as any;

    const result = resolveTitle(memory);
    expect(result).toBe('Original Title');
  });
});

describe('resolveTitleFromFields', () => {
  it('should return user confirmation value when present', () => {
    const result = resolveTitleFromFields(
      'Raw Title',
      [],
      [{ field: 'title', confirmedValue: 'Confirmed Title' }],
    );
    expect(result).toBe('Confirmed Title');
  });

  it('should fall back to AI inference when no user confirmation', () => {
    const result = resolveTitleFromFields(
      'Raw Title',
      [{ field: 'title', valueJson: 'AI Title' }],
      [],
    );
    expect(result).toBe('AI Title');
  });

  it('should fall back to raw title when no inferences or confirmations', () => {
    const result = resolveTitleFromFields('Raw Title', [], []);
    expect(result).toBe('Raw Title');
  });

  it('should return empty string when all are empty', () => {
    const result = resolveTitleFromFields('', undefined, undefined);
    expect(result).toBe('');
  });

  it('should prioritize user confirmation over AI inference', () => {
    const result = resolveTitleFromFields(
      'Raw Title',
      [{ field: 'title', valueJson: 'AI Title' }],
      [{ field: 'title', confirmedValue: 'Confirmed Title' }],
    );
    expect(result).toBe('Confirmed Title');
  });

  it('should ignore non-title fields in inferences', () => {
    const result = resolveTitleFromFields(
      'Raw Title',
      [
        { field: 'location', valueJson: 'Some Location' },
        { field: 'date', valueJson: '2026-01-01' },
      ],
      [],
    );
    expect(result).toBe('Raw Title');
  });

  it('should ignore non-title fields in confirmations', () => {
    const result = resolveTitleFromFields(
      'Raw Title',
      [],
      [
        { field: 'location', confirmedValue: 'Some Location' },
        { field: 'date', confirmedValue: '2026-01-01' },
      ],
    );
    expect(result).toBe('Raw Title');
  });

  it('should handle null confirmedValue', () => {
    const result = resolveTitleFromFields(
      'Raw Title',
      [{ field: 'title', valueJson: 'AI Title' }],
      [{ field: 'title', confirmedValue: null }],
    );
    expect(result).toBe('AI Title');
  });

  it('should handle null valueJson', () => {
    const result = resolveTitleFromFields(
      'Raw Title',
      [{ field: 'title', valueJson: null }],
      [],
    );
    expect(result).toBe('Raw Title');
  });
});
