/**
 * LOSSLESS-CAPTURE-01: turning text the user types or shares into what a Memory stores.
 *
 * What the user saves is preserved completely or explicitly rejected: the full text is sent as
 * `body` exactly as received (never trimmed or truncated), and `title` is only a short display
 * line derived from it.
 */

/** Same limit as the API (MAX_MEMORY_TEXT); longer text is rejected, never truncated. */
export const MAX_MEMORY_TEXT = 20_000;

/** Display titles derived from text stay within the previous title length. */
export const MAX_DERIVED_TITLE = 100;

/** Length in Unicode code points, as the API and PostgreSQL char_length() count it. */
export function memoryTextLength(text: string): number {
  return Array.from(text).length;
}

export function isOverMemoryTextLimit(text: string): boolean {
  return memoryTextLength(text) > MAX_MEMORY_TEXT;
}

export function memoryTextTooLongMessage(text: string): string {
  return (
    `This text is too long to save (${memoryTextLength(text).toLocaleString('en-US')} characters; ` +
    `the limit is ${MAX_MEMORY_TEXT.toLocaleString('en-US')}). Nothing was saved.`
  );
}

// http(s):// or www. up to whitespace or a character that cannot be part of a shared link.
const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?]$/;
const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

/**
 * Remove sentence punctuation after a link ("...post." / "...post!"), and a closing bracket only
 * when the link does not contain its opening bracket ("(see https://x.com/a)" vs
 * "https://en.wikipedia.org/wiki/Foo_(bar)").
 */
function trimUrlEnd(candidate: string): string {
  let url = candidate;
  for (;;) {
    const last = url.slice(-1);
    if (TRAILING_PUNCTUATION.test(last)) {
      url = url.slice(0, -1);
      continue;
    }
    const opener = CLOSERS[last];
    if (opener) {
      const opens = url.split(opener).length - 1;
      const closes = url.split(last).length - 1;
      if (closes > opens) {
        url = url.slice(0, -1);
        continue;
      }
    }
    return url;
  }
}

export interface FoundUrl {
  /** The link exactly as it appears in the text. */
  raw: string;
  /** What is stored as sourceUri: www. links get https://. */
  normalized: string;
  index: number;
}

export function findUrls(text: string): FoundUrl[] {
  const found: FoundUrl[] = [];
  for (const match of text.matchAll(URL_PATTERN)) {
    const raw = trimUrlEnd(match[0]);
    // "www." alone, or a scheme with nothing after it, is not a link.
    if (/^(?:https?:\/\/|www\.)$/i.test(raw)) continue;
    found.push({ raw, normalized: /^www\./i.test(raw) ? `https://${raw}` : raw, index: match.index ?? 0 });
  }
  return found;
}

// Anything but whitespace and ASCII punctuation counts as meaningful (letters, digits, emoji...).
const MEANINGFUL = /[^\s!-/:-@[-`{-~]/u;

export function hasMeaningfulText(text: string): boolean {
  return MEANINGFUL.test(text);
}

function withoutUrls(text: string, urls: FoundUrl[]): string {
  let result = text;
  for (const url of [...urls].sort((a, b) => b.index - a.index)) {
    result = result.slice(0, url.index) + ' ' + result.slice(url.index + url.raw.length);
  }
  return result;
}

/**
 * First meaningful line (else the first non-blank one), whitespace collapsed, at most
 * MAX_DERIVED_TITLE code points.
 */
export function deriveTitle(text: string): string | undefined {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim());
  const line = lines.find((l) => hasMeaningfulText(l)) ?? lines.find((l) => l !== '');
  if (!line) return undefined;
  const chars = Array.from(line);
  return chars.length > MAX_DERIVED_TITLE ? `${chars.slice(0, MAX_DERIVED_TITLE - 1).join('')}…` : line;
}

export type SharedTextParse =
  /** Only whitespace: there is nothing to save. */
  | { kind: 'empty' }
  | { kind: 'too_long'; length: number }
  | {
      kind: 'memory';
      sourceType: 'url' | 'text';
      sourceUri?: string;
      /** Full original text, unmodified. Absent only for a bare link. */
      body?: string;
      title: string;
    };

/**
 * Deterministic rules for shared text:
 * A. exactly one link and nothing else meaningful -> url Memory, no body (as before);
 * B. one link plus other text -> url Memory with the full text as body, title from the other text;
 * C. no link -> text Memory with the full text as body;
 * D. two or more links -> text Memory with the full text as body and no source link (no link is
 *    chosen arbitrarily).
 */
export function parseSharedText(text: string): SharedTextParse {
  if (text.trim() === '') return { kind: 'empty' };
  if (isOverMemoryTextLimit(text)) return { kind: 'too_long', length: memoryTextLength(text) };

  const urls = findUrls(text);
  if (urls.length === 1) {
    const [url] = urls;
    const rest = withoutUrls(text, urls);
    if (!hasMeaningfulText(rest)) {
      return { kind: 'memory', sourceType: 'url', sourceUri: url.normalized, title: url.normalized };
    }
    return {
      kind: 'memory',
      sourceType: 'url',
      sourceUri: url.normalized,
      body: text,
      title: deriveTitle(rest) ?? url.normalized,
    };
  }

  const title = deriveTitle(withoutUrls(text, urls)) ?? deriveTitle(text) ?? text.trim();
  return { kind: 'memory', sourceType: 'text', body: text, title };
}
