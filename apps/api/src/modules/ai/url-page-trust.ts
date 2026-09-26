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
// This one table drives both classifyFacebookUrl (ITEM or not) and extractFacebookIdentity
// (which item), so the two can never disagree about what counts as an item.
const DIGITS_ID = '\\d+';
const POST_ID = '(?:\\d+|pfbid[0-9A-Za-z]+)';
const NAME = '[^/]+';

export type FbItemKind = 'POST' | 'PHOTO' | 'VIDEO' | 'GROUP_POST' | 'EVENT' | 'MARKETPLACE_ITEM';
export type FbIdForm = 'NUMERIC' | 'PFBID';

// Path item formats: the single capture group is the item ID.
const ITEM_PATHS: { kind: FbItemKind; pattern: RegExp }[] = [
  { kind: 'POST', pattern: new RegExp(`^/${NAME}/posts/(${POST_ID})/?$`, 'i') },
  { kind: 'PHOTO', pattern: new RegExp(`^/${NAME}/photos/(?:[^/]+/)?(${DIGITS_ID})/?$`, 'i') },
  { kind: 'VIDEO', pattern: new RegExp(`^/${NAME}/videos/(?:[^/]+/)?(${DIGITS_ID})/?$`, 'i') },
  { kind: 'VIDEO', pattern: new RegExp(`^/reel/(${DIGITS_ID})/?$`, 'i') },
  { kind: 'GROUP_POST', pattern: new RegExp(`^/groups/${NAME}/(?:posts|permalink)/(${DIGITS_ID})/?$`, 'i') },
  { kind: 'EVENT', pattern: new RegExp(`^/events/(${DIGITS_ID})/?$`, 'i') },
  { kind: 'MARKETPLACE_ITEM', pattern: new RegExp(`^/marketplace/item/(${DIGITS_ID})/?$`, 'i') },
];
// Item formats identified by a query parameter rather than the path.
const ITEM_QUERY_PATHS: { kind: FbItemKind; path: RegExp; param: string; id: RegExp }[] = [
  { kind: 'POST', path: /^\/(?:permalink|story)\.php$/i, param: 'story_fbid', id: new RegExp(`^${POST_ID}$`, 'i') },
  { kind: 'PHOTO', path: /^\/photo(?:\.php)?\/?$/i, param: 'fbid', id: new RegExp(`^${DIGITS_ID}$`) },
  { kind: 'VIDEO', path: /^\/watch\/?$/i, param: 'v', id: new RegExp(`^${DIGITS_ID}$`) },
];

interface FbItemMatch {
  kind: FbItemKind;
  id: string;
  source: 'PATH' | 'QUERY';
}

function matchFacebookItem(url: URL): FbItemMatch | null {
  const path = url.pathname;
  for (const { kind, pattern } of ITEM_PATHS) {
    const match = pattern.exec(path);
    if (match) return { kind, id: match[1], source: 'PATH' };
  }
  for (const { kind, path: pattern, param, id } of ITEM_QUERY_PATHS) {
    const value = url.searchParams.get(param) ?? '';
    if (pattern.test(path) && id.test(value)) return { kind, id: value, source: 'QUERY' };
  }
  return null;
}

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
  return classifyWithItem(url).urlClass;
}

function classifyWithItem(url: URL): { urlClass: FacebookUrlClass; item?: FbItemMatch } {
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (isInterstitialLocation(url)) return { urlClass: 'INTERSTITIAL' };
  if (WRAPPER_HOSTS.some((wrapper) => host === wrapper || host.endsWith(`.${wrapper}`))) {
    return { urlClass: 'WRAPPER' };
  }

  const path = url.pathname;
  if (path === '' || path === '/') return { urlClass: 'ROOT' };
  if (WRAPPER_PATH.test(path)) return { urlClass: 'WRAPPER' };
  const item = matchFacebookItem(url);
  if (item) return { urlClass: 'ITEM', item };
  return { urlClass: 'PROFILE_OR_PAGE' };
}

/**
 * Which Facebook content item a URL names, from URL structure alone (no network). `id` is the
 * raw item ID: it exists only for in-process equality checks and must never be logged,
 * returned, persisted or hashed into diagnostics.
 */
export type FbIdentity =
  | { status: 'ITEM'; kind: FbItemKind; id: string; idForm: FbIdForm; source: 'PATH' | 'QUERY' }
  | { status: 'WRAPPER' | 'PROFILE_OR_PAGE' | 'ROOT' | 'INTERSTITIAL' | 'NON_FACEBOOK' | 'INVALID' };

export function extractFacebookIdentity(url: URL): FbIdentity {
  if (!isFacebookFamilyHost(url.hostname)) return { status: 'NON_FACEBOOK' };
  const { urlClass, item } = classifyWithItem(url);
  if (urlClass !== 'ITEM' || !item) return { status: urlClass === 'ITEM' ? 'INVALID' : urlClass };
  const idForm: FbIdForm = /^pfbid/i.test(item.id) ? 'PFBID' : 'NUMERIC';
  return { status: 'ITEM', kind: item.kind, id: item.id, idForm, source: item.source };
}

/** Identity of a declared URL string; null when absent, INVALID when it does not parse. */
function identityOf(value: string | undefined, base?: URL): FbIdentity | null {
  if (!value) return null;
  let url: URL;
  try {
    url = base ? new URL(value, base) : new URL(value);
  } catch {
    return { status: 'INVALID' };
  }
  return extractFacebookIdentity(url);
}

export type FbPairMatch = 'eq' | 'ne' | 'nc' | 'na';
export type FbCorrespondenceLevel = 'STRONG' | 'PARTIAL' | 'CONFLICT' | 'NONE';

export interface FacebookCorrespondence {
  level: FbCorrespondenceLevel;
  srcFinal: FbPairMatch;
  srcCanon: FbPairMatch;
  finalCanon: FbPairMatch;
  finalOg: FbPairMatch;
  canonOg: FbPairMatch;
}

type FbItemIdentity = Extract<FbIdentity, { status: 'ITEM' }>;

function asItem(identity: FbIdentity | null | undefined): FbItemIdentity | null {
  return identity && identity.status === 'ITEM' ? identity : null;
}

/**
 * eq/ne only for two ITEMs of the same kind and ID form; nc for two ITEMs that cannot be
 * compared (pfbid vs numeric, post vs photo, ...); na when either side is absent or not an ITEM.
 */
function compareIdentities(a: FbIdentity | null | undefined, b: FbIdentity | null | undefined): FbPairMatch {
  const left = asItem(a);
  const right = asItem(b);
  if (!left || !right) return 'na';
  if (left.kind !== right.kind || left.idForm !== right.idForm) return 'nc';
  return left.id === right.id ? 'eq' : 'ne';
}

/**
 * Whether the fetched page's declared identities correspond to the item the user shared.
 * Diagnostic only: no result grants trust. Ambiguity never yields STRONG.
 *
 * - CONFLICT: any comparable pair differs, or final and canonical are items of different kinds.
 * - STRONG: source, final and canonical are the same comparable item, and og:url is absent or
 *   the same item as both.
 * - PARTIAL: some agreement without proof that it is the shared item (e.g. a /share/ source with
 *   final = canonical, or source = final with no canonical).
 * - NONE: no agreeing pair among source, final and canonical.
 */
export function evaluateFacebookCorrespondence(
  source: FbIdentity | null,
  final: FbIdentity | null,
  canonical: FbIdentity | null,
  og: FbIdentity | null,
): FacebookCorrespondence {
  const pairs = {
    srcFinal: compareIdentities(source, final),
    srcCanon: compareIdentities(source, canonical),
    finalCanon: compareIdentities(final, canonical),
    finalOg: compareIdentities(final, og),
    canonOg: compareIdentities(canonical, og),
  };
  const all = Object.values(pairs);

  const finalItem = asItem(final);
  const canonicalItem = asItem(canonical);
  const kindConflict = !!finalItem && !!canonicalItem && finalItem.kind !== canonicalItem.kind;
  if (all.includes('ne') || kindConflict) return { level: 'CONFLICT', ...pairs };

  const ogAgrees = og === null || (pairs.finalOg === 'eq' && pairs.canonOg === 'eq');
  if (pairs.srcFinal === 'eq' && pairs.srcCanon === 'eq' && pairs.finalCanon === 'eq' && ogAgrees) {
    return { level: 'STRONG', ...pairs };
  }

  if (pairs.srcFinal === 'eq' || pairs.srcCanon === 'eq' || pairs.finalCanon === 'eq') {
    return { level: 'PARTIAL', ...pairs };
  }
  return { level: 'NONE', ...pairs };
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

function identityLabel(identity: FbIdentity | null): string {
  if (!identity) return 'none';
  if (identity.status === 'ITEM') return 'item';
  if (identity.status === 'WRAPPER') return 'wrapper';
  if (identity.status === 'NON_FACEBOOK') return 'non_fb';
  return 'none';
}

function kindLabel(identity: FbIdentity | null): string {
  const item = asItem(identity);
  return item ? item.kind.toLowerCase() : 'na';
}

function idFormLabel(identity: FbIdentity | null): string {
  const item = asItem(identity);
  return item ? item.idForm.toLowerCase() : 'na';
}

/**
 * Non-identifying labels describing the Facebook page signals, for diagnostics only. Contains
 * classes, enum labels and booleans, never URLs, paths, IDs (raw or hashed) or page text.
 * `sourceUrl` is the URL the user shared; it only feeds the fb_*_src identity labels.
 */
export function describeFacebookPageSignals(signals: FacebookPageSignals, sourceUrl?: string): string {
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
    describeFacebookCorrespondence(signals, sourceUrl),
  ].join(' ');
}

function describeFacebookCorrespondence(signals: FacebookPageSignals, sourceUrl?: string): string {
  const identities = {
    src: identityOf(sourceUrl),
    final: extractFacebookIdentity(signals.finalUrl),
    canon: identityOf(signals.canonicalUrl, signals.finalUrl),
    og: identityOf(signals.ogUrl, signals.finalUrl),
  };
  const correspondence = evaluateFacebookCorrespondence(
    identities.src,
    identities.final,
    identities.canon,
    identities.og,
  );
  const names = ['src', 'final', 'canon', 'og'] as const;

  return [
    ...names.map((name) => `fb_id_${name}=${identityLabel(identities[name])}`),
    ...names.map((name) => `fb_kind_${name}=${kindLabel(identities[name])}`),
    ...names.map((name) => `fb_idform_${name}=${idFormLabel(identities[name])}`),
    `fb_m_src_final=${correspondence.srcFinal}`,
    `fb_m_src_canon=${correspondence.srcCanon}`,
    `fb_m_final_canon=${correspondence.finalCanon}`,
    `fb_m_final_og=${correspondence.finalOg}`,
    `fb_m_canon_og=${correspondence.canonOg}`,
    `fb_corr=${correspondence.level}`,
  ].join(' ');
}

export function hostOf(urlString: string): string {
  try {
    return new URL(urlString).hostname || '(no-host)';
  } catch {
    return '(invalid-url)';
  }
}
