import { Prisma } from '@prisma/client';

type MemoryWithTitleInferences = Prisma.MemoryGetPayload<{
  include: {
    aiInferences: true;
    userConfirmations: true;
  };
}>;

export function resolveTitle(memory: MemoryWithTitleInferences | null): string {
  if (!memory) return '';

  const userConfirmation = memory.userConfirmations?.find(
    (c: (typeof memory.userConfirmations)[number]) => c.field === 'title',
  );
  if (userConfirmation && userConfirmation.confirmedValue) {
    return String(userConfirmation.confirmedValue);
  }

  const aiInference = memory.aiInferences?.find(
    (i: (typeof memory.aiInferences)[number]) => i.field === 'title',
  );
  if (aiInference && aiInference.valueJson) {
    return String(aiInference.valueJson);
  }

  return memory.title || '';
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

export function resolveTitleFromFields(
  rawTitle: string,
  aiInferences: Array<{ field: string; valueJson: any }> | null | undefined,
  userConfirmations: Array<{ field: string; confirmedValue: any }> | null | undefined,
): string {
  const userConfirmation = userConfirmations?.find((c) => c.field === 'title');
  if (userConfirmation && userConfirmation.confirmedValue) {
    return String(userConfirmation.confirmedValue);
  }

  const aiInference = aiInferences?.find((i) => i.field === 'title');
  if (aiInference && aiInference.valueJson) {
    return String(aiInference.valueJson);
  }

  return rawTitle || '';
}
