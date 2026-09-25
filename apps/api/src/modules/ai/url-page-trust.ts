// Pure trust rules for deciding whether a fetched Facebook page actually represents the
// shared content, or is a login/checkpoint/consent/generic interstitial page that must not
// be used as evidence for a Memory. No I/O: callers supply the final URL and page signals.

const FACEBOOK_FAMILY_DOMAINS = ['facebook.com', 'fb.com', 'fb.watch', 'fb.me'];

const INTERSTITIAL_PATH =
  /^\/(?:login(?:\.php)?|checkpoint|recover|r\.php|reg|consent|privacy\/consent|dialog\/cookie[^/]*|unsupportedbrowser)(?:\/|$)/i;

const CONTENT_PATH =
  /\/(?:posts|permalink\.php|story\.php|photo(?:\.php)?|photos|videos|watch|reel|events|marketplace\/item|share\/[prv])(?:\/|$)/i;

const GENERIC_TITLE =
  /^(?:log ?in|log into|sign up|you must log in|security check|checkpoint|content not found|this (?:content|page) isn.t available|page not found|sorry,? something went wrong|error)\b/i;

const GENERIC_DESCRIPTION = [
  /^log ?in(?:to)? (?:to )?facebook/i,
  /^see posts, photos and more on facebook/i,
  /^create an account or log ?in/i,
  /log ?in or sign up/i,
];

export type PageRejectReason =
  | 'FINAL_PATH_INTERSTITIAL'
  | 'CANONICAL_INTERSTITIAL'
  | 'LOGIN_OR_CHECKPOINT_MARKERS'
  | 'GENERIC_TITLE'
  | 'INSUFFICIENT_CONTENT_EVIDENCE';

export interface PageMarkers {
  hasLoginForm: boolean;
  hasCheckpointForm: boolean;
  hasConsentDialog: boolean;
}

export interface FacebookPageSignals {
  finalUrl: URL;
  title?: string;
  description?: string;
  ogUrl?: string;
  canonicalUrl?: string;
  markers: PageMarkers;
}

export type PageTrustDecision =
  | { trusted: true }
  | { trusted: false; reason: PageRejectReason };

export function isFacebookFamilyHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return FACEBOOK_FAMILY_DOMAINS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

function parseHostname(urlString: string): string | null {
  try {
    return new URL(urlString).hostname;
  } catch {
    return null;
  }
}

// Recognises Facebook-family URLs by exact host match, including scheme-less shares such as
// "www.facebook.com/share/p/..." (retried with https://).
export function isFacebookFamilyUrl(urlString: string): boolean {
  const trimmed = urlString.trim();
  let hostname = parseHostname(trimmed);
  if (!hostname && !/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    hostname = parseHostname(`https://${trimmed}`);
  }
  return !!hostname && isFacebookFamilyHost(hostname);
}

function isInterstitialLocation(url: URL): boolean {
  return url.hostname.toLowerCase() === 'login.facebook.com' || INTERSTITIAL_PATH.test(url.pathname);
}

function resolveFacebookUrl(value: string | undefined, base: URL): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value, base);
    return isFacebookFamilyHost(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

export function isGenericFacebookTitle(title: string | undefined): boolean {
  const normalized = (title ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*[|\-–—]\s*facebook$/i, '')
    .trim()
    .toLowerCase();

  if (normalized === '' || normalized === 'facebook') return true;
  if (/^facebook\s*[|\-–—:]\s*(?:log ?in|sign up)/.test(normalized)) return true;
  return GENERIC_TITLE.test(normalized);
}

function isGenericFacebookDescription(description: string | undefined): boolean {
  const normalized = (description ?? '').replace(/\s+/g, ' ').trim();
  if (normalized === '') return true;
  return GENERIC_DESCRIPTION.some((pattern) => pattern.test(normalized));
}

export function evaluateFacebookPageTrust(signals: FacebookPageSignals): PageTrustDecision {
  const { finalUrl, title, description, markers } = signals;

  if (isInterstitialLocation(finalUrl)) {
    return { trusted: false, reason: 'FINAL_PATH_INTERSTITIAL' };
  }

  const declaredUrls = [signals.ogUrl, signals.canonicalUrl]
    .map((value) => resolveFacebookUrl(value, finalUrl))
    .filter((url): url is URL => url !== null);

  if (declaredUrls.some((url) => url.pathname === '/' || isInterstitialLocation(url))) {
    return { trusted: false, reason: 'CANONICAL_INTERSTITIAL' };
  }

  const hasContentUrl = declaredUrls.some((url) => CONTENT_PATH.test(url.pathname));
  const hasSpecificText =
    !isGenericFacebookTitle(title) && !isGenericFacebookDescription(description);
  const hasPositiveEvidence = hasContentUrl || hasSpecificText;

  // A login/checkpoint/consent page can still declare a content og:url or canonical, so when
  // such markers are present only specific (non-generic) page text counts as evidence.
  if (
    (markers.hasLoginForm || markers.hasCheckpointForm || markers.hasConsentDialog) &&
    !hasSpecificText
  ) {
    return { trusted: false, reason: 'LOGIN_OR_CHECKPOINT_MARKERS' };
  }

  if (isGenericFacebookTitle(title)) {
    return { trusted: false, reason: 'GENERIC_TITLE' };
  }

  if (!hasPositiveEvidence) {
    return { trusted: false, reason: 'INSUFFICIENT_CONTENT_EVIDENCE' };
  }

  return { trusted: true };
}

export function hostOf(urlString: string): string {
  try {
    return new URL(urlString).hostname || '(no-host)';
  } catch {
    return '(invalid-url)';
  }
}
