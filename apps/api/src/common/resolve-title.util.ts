import { Prisma } from '@prisma/client';
import { ConfirmationInput, InferenceInput, resolveMemoryField } from './resolve-memory-field.util';

type MemoryWithTitleInferences = Prisma.MemoryGetPayload<{
  include: {
    aiInferences: true;
    userConfirmations: true;
  };
}>;

export function resolveTitle(memory: MemoryWithTitleInferences | null): string {
  if (!memory) return '';
  return resolveTitleFromFields(memory.title ?? '', memory.aiInferences, memory.userConfirmations);
}

type MemoryRow = {
  id: string;
  title: string;
  [key: string]: any;
};

export interface MemoryWithTitleFields extends MemoryRow {
  userConfirmations?: Array<{
    field: string;
    confirmedValue: string | null;
  }>;
  aiInferences?: Array<{
    field: string;
    valueJson: string | null;
  }>;
}

/**
 * Title precedence: user confirmation → latest AI title → raw Memory.title → ''.
 * Compatibility wrapper over resolveMemoryField; display placeholders stay with callers.
 */
export function resolveTitleFromFields(
  rawTitle: string,
  aiInferences: ReadonlyArray<InferenceInput> | null | undefined,
  userConfirmations: ReadonlyArray<ConfirmationInput> | null | undefined,
): string {
  const resolved = resolveMemoryField<string>('title', {
    aiInferences,
    userConfirmations,
    rawFallback: rawTitle,
    shape: 'string',
  });
  return resolved.value === null ? '' : String(resolved.value);
}
