import type { Memory, MemoryAsset, ProcessingStatus } from '@/src/api/client';

/**
 * User source screenshots (FACEBOOK-USER-EVIDENCE-01): when a shared link could not be read, the
 * owner can add a screenshot of it. It is the user's own evidence, never verified by the linked
 * site, and the UI says so.
 */

export const SOURCE_SCREENSHOT_ROLE = 'source_screenshot' as const;
export const LLM_USER_SOURCE_SCREENSHOT_PROVENANCE = 'llm_user_source_screenshot';

const FACEBOOK_HOSTS = ['facebook.com', 'fb.com', 'fb.watch', 'fb.me'];

/** Display-only host check for choosing copy; it grants nothing. */
export function isFacebookLink(url: string | undefined | null): boolean {
  if (!url) return false;
  let host: string;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  return FACEBOOK_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

export function isSourceScreenshotAsset(asset: Pick<MemoryAsset, 'evidenceRole'>): boolean {
  return asset.evidenceRole === SOURCE_SCREENSHOT_ROLE;
}

/**
 * Offer "Add screenshot" for a link Memory the app could not understand (partial), outside the
 * Vault (Vault reprocessing is not available), when no source screenshot has been added yet.
 */
export function shouldOfferSourceScreenshot(
  memory: Pick<Memory, 'sourceType' | 'sourceUri' | 'securityScope' | 'processingState' | 'assets'>,
  processingState?: ProcessingStatus['processingState'],
): boolean {
  const state = processingState ?? memory.processingState;
  return (
    memory.sourceType === 'url' &&
    !!memory.sourceUri &&
    state === 'partial' &&
    memory.securityScope !== 'vault' &&
    !(memory.assets ?? []).some(isSourceScreenshotAsset)
  );
}

export function sourceScreenshotPromptCopy(sourceUri: string | undefined | null): { title: string; body: string } {
  return isFacebookLink(sourceUri)
    ? {
        title: "Facebook only shared a link, so we couldn't read the post.",
        body: "Add a screenshot and we'll use that to help understand it.",
      }
    : {
        title: "We couldn't read this link.",
        body: "Add a screenshot of it and we'll use that to help understand it.",
      };
}

/**
 * True when the understanding currently shown (the AI title or summary) came from a run that used
 * a user source screenshot. Inferences arrive newest first from the detail endpoint.
 */
export function isUnderstandingFromSourceScreenshot(
  memory: Pick<Memory, 'aiInferences' | 'resolved'>,
): boolean {
  return (['summary', 'title'] as const).some((field) => {
    if (memory.resolved?.[field]?.source !== 'ai') return false;
    const latest = [...(memory.aiInferences ?? [])]
      .filter((inference) => inference.field === field)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))[0];
    return latest?.provenance === LLM_USER_SOURCE_SCREENSHOT_PROVENANCE;
  });
}

export function sourceScreenshotDisclosure(sourceUri: string | undefined | null): string {
  return isFacebookLink(sourceUri)
    ? 'Based on a screenshot you added. Not verified with Facebook.'
    : 'Based on a screenshot you added. Not verified with the linked site.';
}
