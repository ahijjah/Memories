import {
  FbIdentity,
  classifyFacebookUrl,
  describeFacebookPageSignals,
  evaluateFacebookCorrespondence,
  extractFacebookIdentity,
} from './url-page-trust';

const fb = (path: string) => new URL(`https://www.facebook.com${path}`);
const id = (url: string): FbIdentity => extractFacebookIdentity(new URL(url));

describe('extractFacebookIdentity (shares the classifier pattern table)', () => {
  it.each([
    ['https://www.facebook.com/jane.doe/posts/123456', 'POST', '123456', 'NUMERIC', 'PATH'],
    ['https://www.facebook.com/jane.doe/posts/pfbid02SynthABC/', 'POST', 'pfbid02SynthABC', 'PFBID', 'PATH'],
    ['https://m.facebook.com/permalink.php?story_fbid=123&id=456', 'POST', '123', 'NUMERIC', 'QUERY'],
    ['https://www.facebook.com/story.php?story_fbid=pfbid0Synth&id=4', 'POST', 'pfbid0Synth', 'PFBID', 'QUERY'],
    ['https://www.facebook.com/permalink.php?story_fbid=pfbidSYNTH&id=4', 'POST', 'pfbidSYNTH', 'PFBID', 'QUERY'],
    ['https://www.facebook.com/photo.php?fbid=123456', 'PHOTO', '123456', 'NUMERIC', 'QUERY'],
    ['https://www.facebook.com/photo/?fbid=123456', 'PHOTO', '123456', 'NUMERIC', 'QUERY'],
    ['https://www.facebook.com/jane.doe/photos/a.111/222/', 'PHOTO', '222', 'NUMERIC', 'PATH'],
    ['https://www.facebook.com/jane.doe/photos/333', 'PHOTO', '333', 'NUMERIC', 'PATH'],
    ['https://www.facebook.com/jane.doe/photos/123/', 'PHOTO', '123', 'NUMERIC', 'PATH'],
    ['https://www.facebook.com/jane.doe/videos/123', 'VIDEO', '123', 'NUMERIC', 'PATH'],
    ['https://www.facebook.com/jane.doe/videos/444/', 'VIDEO', '444', 'NUMERIC', 'PATH'],
    ['https://www.facebook.com/jane.doe/videos/some-title/555/', 'VIDEO', '555', 'NUMERIC', 'PATH'],
    ['https://www.facebook.com/watch/?v=666', 'VIDEO', '666', 'NUMERIC', 'QUERY'],
    ['https://www.facebook.com/reel/777', 'VIDEO', '777', 'NUMERIC', 'PATH'],
    ['https://www.facebook.com/groups/somegroup/posts/888/', 'GROUP_POST', '888', 'NUMERIC', 'PATH'],
    ['https://www.facebook.com/groups/123/permalink/999/', 'GROUP_POST', '999', 'NUMERIC', 'PATH'],
    ['https://www.facebook.com/events/101010/', 'EVENT', '101010', 'NUMERIC', 'PATH'],
    ['https://www.facebook.com/marketplace/item/121212/', 'MARKETPLACE_ITEM', '121212', 'NUMERIC', 'PATH'],
  ])('ITEM %s -> %s', (url, kind, itemId, idForm, source) => {
    expect(classifyFacebookUrl(new URL(url))).toBe('ITEM');
    expect(id(url)).toEqual({ status: 'ITEM', kind, id: itemId, idForm, source });
  });

  it.each([
    ['https://www.facebook.com/share/p/SYNTH/', 'WRAPPER'],
    ['https://www.facebook.com/share/r/SYNTH/', 'WRAPPER'],
    ['https://fb.me/SYNTH', 'WRAPPER'],
    ['https://fb.watch/SYNTH/', 'WRAPPER'],
    ['https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.com', 'WRAPPER'],
    ['https://www.facebook.com/SomeISP/', 'PROFILE_OR_PAGE'],
    ['https://www.facebook.com/profile.php?id=123', 'PROFILE_OR_PAGE'],
    ['https://www.facebook.com/watch/?v=pfbidSYNTH', 'PROFILE_OR_PAGE'],
    ['https://www.facebook.com/', 'ROOT'],
    ['https://www.facebook.com/login/?next=x', 'INTERSTITIAL'],
    ['https://login.facebook.com/', 'INTERSTITIAL'],
  ])('non-item %s -> %s (matches the classifier, no id)', (url, status) => {
    expect(classifyFacebookUrl(new URL(url))).toBe(status);
    expect(id(url)).toEqual({ status });
  });

  it.each([
    'https://example.com/jane.doe/posts/123456',
    'https://www.facebook.com.example.com/reel/777',
    'https://notfacebook.com/events/101010/',
  ])('non-Facebook host is NON_FACEBOOK even with an item-shaped path: %s', (url) => {
    expect(id(url)).toEqual({ status: 'NON_FACEBOOK' });
  });
});

describe('evaluateFacebookCorrespondence', () => {
  const POST_123 = id('https://www.facebook.com/jane.doe/posts/123');
  const POST_123_PERMALINK = id('https://www.facebook.com/permalink.php?story_fbid=123&id=9');
  const POST_456 = id('https://www.facebook.com/jane.doe/posts/456');
  const POST_PFBID = id('https://www.facebook.com/jane.doe/posts/pfbid0Synth');
  const PHOTO_123 = id('https://www.facebook.com/photo.php?fbid=123');
  const SHARE = id('https://www.facebook.com/share/p/SYNTH/');
  const PROFILE = id('https://www.facebook.com/SomeISP/');

  it('direct source item = final = canonical, og equal -> STRONG', () => {
    expect(evaluateFacebookCorrespondence(POST_123, POST_123, POST_123, POST_123)).toEqual({
      level: 'STRONG',
      srcFinal: 'eq',
      srcCanon: 'eq',
      finalCanon: 'eq',
      finalOg: 'eq',
      canonOg: 'eq',
    });
  });

  it('direct source item = final = canonical, og absent -> STRONG', () => {
    expect(evaluateFacebookCorrespondence(POST_123, POST_123, POST_123, null).level).toBe('STRONG');
  });

  it('the same post ID in path and query forms is comparable and equal', () => {
    expect(evaluateFacebookCorrespondence(POST_123_PERMALINK, POST_123, POST_123, null).level).toBe('STRONG');
  });

  it('source 123 vs canonical 456 -> CONFLICT', () => {
    const result = evaluateFacebookCorrespondence(POST_123, POST_123, POST_456, null);
    expect(result.level).toBe('CONFLICT');
    expect(result.srcCanon).toBe('ne');
    expect(result.finalCanon).toBe('ne');
  });

  it('final = canonical = 123 but og:url 456 -> CONFLICT', () => {
    const result = evaluateFacebookCorrespondence(POST_123, POST_123, POST_123, POST_456);
    expect(result.level).toBe('CONFLICT');
    expect(result.finalOg).toBe('ne');
  });

  it('/share/ source -> final = canonical = og same item -> PARTIAL (the P3 shape), never STRONG', () => {
    expect(evaluateFacebookCorrespondence(SHARE, POST_123, POST_123, POST_123)).toEqual({
      level: 'PARTIAL',
      srcFinal: 'na',
      srcCanon: 'na',
      finalCanon: 'eq',
      finalOg: 'eq',
      canonOg: 'eq',
    });
  });

  it('non-Facebook or absent source with final = canonical -> PARTIAL', () => {
    const outside = id('https://example.com/go/SYNTH');
    expect(evaluateFacebookCorrespondence(outside, POST_123, POST_123, null).level).toBe('PARTIAL');
    expect(evaluateFacebookCorrespondence(null, POST_123, POST_123, null).level).toBe('PARTIAL');
  });

  it('source = final with no canonical -> PARTIAL', () => {
    const result = evaluateFacebookCorrespondence(POST_123, POST_123, null, null);
    expect(result.level).toBe('PARTIAL');
    expect(result.srcCanon).toBe('na');
  });

  it('og:url present but not an item keeps STRONG shape out of reach -> PARTIAL', () => {
    expect(evaluateFacebookCorrespondence(POST_123, POST_123, POST_123, PROFILE).level).toBe('PARTIAL');
  });

  it('pfbid vs numeric is not comparable and never STRONG', () => {
    const result = evaluateFacebookCorrespondence(POST_PFBID, POST_123, POST_123, null);
    expect(result.srcFinal).toBe('nc');
    expect(result.srcCanon).toBe('nc');
    expect(result.level).toBe('PARTIAL');
    expect(evaluateFacebookCorrespondence(POST_PFBID, POST_PFBID, POST_123, null).level).not.toBe('STRONG');
  });

  it('POST vs PHOTO is never STRONG; final/canonical of different kinds is CONFLICT', () => {
    expect(evaluateFacebookCorrespondence(PHOTO_123, POST_123, POST_123, null).level).toBe('PARTIAL');
    expect(evaluateFacebookCorrespondence(POST_123, POST_123, PHOTO_123, null)).toMatchObject({
      level: 'CONFLICT',
      finalCanon: 'nc',
    });
  });

  it('a single identity without agreement -> NONE', () => {
    expect(evaluateFacebookCorrespondence(SHARE, POST_123, null, null).level).toBe('NONE');
    expect(evaluateFacebookCorrespondence(SHARE, SHARE, SHARE, null).level).toBe('NONE');
    expect(evaluateFacebookCorrespondence(SHARE, PROFILE, null, PROFILE).level).toBe('NONE');
    // og:url is supporting only: agreement with og alone establishes nothing.
    expect(evaluateFacebookCorrespondence(SHARE, POST_123, null, POST_123).level).toBe('NONE');
  });
});

describe('describeFacebookPageSignals correspondence tokens (sanitized)', () => {
  const noMarkers = { hasLoginForm: false, hasCheckpointForm: false, hasConsentDialog: false };
  // Sentinel values that must never surface in the label.
  const NAME = 'SENTINELNAME';
  const ITEM_ID = '424242424242';
  const OTHER_ID = '535353535353';
  const PFBID = 'pfbid0SENTINELPFBID';
  const itemUrl = (itemId: string) => `https://www.facebook.com/${NAME}/posts/${itemId}?SENTINELQK=SENTINELQV`;

  const labelFor = (source: string, final: string, canonical?: string, og?: string) =>
    describeFacebookPageSignals(
      {
        finalUrl: new URL(final),
        title: 'SENTINELTITLE specific',
        description: 'SENTINELDESC specific',
        canonicalUrl: canonical,
        ogUrl: og,
        markers: noMarkers,
      },
      source,
    );

  const cases: [string, string, string, string | undefined, string | undefined, string][] = [
    ['STRONG', itemUrl(ITEM_ID), itemUrl(ITEM_ID), itemUrl(ITEM_ID), itemUrl(ITEM_ID), 'fb_corr=STRONG'],
    ['CONFLICT', itemUrl(ITEM_ID), itemUrl(ITEM_ID), itemUrl(OTHER_ID), undefined, 'fb_corr=CONFLICT'],
    ['PARTIAL (share)', 'https://www.facebook.com/share/p/SENTINELSHARETOKEN/?mibextid=SENTINELQV', itemUrl(ITEM_ID), itemUrl(ITEM_ID), itemUrl(ITEM_ID), 'fb_corr=PARTIAL'],
    ['PARTIAL (pfbid vs numeric)', itemUrl(PFBID), itemUrl(ITEM_ID), itemUrl(ITEM_ID), undefined, 'fb_corr=PARTIAL'],
  ];

  it.each(cases)('%s label carries only enum tokens', (_label, source, final, canonical, og, expected) => {
    const label = labelFor(source, final, canonical, og);

    expect(label).toContain(expected);
    // `pfbid` may appear only as the fb_idform_* enum value; the raw pfbid ID carries SENTINEL.
    expect(label).not.toMatch(/SENTINEL|424242424242|535353535353|facebook\.com|\/posts\/|share|\?|=https?/i);
    expect(label.replace(/fb_idform_[a-z]+=pfbid/g, '')).not.toMatch(/pfbid/i);
    // Every token is `name=value` with a lowercase snake_case name and an enum-like value, and the
    // correspondence portion contains no digits at all (no raw or hashed IDs).
    for (const token of label.split(' ')) {
      expect(token).toMatch(/^[a-z_]+=[A-Za-z_]+$/);
    }
    const correspondencePart = label.slice(label.indexOf('fb_id_src='));
    expect(correspondencePart).not.toMatch(/\d/);
  });

  it('the pfbid/numeric case reports forms and nc without revealing either ID', () => {
    const label = labelFor(itemUrl(PFBID), itemUrl(ITEM_ID), itemUrl(ITEM_ID));
    expect(label).toContain('fb_idform_src=pfbid');
    expect(label).toContain('fb_idform_final=numeric');
    expect(label).toContain('fb_m_src_final=nc');
    expect(label).not.toContain(PFBID);
    expect(label).not.toContain(ITEM_ID);
  });

  it('sources that do not parse are reported as none, not echoed', () => {
    const label = labelFor('not a url SENTINELRAW', itemUrl(ITEM_ID), itemUrl(ITEM_ID));
    expect(label).toContain('fb_id_src=none');
    expect(label).not.toMatch(/SENTINEL/);
  });

  it('relative canonical/og URLs resolve against the final URL', () => {
    const label = labelFor(itemUrl(ITEM_ID), itemUrl(ITEM_ID), `/${NAME}/posts/${ITEM_ID}`, `/${NAME}/posts/${ITEM_ID}`);
    expect(label).toContain('fb_corr=STRONG');
  });

  it('works with fb(...) helper shapes (no source argument -> src none)', () => {
    const label = describeFacebookPageSignals({ finalUrl: fb('/jane.doe/posts/1'), markers: noMarkers });
    expect(label).toContain('fb_id_src=none');
    expect(label).toContain('fb_corr=NONE');
  });
});
