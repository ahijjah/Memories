import {
  MAX_DERIVED_TITLE,
  MAX_MEMORY_TEXT,
  deriveTitle,
  findUrls,
  isOverMemoryTextLimit,
  memoryTextLength,
  memoryTextTooLongMessage,
  parseSharedText,
} from '@/src/utils/share-text';

// LOSSLESS-CAPTURE-01: deterministic, lossless handling of shared/typed text.
describe('parseSharedText', () => {
  it('A. one bare URL: url Memory, no body, title = link (current behavior)', () => {
    expect(parseSharedText('https://example.com/post')).toEqual({
      kind: 'memory',
      sourceType: 'url',
      sourceUri: 'https://example.com/post',
      title: 'https://example.com/post',
    });
  });

  it('A. surrounding whitespace or sentence punctuation alone is not "other text"', () => {
    expect(parseSharedText('  https://example.com/post.\n')).toMatchObject({ sourceType: 'url', sourceUri: 'https://example.com/post' });
    expect(parseSharedText('  https://example.com/post.\n')).not.toHaveProperty('body');
  });

  it('B. text + one URL: url Memory, full original text as body, title from the other text', () => {
    const text = 'Look at this https://example.com/post';
    expect(parseSharedText(text)).toEqual({
      kind: 'memory',
      sourceType: 'url',
      sourceUri: 'https://example.com/post',
      body: text,
      title: 'Look at this',
    });
  });

  it('B. caption on its own line', () => {
    const text = 'Interesting post\nhttps://example.com/post';
    expect(parseSharedText(text)).toMatchObject({ sourceType: 'url', sourceUri: 'https://example.com/post', body: text, title: 'Interesting post' });
  });

  it('B. emoji counts as meaningful text', () => {
    const text = '🔥 https://example.com/post';
    expect(parseSharedText(text)).toMatchObject({ sourceType: 'url', body: text, title: '🔥' });
  });

  it('B. www. link normalized for sourceUri only; the body keeps it as written', () => {
    const text = 'Recipe: www.example.com/soup';
    expect(parseSharedText(text)).toMatchObject({ sourceType: 'url', sourceUri: 'https://www.example.com/soup', body: text });
  });

  it('C. no URL: text Memory, full text as body, title = first useful line', () => {
    const text = '\n\n  Shopping list  \n- milk\n- eggs\n';
    expect(parseSharedText(text)).toEqual({ kind: 'memory', sourceType: 'text', body: text, title: 'Shopping list' });
  });

  it('C. punctuation-only text is still saved (only blank text is empty)', () => {
    expect(parseSharedText('...')).toEqual({ kind: 'memory', sourceType: 'text', body: '...', title: '...' });
    expect(parseSharedText('  \n\t ')).toEqual({ kind: 'empty' });
  });

  it('D. two or more URLs: text Memory, no source link chosen, full body', () => {
    const text = 'Compare https://a.example/x and https://b.example/y';
    const parsed = parseSharedText(text);
    expect(parsed).toEqual({ kind: 'memory', sourceType: 'text', body: text, title: 'Compare and' });
    expect(parsed).not.toHaveProperty('sourceUri');
  });

  it('D. only links: the title falls back to the first line', () => {
    const text = 'https://a.example/x https://b.example/y';
    expect(parseSharedText(text)).toMatchObject({ sourceType: 'text', body: text, title: text });
  });

  it('the body is always the exact input string (no trimming, no normalization)', () => {
    for (const text of [
      'Look at this https://example.com/post  ',
      '\tTabbed\r\nWindows lines https://example.com/a',
      'Plain note with trailing spaces   ',
      'a https://a.com b www.b.com',
      'Ünïcödé 😀 ❤️ note',
    ]) {
      const parsed = parseSharedText(text);
      expect(parsed.kind === 'memory' && parsed.body).toBe(text);
    }
  });

  it('exactly 20,000 characters is kept whole; 20,001 is rejected, never cut', () => {
    const max = 'x'.repeat(MAX_MEMORY_TEXT);
    expect(parseSharedText(max)).toMatchObject({ kind: 'memory', body: max });
    expect(parseSharedText(`${max}y`)).toEqual({ kind: 'too_long', length: MAX_MEMORY_TEXT + 1 });
  });

  it('the limit counts code points, like the API and PostgreSQL', () => {
    expect(MAX_MEMORY_TEXT).toBe(20_000);
    expect(memoryTextLength('😀')).toBe(1);
    expect(memoryTextLength('❤️')).toBe(2);
    expect(isOverMemoryTextLimit('😀'.repeat(MAX_MEMORY_TEXT))).toBe(false);
    expect(isOverMemoryTextLimit('😀'.repeat(MAX_MEMORY_TEXT + 1))).toBe(true);
    expect(memoryTextTooLongMessage('a'.repeat(20_001))).toBe(
      'This text is too long to save (20,001 characters; the limit is 20,000). Nothing was saved.',
    );
  });
});

describe('findUrls: conservative trailing punctuation', () => {
  it.each([
    ['https://x.com/a.', 'https://x.com/a'],
    ['https://x.com/a,', 'https://x.com/a'],
    ['(see https://x.com/a)', 'https://x.com/a'],
    ['https://en.wikipedia.org/wiki/Foo_(bar)', 'https://en.wikipedia.org/wiki/Foo_(bar)'],
    ['https://x.com/a?b=1&c=2!', 'https://x.com/a?b=1&c=2'],
    ['"https://x.com/q"', 'https://x.com/q'],
    ['https://x.com/path/', 'https://x.com/path/'],
  ])('%s -> %s', (text, expected) => {
    expect(findUrls(text).map((u) => u.normalized)).toEqual([expected]);
  });

  it('"www." or a bare scheme is not a link', () => {
    expect(findUrls('see www. and https:// later')).toEqual([]);
  });
});

describe('deriveTitle', () => {
  it('bounded to the previous 100-character title limit, marked when shortened', () => {
    const title = deriveTitle('y'.repeat(250))!;
    expect(Array.from(title)).toHaveLength(MAX_DERIVED_TITLE);
    expect(title.endsWith('…')).toBe(true);
  });

  it('does not split an emoji', () => {
    const title = deriveTitle('😀'.repeat(150))!;
    expect(Array.from(title)).toHaveLength(MAX_DERIVED_TITLE);
    expect(title.startsWith('😀'.repeat(99))).toBe(true);
  });
});
