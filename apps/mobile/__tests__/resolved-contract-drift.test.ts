import fs from 'fs';
import path from 'path';
import { CANONICAL_MEMORY_TYPES, RESOLVED_MEMORY_FIELDS } from '@/src/api/resolved';

// Mobile mirrors the public Resolved Memory contract instead of depending on @memory-app/domain.
// This reads both source files as text (no runtime import of the domain package) and fails when
// the mirror drifts from the API contract.
const DOMAIN_SOURCE = path.join(__dirname, '..', '..', '..', 'packages', 'domain', 'src', 'resolved-memory.ts');
const MOBILE_SOURCE = path.join(__dirname, '..', 'src', 'api', 'resolved.ts');

const read = (file: string) => fs.readFileSync(file, 'utf8');

function canonicalTypes(source: string): string[] {
  const body = source.match(/CANONICAL_MEMORY_TYPES = \[([\s\S]*?)\] as const/);
  if (!body) throw new Error('CANONICAL_MEMORY_TYPES not found');
  return [...body[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
}

function fieldValueTypes(source: string): Record<string, string> {
  const body = source.match(/interface ResolvedMemoryFieldValues \{([\s\S]*?)\n\}/);
  if (!body) throw new Error('ResolvedMemoryFieldValues not found');
  return Object.fromEntries(
    [...body[1].matchAll(/^\s*(\w+): ([^;]+);/gm)].map((m) => [m[1], m[2].trim()]),
  );
}

function sourceUnion(source: string): string {
  const match = source.match(/export type ResolvedSource = ([^;]+);/);
  if (!match) throw new Error('ResolvedSource not found');
  return match[1].replace(/\s+/g, ' ').trim();
}

function fieldViewKeys(source: string): string[] {
  const body = source.match(/interface ResolvedFieldView<T> \{([\s\S]*?)\n\}/);
  if (!body) throw new Error('ResolvedFieldView not found');
  return [...body[1].matchAll(/^\s*(\w+): /gm)].map((m) => m[1]);
}

describe('Resolved Memory contract drift guard', () => {
  const domain = read(DOMAIN_SOURCE);
  const mobile = read(MOBILE_SOURCE);

  it('mirrors the canonical memory types', () => {
    expect(canonicalTypes(domain)).toEqual([...CANONICAL_MEMORY_TYPES]);
    expect(canonicalTypes(mobile)).toEqual(canonicalTypes(domain));
  });

  it('mirrors every resolved field name and value type', () => {
    expect(fieldValueTypes(mobile)).toEqual(fieldValueTypes(domain));
    expect([...RESOLVED_MEMORY_FIELDS].sort()).toEqual(Object.keys(fieldValueTypes(domain)).sort());
  });

  it('mirrors the field view shape and source values', () => {
    expect(sourceUnion(mobile)).toBe(sourceUnion(domain));
    expect(fieldViewKeys(mobile)).toEqual(fieldViewKeys(domain));
    expect(fieldViewKeys(domain)).toEqual(['value', 'source', 'confidence']);
  });
});
