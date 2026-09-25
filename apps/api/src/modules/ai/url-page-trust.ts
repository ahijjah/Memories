// Pure trust rules for deciding whether a fetched Facebook page actually represents the
// shared content, or is a login/checkpoint/consent/generic interstitial page that must not
// be used as evidence for a Memory. No I/O: callers supply the final URL and page signals.

const FACEBOOK_FAMILY_DOMAINS = ['facebook.com', 'fb.com', 'fb.watch', 'fb.me'];

const INTERSTITIAL_PATH =
  /^\/(?:login(?:\.php)?|checkpoint|recover|r\.php|reg|consent|privacy\/consent|dialog\/cookie[^/]*|unsupportedbrowser)(?:\/|$)/i;

// Hosts whose every URL is a short link / redirect wrapper, never the content itself.
const WRAPPER_HOSTS = ['fb.me', 'fb.watch', 'l.facebook.com', 'lm.facebook.com'];
const WRAPPER_PATH = /^\/(?:share(?:\/|$)|l\.php$)/i;

// Strict, anchored item taxonomy: each pattern names ONE content item and requires its ID.
// Anything not recognised here (profiles, pages, ID-less tabs, unknown formats) fails closed.
// pfbid IDs are accepted only where evidenced (post paths and story_fbid); elsewhere digits only.
const DIGITS_ID = '\\d+';
const POST_ID = '(?:\\d+|pfbid[0-9A-Za-z]+)';
const NAME = '[^/]+';
const ITEM_PATHS: RegExp[] = [
  new RegExp(`^/${NAME}/posts/${POST_ID}/?$`, 'i'),
  new RegExp(`^/${NAME}/photos/(?:[^/]+/)?${DIGITS_ID}/?$`, 'i'),
  new RegExp(`^/${NAME}/videos/(?:[^/]+/)?${DIGITS_ID}/?$`, 'i'),
  new RegExp(`^/reel/${DIGITS_ID}/?$`, 'i'),
  new RegExp(`^/groups/${NAME}/(?:posts|permalink)/${DIGITS_ID}/?$`, 'i'),
  new RegExp(`^/events/${DIGITS_ID}/?$`, 'i'),
  new RegExp(`^/marketplace/item/${DIGITS_ID}/?$`, 'i'),
];
// Item formats identified by a query parameter rather than the path.
const ITEM_QUERY_PATHS: { path: RegExp; param: string; id: RegExp }[] = [
  { path: /^\/(?:permalink|story)\.php$/i, param: 'story_fbid', id: new RegExp(`^${POST_ID}$`, 'i') },
  { path: /^\/photo(?:\.php)?\/?$/i, param: 'fbid', id: new RegExp(`^${DIGITS_ID}$`) },
  { path: /^\/watch\/?$/i, param: 'v', id: new RegExp(`^${DIGITS_ID}$`) },
];

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
  | 'PROFILE_OR_PAGE_LANDING'
  | 'NO_CONTENT_ITEM'
  | 'INSUFFICIENT_CONTENT_EVIDENCE'
  | 'FACEBOOK_DENY_BY_DEFAULT';

export type FacebookUrlClass = 'ITEM' | 'WRAPPER' | 'PROFILE_OR_PAGE' | 'ROOT' | 'INTERSTITIAL';

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

/**
 * Classifies a Facebook-family URL by what it identifies. Only ITEM names one specific
 * content item; unknown formats fall through to PROFILE_OR_PAGE (fail closed).
 */
export function classifyFacebookUrl(url: URL): FacebookUrlClass {
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (isInterstitialLocation(url)) return 'INTERSTITIAL';
  if (WRAPPER_HOSTS.some((wrapper) => host === wrapper || host.endsWith(`.${wrapper}`))) {
    return 'WRAPPER';
  }

  const path = url.pathname;
  if (path === '' || path === '/') return 'ROOT';
  if (WRAPPER_PATH.test(path)) return 'WRAPPER';
  if (ITEM_PATHS.some((pattern) => pattern.test(path))) return 'ITEM';
  for (const { path: pattern, param, id } of ITEM_QUERY_PATHS) {
    if (pattern.test(path) && id.test(url.searchParams.get(param) ?? '')) return 'ITEM';
  }
  return 'PROFILE_OR_PAGE';
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

function hasAnyMarker(markers: PageMarkers): boolean {
  return markers.hasLoginForm || markers.hasCheckpointForm || markers.hasConsentDialog;
}

/**
 * Trust rules for a fetched Facebook-family page. Specific-looking text alone never establishes
 * trust: the page must be identified as ONE specific content item by an authoritative signal.
 *
 * Authority:
 * - final URL (the page actually read): ITEM is identity; WRAPPER is neutral and must be
 *   justified by a canonical ITEM; PROFILE_OR_PAGE / ROOT rejects (never superseded).
 * - canonical: authoritative. ITEM establishes/confirms identity; PROFILE_OR_PAGE contradicts
 *   and rejects; WRAPPER establishes nothing.
 * - og:url: supporting only. It never establishes identity on its own and a PROFILE_OR_PAGE
 *   og:url does not veto an item identified by final/canonical.
 * - ROOT/INTERSTITIAL from either declared URL keeps rejecting (existing interstitial rule).
 */
export function evaluateFacebookPageTrust(signals: FacebookPageSignals): PageTrustDecision {
  const { finalUrl, title, description, markers } = signals;

  if (isInterstitialLocation(finalUrl)) {
    return { trusted: false, reason: 'FINAL_PATH_INTERSTITIAL' };
  }

  const canonical = resolveFacebookUrl(signals.canonicalUrl, finalUrl);
  const og = resolveFacebookUrl(signals.ogUrl, finalUrl);

  if ([canonical, og].some((url) => url && (url.pathname === '/' || isInterstitialLocation(url)))) {
    return { trusted: false, reason: 'CANONICAL_INTERSTITIAL' };
  }

  const hasSpecificText =
    !isGenericFacebookTitle(title) && !isGenericFacebookDescription(description);

  // A login/checkpoint/consent page can declare content-looking URLs, so require specific text.
  if (hasAnyMarker(markers) && !hasSpecificText) {
    return { trusted: false, reason: 'LOGIN_OR_CHECKPOINT_MARKERS' };
  }

  if (isGenericFacebookTitle(title)) {
    return { trusted: false, reason: 'GENERIC_TITLE' };
  }

  const finalClass = classifyFacebookUrl(finalUrl);
  const canonicalClass = canonical ? classifyFacebookUrl(canonical) : null;

  if (finalClass === 'PROFILE_OR_PAGE' || canonicalClass === 'PROFILE_OR_PAGE') {
    return { trusted: false, reason: 'PROFILE_OR_PAGE_LANDING' };
  }

  const identifiesItem =
    finalClass === 'ITEM' || (finalClass === 'WRAPPER' && canonicalClass === 'ITEM');
  if (!identifiesItem) {
    return { trusted: false, reason: 'NO_CONTENT_ITEM' };
  }

  if (isGenericFacebookDescription(description)) {
    return { trusted: false, reason: 'INSUFFICIENT_CONTENT_EVIDENCE' };
  }

  return { trusted: true };
}

/**
 * Non-identifying labels describing the Facebook page signals, for diagnostics only. Contains
 * classes and booleans, never URLs, paths, IDs or page text.
 */
export function describeFacebookPageSignals(signals: FacebookPageSignals): string {
  const classOf = (value: string | undefined): string => {
    if (!value) return 'none';
    const url = resolveFacebookUrl(value, signals.finalUrl);
    return url ? classifyFacebookUrl(url) : 'non_facebook';
  };
  const { markers } = signals;
  const markerLabels = [
    markers.hasLoginForm && 'login',
    markers.hasCheckpointForm && 'checkpoint',
    markers.hasConsentDialog && 'consent',
  ].filter(Boolean);

  return [
    `fb_final=${classifyFacebookUrl(signals.finalUrl)}`,
    `fb_canonical=${classOf(signals.canonicalUrl)}`,
    `fb_og=${classOf(signals.ogUrl)}`,
    `markers=${markerLabels.length > 0 ? markerLabels.join('+') : 'none'}`,
    `title_generic=${isGenericFacebookTitle(signals.title)}`,
    `desc_generic=${isGenericFacebookDescription(signals.description)}`,
  ].join(' ');
}

export function hostOf(urlString: string): string {
  try {
    return new URL(urlString).hostname || '(no-host)';
  } catch {
    return '(invalid-url)';
  }
}
