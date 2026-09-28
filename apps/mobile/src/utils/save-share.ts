import type { ResolvedSharePayload } from 'expo-sharing';
import { createMemory, reprocessMemory } from '@/src/api/client';
import { uploadPhotoToExistingMemory, uploadPhotoToMemory } from '@/src/utils/photo-upload';
import { memoryTextTooLongMessage, parseSharedText } from '@/src/utils/share-text';
import type { ShareAttempt } from '@/src/utils/share-dedupe';

/**
 * LOSSLESS-CAPTURE-01: save one share delivery as one Memory.
 *
 * Every payload the native layer delivered is considered (today: Android delivers exactly one;
 * iOS may deliver up to one text, one link and one image). Text and links follow parseSharedText;
 * one image is attached to the same Memory. Anything that cannot be saved is reported to the user,
 * never dropped silently.
 */
export interface SavedShare {
  memoryId: string;
  isUrl: boolean;
  /** What was not saved, for the user to see before continuing. Empty when everything was saved. */
  notices: string[];
}

export class ShareSaveError extends Error {
  /** Set when a Memory was created but part of the share could not be saved. */
  readonly memoryId?: string;

  constructor(message: string, memoryId?: string) {
    super(message);
    this.name = 'ShareSaveError';
    this.memoryId = memoryId;
  }
}

const TYPE_NAMES: Record<string, string> = {
  video: 'video',
  audio: 'audio file',
  file: 'file',
  image: 'image',
};

function describeUnsupported(payloads: ResolvedSharePayload[]): string {
  const counts = new Map<string, number>();
  for (const payload of payloads) {
    const name = TYPE_NAMES[payload.contentType ?? ''] ?? 'item';
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts]
    .map(([name, count]) => (count === 1 ? `1 ${name}` : `${count} ${name}s`))
    .join(', ');
}

function textOf(payload: ResolvedSharePayload): string {
  return (payload as any).value ?? (payload as any).text ?? '';
}

export async function saveSharedPayloads(
  token: string,
  payloads: ResolvedSharePayload[],
  attempt: ShareAttempt & { isUrl?: boolean },
): Promise<SavedShare> {
  // The same delivery already saved completely: reopen it, save nothing again.
  if (attempt.completed && attempt.memoryId) {
    return { memoryId: attempt.memoryId, isUrl: !!attempt.isUrl, notices: [] };
  }

  const texts = payloads.filter((p) => (p.contentType === 'text' || p.contentType === 'website') && textOf(p) !== '');
  const images = payloads.filter((p) => p.contentType === 'image' && !!p.contentUri);
  const unsupported = payloads.filter((p) => !texts.includes(p) && !images.includes(p) && !(p.contentType === 'text' || p.contentType === 'website'));

  if (texts.length === 0 && images.length === 0) {
    throw new ShareSaveError(
      unsupported.length > 0
        ? `Nothing was saved: ${describeUnsupported(unsupported)} can't be saved yet.`
        : 'Nothing was saved: the share was empty.',
    );
  }

  const notices: string[] = [];
  if (unsupported.length > 0) {
    notices.push(`Not saved: ${describeUnsupported(unsupported)} (not supported yet).`);
  }
  if (images.length > 1) {
    notices.push(`Not saved: ${describeUnsupported(images.slice(1))} (one image per share is supported).`);
  }
  const image = images[0];

  // Each delivered text is kept whole; several (iOS: page text and link) become one text.
  const text = texts.map(textOf).join('\n');
  const parsed = text ? parseSharedText(text) : undefined;
  if (parsed?.kind === 'too_long') {
    // Strict rejection: nothing from this share is saved, not even an image.
    throw new ShareSaveError(memoryTextTooLongMessage(text));
  }
  const memoryText = parsed?.kind === 'memory' ? parsed : undefined;

  if (!memoryText) {
    if (!image) throw new ShareSaveError('Nothing was saved: the shared text was empty.');
    const memoryId =
      attempt.memoryId ??
      (await uploadPhotoToMemory(
        token,
        image.contentUri!,
        image.contentMimeType || 'image/jpeg',
        image.originalName || 'shared-image.jpg',
        undefined,
        undefined,
        attempt.idempotencyKey,
      ));
    attempt.memoryId = memoryId;
    attempt.imageUploaded = true;
    attempt.isUrl = false;
    attempt.completed = true;
    return { memoryId, isUrl: false, notices };
  }

  const isUrl = memoryText.sourceType === 'url';
  if (!attempt.memoryId) {
    // With an image, text without a single link is an image Memory with the text as its body
    // (the upload below then starts the analysis). A link stays a url Memory.
    const sourceType = image && !isUrl ? 'image' : memoryText.sourceType;
    const memory = await createMemory(
      token,
      sourceType,
      attempt.idempotencyKey,
      memoryText.sourceUri,
      memoryText.title,
      undefined,
      undefined,
      memoryText.body,
    );
    attempt.memoryId = memory.id;
  }
  const memoryId = attempt.memoryId;
  attempt.isUrl = isUrl;

  if (image && !attempt.imageUploaded) {
    try {
      await uploadPhotoToExistingMemory(token, memoryId, image.contentUri!, image.contentMimeType || 'image/jpeg');
      attempt.imageUploaded = true;
    } catch {
      if (!isUrl) {
        // An image Memory is analyzed once its image arrives; without it, analyze the text so the
        // Memory does not stay queued. Best effort: the error below is shown either way.
        await reprocessMemory(token, memoryId).catch(() => undefined);
      }
      throw new ShareSaveError('Your text was saved, but the image could not be uploaded.', memoryId);
    }
    if (isUrl) {
      // A url Memory was queued when it was created; queue it again so the image is included.
      try {
        await reprocessMemory(token, memoryId);
      } catch {
        notices.push('The image was saved but is not being analyzed yet. Open the memory to try again.');
      }
    }
  }

  attempt.completed = true;
  return { memoryId, isUrl, notices };
}
