import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { UrlMetadataService } from './url-metadata.service';
import {
  classifyFacebookUrl,
  describeFacebookPageSignals,
  evaluateFacebookPageTrust,
  isFacebookFamilyUrl,
  isGenericFacebookTitle,
} from './url-page-trust';

describe('UrlMetadataService', () => {
  let service: UrlMetadataService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [UrlMetadataService],
    }).compile();

    service = module.get<UrlMetadataService>(UrlMetadataService);
  });

  describe('extractMetadata with JSON-LD', () => {
    it('should extract Article schema author as string', () => {
      const html = `
        <html>
          <head>
            <title>Article Title</title>
            <script type="application/ld+json">
              {
                "@type": "Article",
                "headline": "Test Article",
                "author": "Jane Doe",
                "datePublished": "2026-01-15"
              }
            </script>
          </head>
          <body></body>
        </html>
      `;

      const metadata = service['extractMetadata'](html);
      expect(metadata.author).toBe('Jane Doe');
      expect(metadata.datePublished).toBe('2026-01-15');
    });

    it('should extract NewsArticle schema with author object containing name', () => {
      const html = `
        <html>
          <head>
            <script type="application/ld+json">
              {
                "@type": "NewsArticle",
                "headline": "News",
                "author": {
                  "@type": "Person",
                  "name": "John Smith"
                },
                "datePublished": "2026-02-20"
              }
            </script>
          </head>
          <body></body>
        </html>
      `;

      const metadata = service['extractMetadata'](html);
      expect(metadata.author).toBe('John Smith');
      expect(metadata.datePublished).toBe('2026-02-20');
    });

    it('should extract BlogPosting schema with author array', () => {
      const html = `
        <html>
          <head>
            <script type="application/ld+json">
              {
                "@type": "BlogPosting",
                "headline": "Blog Post",
                "author": [
                  "Alice Cooper",
                  {
                    "name": "Bob Dylan"
                  }
                ],
                "datePublished": "2026-03-10"
              }
            </script>
          </head>
          <body></body>
        </html>
      `;

      const metadata = service['extractMetadata'](html);
      expect(metadata.author).toBe('Alice Cooper');
      expect(metadata.datePublished).toBe('2026-03-10');
    });

    it('should extract Product schema with brand, sku, and offers', () => {
      const html = `
        <html>
          <head>
            <script type="application/ld+json">
              {
                "@type": "Product",
                "name": "iPhone 15",
                "brand": {
                  "@type": "Brand",
                  "name": "Apple"
                },
                "sku": "A2846",
                "offers": {
                  "@type": "Offer",
                  "price": "999",
                  "priceCurrency": "USD",
                  "availability": "InStock"
                }
              }
            </script>
          </head>
          <body></body>
        </html>
      `;

      const metadata = service['extractMetadata'](html);
      expect(metadata.brand).toBe('Apple');
      expect(metadata.sku).toBe('A2846');
      expect(metadata.price).toBe('999');
      expect(metadata.priceCurrency).toBe('USD');
      expect(metadata.availability).toBe('InStock');
    });

    it('should extract Product schema with string brand', () => {
      const html = `
        <html>
          <head>
            <script type="application/ld+json">
              {
                "@type": "Product",
                "name": "Nike Shoes",
                "brand": "Nike",
                "offers": {
                  "price": "120",
                  "priceCurrency": "EUR"
                }
              }
            </script>
          </head>
          <body></body>
        </html>
      `;

      const metadata = service['extractMetadata'](html);
      expect(metadata.brand).toBe('Nike');
      expect(metadata.price).toBe('120');
      expect(metadata.priceCurrency).toBe('EUR');
    });

    it('should handle @graph wrapper with multiple entities', () => {
      const html = `
        <html>
          <head>
            <script type="application/ld+json">
              {
                "@graph": [
                  {
                    "@type": "Article",
                    "author": "Charlie Brown",
                    "datePublished": "2026-04-05"
                  },
                  {
                    "@type": "Product",
                    "brand": "Sony",
                    "sku": "PROD123"
                  }
                ]
              }
            </script>
          </head>
          <body></body>
        </html>
      `;

      const metadata = service['extractMetadata'](html);
      expect(metadata.author).toBe('Charlie Brown');
      expect(metadata.datePublished).toBe('2026-04-05');
      expect(metadata.brand).toBe('Sony');
      expect(metadata.sku).toBe('PROD123');
    });

    it('should handle direct array of schemas', () => {
      const html = `
        <html>
          <head>
            <script type="application/ld+json">
              [
                {
                  "@type": "Article",
                  "author": "David Lee"
                },
                {
                  "@type": "Organization",
                  "name": "Acme Corp"
                }
              ]
            </script>
          </head>
          <body></body>
        </html>
      `;

      const metadata = service['extractMetadata'](html);
      expect(metadata.author).toBe('David Lee');
    });

    it('should gracefully skip malformed JSON-LD blocks', () => {
      const html = `
        <html>
          <head>
            <script type="application/ld+json">
              { invalid json here }'
            </script>
            <script type="application/ld+json">
              {
                "@type": "Article",
                "author": "Eva Green"
              }
            </script>
          </head>
          <body></body>
        </html>
      `;

      const metadata = service['extractMetadata'](html);
      expect(metadata.author).toBe('Eva Green');
    });

    it('should prioritize first matching value when multiple JSON-LD blocks exist', () => {
      const html = `
        <html>
          <head>
            <script type="application/ld+json">
              {
                "@type": "Article",
                "author": "First Author"
              }
            </script>
            <script type="application/ld+json">
              {
                "@type": "Article",
                "author": "Second Author"
              }
            </script>
          </head>
          <body></body>
        </html>
      `;

      const metadata = service['extractMetadata'](html);
      expect(metadata.author).toBe('First Author');
    });

    it('should extract Product offers array (take first offer)', () => {
      const html = `
        <html>
          <head>
            <script type="application/ld+json">
              {
                "@type": "Product",
                "name": "Multi-Offer Product",
                "offers": [
                  {
                    "price": "50",
                    "priceCurrency": "GBP",
                    "availability": "LimitedAvailability"
                  },
                  {
                    "price": "60",
                    "priceCurrency": "GBP"
                  }
                ]
              }
            </script>
          </head>
          <body></body>
        </html>
      `;

      const metadata = service['extractMetadata'](html);
      expect(metadata.price).toBe('50');
      expect(metadata.priceCurrency).toBe('GBP');
      expect(metadata.availability).toBe('LimitedAvailability');
    });

    it('should handle missing JSON-LD scripts gracefully', () => {
      const html = `
        <html>
          <head>
            <title>No JSON-LD</title>
          </head>
          <body></body>
        </html>
      `;

      const metadata = service['extractMetadata'](html);
      expect(metadata.author).toBeUndefined();
      expect(metadata.brand).toBeUndefined();
    });

    it('should ignore schema without @type', () => {
      const html = `
        <html>
          <head>
            <script type="application/ld+json">
              {
                "title": "No Type",
                "author": "Ignored Author"
              }
            </script>
          </head>
          <body></body>
        </html>
      `;

      const metadata = service['extractMetadata'](html);
      expect(metadata.author).toBeUndefined();
    });

    it('should handle @type as array', () => {
      const html = `
        <html>
          <head>
            <script type="application/ld+json">
              {
                "@type": ["Thing", "Article"],
                "author": "Type Array Author",
                "datePublished": "2026-05-01"
              }
            </script>
          </head>
          <body></body>
        </html>
      `;

      const metadata = service['extractMetadata'](html);
      expect(metadata.author).toBe('Type Array Author');
      expect(metadata.datePublished).toBe('2026-05-01');
    });

    it('should extract only non-empty values', () => {
      const html = `
        <html>
          <head>
            <script type="application/ld+json">
              {
                "@type": "Article",
                "author": "",
                "datePublished": "2026-06-15"
              }
            </script>
          </head>
          <body></body>
        </html>
      `;

      const metadata = service['extractMetadata'](html);
      expect(metadata.author).toBeUndefined();
      expect(metadata.datePublished).toBe('2026-06-15');
    });

    it('should use OG metadata over JSON-LD for title/description/image', () => {
      const html = `
        <html>
          <head>
            <meta property="og:title" content="OG Title">
            <meta property="og:description" content="OG Description">
            <meta property="og:image" content="https://example.com/og-image.jpg">
            <script type="application/ld+json">
              {
                "@type": "Article",
                "headline": "JSON-LD Title",
                "description": "JSON-LD Description",
                "image": "https://example.com/ld-image.jpg"
              }
            </script>
          </head>
          <body></body>
        </html>
      `;

      const metadata = service['extractMetadata'](html);
      expect(metadata.title).toBe('OG Title');
      expect(metadata.description).toBe('OG Description');
      expect(metadata.imageUrl).toBe('https://example.com/og-image.jpg');
    });
  });

  describe('fetchMetadata page trust (Facebook interstitials)', () => {
    let fetchSpy: jest.SpyInstance;
    let hostCheck: jest.SpyInstance;

    const htmlResponse = (html: string, status = 200) =>
      new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
    const redirect = (location: string, status = 302) =>
      new Response(null, { status, headers: { location } });
    const page = (head: string, body = '') => `<html><head>${head}</head><body>${body}</body></html>`;

    const LOGIN_FORM =
      '<form id="login_form" action="/login/device-based/regular/login/"><input name="email"><input name="pass"></form>';
    const SHARE_URL = 'https://www.facebook.com/share/p/SENTINELPATH/?mibextid=SENTINELQUERY';

    beforeEach(() => {
      fetchSpy = jest.spyOn(global, 'fetch');
      hostCheck = jest.spyOn(service as any, 'isValidHostname').mockResolvedValue(true);
    });

    afterEach(() => jest.restoreAllMocks());

    it('A: rejects a Facebook login page (HTTP 200) and exposes no page image', async () => {
      fetchSpy.mockResolvedValueOnce(
        htmlResponse(
          page(
            '<title>Log into Facebook</title>' +
              '<meta property="og:title" content="Log in to Facebook">' +
              '<meta property="og:description" content="Log in to Facebook to start sharing and connecting with your friends.">' +
              '<meta property="og:image" content="https://static.xx.fbcdn.net/rsrc.php/generic-logo.png">',
            LOGIN_FORM,
          ),
        ),
      );

      const result = await service.fetchMetadata(SHARE_URL);

      expect(result.status).toBe('rejected');
      expect(result).not.toHaveProperty('metadata');
      expect(JSON.stringify(result)).not.toContain('fbcdn');
    });

    it('B: rejects a generic Facebook page with only <title>', async () => {
      fetchSpy.mockResolvedValueOnce(htmlResponse(page('<title>Facebook</title>')));

      const result = await service.fetchMetadata(SHARE_URL);

      expect(result).toMatchObject({ status: 'rejected', reason: 'GENERIC_TITLE' });
    });

    it('C1: rejects when the final page is a checkpoint path', async () => {
      fetchSpy
        .mockResolvedValueOnce(redirect('https://www.facebook.com/checkpoint/block/?next=SENTINELQUERY'))
        .mockResolvedValueOnce(
          htmlResponse(page('<title>Jane Doe</title><meta property="og:description" content="Specific text">')),
        );

      const result = await service.fetchMetadata(SHARE_URL);

      expect(result).toMatchObject({
        status: 'rejected',
        reason: 'FINAL_PATH_INTERSTITIAL',
        redirectCount: 1,
      });
    });

    it('C2: rejects a consent interstitial identified by structural markers', async () => {
      fetchSpy.mockResolvedValueOnce(
        htmlResponse(
          page(
            '<title>Allow the use of cookies from Facebook on this browser?</title>',
            '<div data-testid="cookie-policy-manage-dialog"></div>',
          ),
        ),
      );

      const result = await service.fetchMetadata(SHARE_URL);

      expect(result).toMatchObject({ status: 'rejected', reason: 'LOGIN_OR_CHECKPOINT_MARKERS' });
    });

    it('C3: rejects when og:url/canonical points to the Facebook login page', async () => {
      fetchSpy.mockResolvedValueOnce(
        htmlResponse(
          page(
            '<meta property="og:title" content="Jane Doe">' +
              '<meta property="og:description" content="Specific text">' +
              '<link rel="canonical" href="https://www.facebook.com/login/">',
          ),
        ),
      );

      const result = await service.fetchMetadata(SHARE_URL);

      expect(result).toMatchObject({ status: 'rejected', reason: 'CANONICAL_INTERSTITIAL' });
    });

    it('D: accepts useful Facebook post metadata despite Facebook branding and a login form', async () => {
      // Final URL is the /share/p/ wrapper; the canonical ITEM authoritatively identifies the post.
      fetchSpy.mockResolvedValueOnce(
        htmlResponse(
          page(
            '<meta property="og:title" content="Jane Doe - Sunset at the beach | Facebook">' +
              '<meta property="og:description" content="Golden hour at the pier with friends.">' +
              '<meta property="og:url" content="https://www.facebook.com/jane.doe/posts/123456">' +
              '<link rel="canonical" href="https://www.facebook.com/jane.doe/posts/123456">' +
              '<meta property="og:image" content="https://scontent.xx.fbcdn.net/v/photo.jpg">',
            LOGIN_FORM,
          ),
        ),
      );

      const result = await service.fetchMetadata(SHARE_URL);

      expect(result.status).toBe('ok');
      if (result.status !== 'ok') throw new Error('expected ok');
      expect(result.metadata.title).toBe('Jane Doe - Sunset at the beach | Facebook');
      expect(result.metadata.description).toBe('Golden hour at the pier with friends.');
      expect(result.metadata.imageUrl).toBe('https://scontent.xx.fbcdn.net/v/photo.jpg');
    });

    it('D2: rejects specific title and description when nothing identifies a content item', async () => {
      fetchSpy.mockResolvedValueOnce(
        htmlResponse(
          page(
            '<meta property="og:title" content="Community cleanup this Saturday | Facebook">' +
              '<meta property="og:description" content="Join us at 9am by the river with gloves and bags.">',
          ),
        ),
      );

      expect(await service.fetchMetadata(SHARE_URL)).toMatchObject({
        status: 'rejected',
        reason: 'NO_CONTENT_ITEM',
      });
    });

    it('D4: a wrapper final URL is not rescued by an og:url ITEM without a canonical ITEM', async () => {
      fetchSpy.mockResolvedValueOnce(
        htmlResponse(
          page(
            '<meta property="og:title" content="Jane Doe - Sunset at the beach | Facebook">' +
              '<meta property="og:description" content="Golden hour at the pier with friends.">' +
              '<meta property="og:url" content="https://www.facebook.com/jane.doe/posts/123456">' +
              '<meta property="og:image" content="https://scontent.xx.fbcdn.net/v/photo.jpg">',
          ),
        ),
      );

      const result = await service.fetchMetadata(SHARE_URL);

      expect(result).toMatchObject({ status: 'rejected', reason: 'NO_CONTENT_ITEM' });
      expect(JSON.stringify(result)).not.toContain('fbcdn');
    });

    it('P: production shape - share wrapper redirecting once to a page landing never yields metadata', async () => {
      const title = 'SENTINELTITLE Example Networks - Fast home internet in your area'.padEnd(68, '.');
      expect(title).toHaveLength(68);
      fetchSpy
        .mockResolvedValueOnce(redirect('https://www.facebook.com/SENTINELPAGE/', 302))
        .mockResolvedValueOnce(
          htmlResponse(
            page(
              `<meta property="og:title" content="${title}">` +
                '<meta property="og:description" content="SENTINELDESC Internet service provider. 12,345 likes.">' +
                '<meta property="og:url" content="https://www.facebook.com/SENTINELPAGE/">' +
                '<meta property="og:image" content="https://scontent.xx.fbcdn.net/v/SENTINELIMAGE.jpg">',
            ),
          ),
        );

      const result = await service.fetchMetadata(SHARE_URL);

      expect(result).toEqual({
        status: 'rejected',
        reason: 'PROFILE_OR_PAGE_LANDING',
        requestedHost: 'www.facebook.com',
        finalHost: 'www.facebook.com',
        redirectCount: 1,
      });
    });

    it('P2: production shape - share wrapper with self-canonical and a generic description is rejected', async () => {
      fetchSpy
        .mockResolvedValueOnce(redirect('https://www.facebook.com/share/p/SENTINELPATH/?_rdr', 302))
        .mockResolvedValueOnce(
          htmlResponse(
            page(
              '<meta property="og:title" content="SENTINELTITLE Example Networks | Facebook">' +
                '<meta property="og:description" content="See posts, photos and more on Facebook.">' +
                '<link rel="canonical" href="https://www.facebook.com/share/p/SENTINELPATH/">' +
                '<meta property="og:image" content="https://scontent.xx.fbcdn.net/v/SENTINELIMAGE.jpg">',
            ),
          ),
        );

      expect(await service.fetchMetadata(SHARE_URL)).toMatchObject({
        status: 'rejected',
        reason: 'NO_CONTENT_ITEM',
        redirectCount: 1,
      });
    });

    it('D3: login markers + content og:url + specific title but generic login description is rejected', async () => {
      fetchSpy.mockResolvedValueOnce(
        htmlResponse(
          page(
            '<meta property="og:title" content="Jane Doe - Sunset at the beach | Facebook">' +
              '<meta property="og:description" content="Log in to Facebook to start sharing and connecting with your friends.">' +
              '<meta property="og:url" content="https://www.facebook.com/jane.doe/posts/123456">' +
              '<meta property="og:image" content="https://static.xx.fbcdn.net/rsrc.php/login.png">',
            LOGIN_FORM,
          ),
        ),
      );

      const result = await service.fetchMetadata(SHARE_URL);

      expect(result).toMatchObject({ status: 'rejected', reason: 'LOGIN_OR_CHECKPOINT_MARKERS' });
      expect(result).not.toHaveProperty('metadata');
    });

    it('E: rejects a redirect chain ending at the login page and validates every hop', async () => {
      fetchSpy
        .mockResolvedValueOnce(redirect('https://www.facebook.com/jane.doe/posts/123456', 301))
        .mockResolvedValueOnce(redirect('/login/?next=SENTINELQUERY'))
        .mockResolvedValueOnce(
          htmlResponse(
            page(
              '<meta property="og:title" content="SENTINELTITLE Jane Doe">' +
                '<meta property="og:description" content="Specific looking text">',
            ),
          ),
        );

      const result = await service.fetchMetadata(SHARE_URL);

      expect(result).toEqual({
        status: 'rejected',
        reason: 'FINAL_PATH_INTERSTITIAL',
        requestedHost: 'www.facebook.com',
        finalHost: 'www.facebook.com',
        redirectCount: 2,
      });
      // SSRF validation: initial host + one check per redirect hop.
      expect(hostCheck).toHaveBeenCalledTimes(3);
      expect(hostCheck.mock.calls.map((call) => call[0])).toEqual([
        'www.facebook.com',
        'www.facebook.com',
        'www.facebook.com',
      ]);
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    it('E2: a redirect hop that fails SSRF validation is not followed', async () => {
      hostCheck.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      fetchSpy.mockResolvedValueOnce(redirect('https://internal.example/secret'));

      const result = await service.fetchMetadata(SHARE_URL);

      expect(result).toMatchObject({ status: 'unavailable', reason: 'FETCH_FAILED' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('E3: more than 3 redirects is unavailable', async () => {
      fetchSpy.mockImplementation(async () => redirect('https://www.facebook.com/next'));

      const result = await service.fetchMetadata(SHARE_URL);

      expect(result).toMatchObject({ status: 'unavailable', reason: 'FETCH_FAILED' });
      expect(fetchSpy).toHaveBeenCalledTimes(4);
    });

    it('J1: non-Facebook metadata is unchanged, even for login-like titles and forms', async () => {
      const html = page(
        '<title>Log in</title>' +
          '<meta property="og:description" content="Members area">' +
          '<meta property="og:image" content="https://example.com/og.jpg">',
        LOGIN_FORM,
      );
      fetchSpy.mockResolvedValueOnce(htmlResponse(html));

      const result = await service.fetchMetadata('https://example.com/members');

      expect(result).toEqual({
        status: 'ok',
        metadata: service['extractMetadata'](html),
        requestedHost: 'example.com',
        finalHost: 'example.com',
        redirectCount: 0,
      });
    });

    it('J2: non-Facebook non-OK response is unavailable', async () => {
      fetchSpy.mockResolvedValueOnce(htmlResponse('not found', 404));

      expect(await service.fetchMetadata('https://example.com/missing')).toEqual({
        status: 'unavailable',
        reason: 'FETCH_FAILED',
        requestedHost: 'example.com',
      });
    });

    it('K: logs contain no URL path, query, redirect Location or page title', async () => {
      const logged: string[] = [];
      for (const level of ['log', 'warn', 'debug', 'error', 'verbose'] as const) {
        jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
          logged.push(args.map(String).join(' '));
        });
      }

      // Redirect chain to an interstitial with a sentinel title.
      fetchSpy
        .mockResolvedValueOnce(redirect('/login/?next=SENTINELQUERY'))
        .mockResolvedValueOnce(htmlResponse(page('<title>SENTINELTITLE</title>')));
      await service.fetchMetadata(SHARE_URL);

      // Non-OK response, malformed redirect Location, network error and too many redirects.
      fetchSpy.mockResolvedValueOnce(htmlResponse('x', 500));
      await service.fetchMetadata(SHARE_URL);
      fetchSpy.mockResolvedValueOnce(redirect('http://[SENTINELBADLOCATION'));
      await service.fetchMetadata(SHARE_URL);
      fetchSpy.mockRejectedValueOnce(new TypeError(`fetch failed for ${SHARE_URL}`));
      await service.fetchMetadata(SHARE_URL);
      fetchSpy.mockImplementation(async () => redirect('https://www.facebook.com/SENTINELLOOP'));
      await service.fetchMetadata(SHARE_URL);
      fetchSpy.mockReset();

      // Image fetch failure.
      fetchSpy.mockRejectedValueOnce(new Error('boom SENTINELIMAGE'));
      await service.fetchImageBytes('https://static.xx.fbcdn.net/rsrc.php/SENTINELIMAGE.png');

      expect(logged.length).toBeGreaterThan(0);
      expect(logged.some((line) => line.includes('host=www.facebook.com'))).toBe(true);
      for (const line of logged) {
        expect(line).not.toMatch(/SENTINEL/);
      }
    });

    it('K2: the metadata-fetch line carries Facebook classification labels but no paths, IDs or text', async () => {
      const logged: string[] = [];
      for (const level of ['log', 'warn', 'debug', 'error', 'verbose'] as const) {
        jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
          logged.push(args.map(String).join(' '));
        });
      }

      // Rejected: redirect to a page landing.
      fetchSpy
        .mockResolvedValueOnce(redirect('https://www.facebook.com/SENTINELPAGE/'))
        .mockResolvedValueOnce(
          htmlResponse(
            page(
              '<meta property="og:title" content="SENTINELTITLE">' +
                '<meta property="og:description" content="SENTINELDESC">' +
                '<meta property="og:url" content="https://www.facebook.com/SENTINELPAGE/">',
            ),
          ),
        );
      await service.fetchMetadata(SHARE_URL);

      // Trusted: redirect to a post item with canonical ITEM and a login form.
      fetchSpy
        .mockResolvedValueOnce(redirect('https://www.facebook.com/SENTINELNAME/posts/987654321'))
        .mockResolvedValueOnce(
          htmlResponse(
            page(
              '<meta property="og:title" content="SENTINELTITLE post">' +
                '<meta property="og:description" content="SENTINELDESC details">' +
                '<link rel="canonical" href="https://www.facebook.com/SENTINELNAME/posts/987654321">',
              LOGIN_FORM,
            ),
          ),
        );
      await service.fetchMetadata(SHARE_URL);

      const fetchLines = logged.filter((line) => line.startsWith('metadata fetch'));
      expect(fetchLines).toEqual([
        'metadata fetch host=www.facebook.com final_host=www.facebook.com redirects=1 result=rejected reason=PROFILE_OR_PAGE_LANDING ' +
          'fb_final=PROFILE_OR_PAGE fb_canonical=none fb_og=PROFILE_OR_PAGE markers=none title_generic=false desc_generic=false',
        'metadata fetch host=www.facebook.com final_host=www.facebook.com redirects=1 result=ok reason=- ' +
          'fb_final=ITEM fb_canonical=ITEM fb_og=none markers=login title_generic=false desc_generic=false',
      ]);
      for (const line of logged) {
        expect(line).not.toMatch(/SENTINEL|987654321|share\/p|\/posts\//);
      }
    });

    it('K3: non-Facebook metadata-fetch lines carry no Facebook labels', async () => {
      const debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
      fetchSpy.mockResolvedValueOnce(htmlResponse(page('<title>Article</title>')));

      await service.fetchMetadata('https://example.com/article');

      expect(debug).toHaveBeenCalledWith(
        'metadata fetch host=example.com final_host=example.com redirects=0 result=ok reason=-',
      );
    });
  });

  describe('evaluateFacebookPageTrust (pure rules)', () => {
    const noMarkers = { hasLoginForm: false, hasCheckpointForm: false, hasConsentDialog: false };
    const at = (path: string) => new URL(`https://www.facebook.com${path}`);

    it('does not reject a title only because it contains Facebook branding', () => {
      expect(isGenericFacebookTitle('Jane Doe - Sunset | Facebook')).toBe(false);
      expect(isGenericFacebookTitle('Facebook Marketplace finds for my flat')).toBe(false);
      expect(isGenericFacebookTitle('Errors I made learning to bake')).toBe(false);
    });

    it('recognises generic Facebook titles', () => {
      for (const title of ['Facebook', 'Log in to Facebook | Facebook', 'Facebook – log in or sign up', 'Security Check', '', undefined]) {
        expect(isGenericFacebookTitle(title)).toBe(true);
      }
    });

    it.each([
      ['/login/', 'FINAL_PATH_INTERSTITIAL'],
      ['/login.php', 'FINAL_PATH_INTERSTITIAL'],
      ['/checkpoint/123/', 'FINAL_PATH_INTERSTITIAL'],
      ['/privacy/consent/user_cookie_choice/', 'FINAL_PATH_INTERSTITIAL'],
    ])('rejects final path %s', (path, reason) => {
      expect(
        evaluateFacebookPageTrust({
          finalUrl: at(path),
          title: 'Jane Doe',
          description: 'Specific text',
          markers: noMarkers,
        }),
      ).toEqual({ trusted: false, reason });
    });

    describe('login/checkpoint/consent markers require specific page text', () => {
      const contentOgUrl = 'https://www.facebook.com/jane.doe/posts/123456';

      it.each([
        ['hasLoginForm'],
        ['hasCheckpointForm'],
        ['hasConsentDialog'],
      ] as const)('%s + content og:url + specific title + generic description is rejected', (marker) => {
        expect(
          evaluateFacebookPageTrust({
            finalUrl: at('/share/p/abc/'),
            title: 'Jane Doe - Sunset at the beach | Facebook',
            description: 'Log in to Facebook to start sharing and connecting with your friends.',
            ogUrl: contentOgUrl,
            canonicalUrl: contentOgUrl,
            markers: { ...noMarkers, [marker]: true },
          }),
        ).toEqual({ trusted: false, reason: 'LOGIN_OR_CHECKPOINT_MARKERS' });
      });

      it('markers + content og:url alone (no description) is rejected', () => {
        expect(
          evaluateFacebookPageTrust({
            finalUrl: at('/share/p/abc/'),
            title: 'Jane Doe - Sunset at the beach | Facebook',
            ogUrl: contentOgUrl,
            markers: { ...noMarkers, hasLoginForm: true },
          }),
        ).toEqual({ trusted: false, reason: 'LOGIN_OR_CHECKPOINT_MARKERS' });
      });

      it('markers + canonical ITEM + specific title + specific description is trusted', () => {
        expect(
          evaluateFacebookPageTrust({
            finalUrl: at('/share/p/abc/'),
            title: 'Jane Doe - Sunset at the beach | Facebook',
            description: 'Golden hour at the pier with friends.',
            ogUrl: contentOgUrl,
            canonicalUrl: contentOgUrl,
            markers: { ...noMarkers, hasLoginForm: true },
          }),
        ).toEqual({ trusted: true });
      });
    });

    describe('content-item identity and signal authority', () => {
      const TITLE = 'Jane Doe - Sunset at the beach | Facebook';
      const DESC = 'Golden hour at the pier with friends.';
      const GENERIC_DESC = 'See posts, photos and more on Facebook.';
      const fb = (path: string) => `https://www.facebook.com${path}`;
      const WRAPPER = '/share/p/SYNTHSHARE/';
      const ITEM = '/jane.doe/posts/123456';
      const ITEM_ALT = '/jane.doe/posts/pfbid0SynthItem';
      const PROFILE = '/SomeISP/';
      const decide = (
        finalPath: string,
        declared: { canonical?: string; og?: string } = {},
        text: { title?: string; description?: string } = { title: TITLE, description: DESC },
        markers = noMarkers,
      ) =>
        evaluateFacebookPageTrust({
          finalUrl: at(finalPath),
          title: text.title,
          description: text.description,
          canonicalUrl: declared.canonical && fb(declared.canonical),
          ogUrl: declared.og && fb(declared.og),
          markers,
        });

      it('1: wrapper + canonical same wrapper + non-generic title + generic description => reject', () => {
        expect(
          decide(WRAPPER, { canonical: WRAPPER, og: WRAPPER }, { title: TITLE, description: GENERIC_DESC }),
        ).toEqual({ trusted: false, reason: 'NO_CONTENT_ITEM' });
      });

      it('2: wrapper + specific title/description but no ITEM identity => reject', () => {
        expect(decide(WRAPPER)).toEqual({ trusted: false, reason: 'NO_CONTENT_ITEM' });
        expect(decide(WRAPPER, { canonical: WRAPPER })).toEqual({ trusted: false, reason: 'NO_CONTENT_ITEM' });
      });

      it('3: profile/page landing + specific title/description => reject', () => {
        expect(decide(PROFILE)).toEqual({ trusted: false, reason: 'PROFILE_OR_PAGE_LANDING' });
        expect(decide('/profile.php?id=123')).toEqual({ trusted: false, reason: 'PROFILE_OR_PAGE_LANDING' });
        expect(decide('/pages/Some-ISP/123')).toEqual({ trusted: false, reason: 'PROFILE_OR_PAGE_LANDING' });
      });

      it('4: ID-less page tab => reject', () => {
        expect(decide('/SomeISP/photos/')).toEqual({ trusted: false, reason: 'PROFILE_OR_PAGE_LANDING' });
        expect(decide('/SomeISP/videos/')).toEqual({ trusted: false, reason: 'PROFILE_OR_PAGE_LANDING' });
      });

      it('5: final ITEM + canonical same ITEM + specific text => trust', () => {
        expect(decide(ITEM, { canonical: ITEM })).toEqual({ trusted: true });
        expect(decide(ITEM)).toEqual({ trusted: true }); // no canonical: the page read is the item
      });

      it('6: final WRAPPER + canonical ITEM + specific text => trust (canonical is authoritative)', () => {
        expect(decide(WRAPPER, { canonical: ITEM })).toEqual({ trusted: true });
      });

      it('7: final ITEM + canonical PROFILE_OR_PAGE => reject', () => {
        expect(decide(ITEM, { canonical: PROFILE })).toEqual({ trusted: false, reason: 'PROFILE_OR_PAGE_LANDING' });
      });

      it('8: final ITEM + canonical ITEM + og:url PROFILE_OR_PAGE => not rejected for the ancillary og:url', () => {
        expect(decide(ITEM, { canonical: ITEM_ALT, og: PROFILE })).toEqual({ trusted: true });
      });

      it('9: final PROFILE_OR_PAGE + og:url ITEM (no canonical ITEM) => reject', () => {
        expect(decide(PROFILE, { og: ITEM })).toEqual({ trusted: false, reason: 'PROFILE_OR_PAGE_LANDING' });
      });

      it('9b: final PROFILE_OR_PAGE is never superseded, even by a canonical ITEM', () => {
        expect(decide(PROFILE, { canonical: ITEM })).toEqual({ trusted: false, reason: 'PROFILE_OR_PAGE_LANDING' });
      });

      it('10: final WRAPPER + og:url ITEM without canonical ITEM => reject', () => {
        expect(decide(WRAPPER, { og: ITEM })).toEqual({ trusted: false, reason: 'NO_CONTENT_ITEM' });
        expect(decide(WRAPPER, { canonical: WRAPPER, og: ITEM })).toEqual({ trusted: false, reason: 'NO_CONTENT_ITEM' });
      });

      it('10b: og:url ITEM does not rescue a canonical PROFILE_OR_PAGE', () => {
        expect(decide(WRAPPER, { canonical: PROFILE, og: ITEM })).toEqual({
          trusted: false,
          reason: 'PROFILE_OR_PAGE_LANDING',
        });
      });

      it('10c: final ITEM + canonical WRAPPER keeps the final item identity', () => {
        expect(decide(ITEM, { canonical: WRAPPER })).toEqual({ trusted: true });
      });

      it('11: login/checkpoint/consent markers without specific text still reject', () => {
        for (const marker of ['hasLoginForm', 'hasCheckpointForm', 'hasConsentDialog'] as const) {
          expect(
            decide(ITEM, { canonical: ITEM }, { title: TITLE, description: 'Log in to Facebook to see more.' }, {
              ...noMarkers,
              [marker]: true,
            }),
          ).toEqual({ trusted: false, reason: 'LOGIN_OR_CHECKPOINT_MARKERS' });
        }
      });

      it('12: generic title on a valid ITEM => reject', () => {
        expect(decide(ITEM, { canonical: ITEM }, { title: 'Facebook', description: DESC })).toEqual({
          trusted: false,
          reason: 'GENERIC_TITLE',
        });
      });

      it('13: valid ITEM + generic or empty description => reject', () => {
        expect(decide(ITEM, { canonical: ITEM }, { title: TITLE, description: GENERIC_DESC })).toEqual({
          trusted: false,
          reason: 'INSUFFICIENT_CONTENT_EVIDENCE',
        });
        expect(decide(ITEM, { canonical: ITEM }, { title: TITLE })).toEqual({
          trusted: false,
          reason: 'INSUFFICIENT_CONTENT_EVIDENCE',
        });
      });

      it('final ROOT => reject', () => {
        expect(decide('/')).toEqual({ trusted: false, reason: 'NO_CONTENT_ITEM' });
      });

      it('describeFacebookPageSignals exposes classes and booleans only', () => {
        const label = describeFacebookPageSignals({
          finalUrl: at(WRAPPER),
          title: 'SENTINELTITLE',
          description: 'SENTINELDESC',
          canonicalUrl: fb(ITEM),
          ogUrl: 'https://example.com/SENTINELPATH',
          markers: { ...noMarkers, hasConsentDialog: true },
        });
        expect(label).toBe(
          'fb_final=WRAPPER fb_canonical=ITEM fb_og=non_facebook markers=consent title_generic=false desc_generic=false',
        );
      });
    });

    describe('classifyFacebookUrl (strict anchored taxonomy)', () => {
      it.each([
        'https://www.facebook.com/jane.doe/posts/123456',
        'https://www.facebook.com/jane.doe/posts/pfbid02SynthABC/',
        'https://m.facebook.com/permalink.php?story_fbid=123&id=456',
        'https://www.facebook.com/story.php?story_fbid=pfbid0Synth&id=4',
        'https://www.facebook.com/permalink.php?story_fbid=pfbidSYNTH&id=4',
        'https://www.facebook.com/photo.php?fbid=123456',
        'https://www.facebook.com/photo/?fbid=123456',
        'https://www.facebook.com/jane.doe/photos/a.111/222/',
        'https://www.facebook.com/jane.doe/photos/333',
        'https://www.facebook.com/jane.doe/photos/123/',
        'https://www.facebook.com/jane.doe/videos/123',
        'https://www.facebook.com/jane.doe/videos/444/',
        'https://www.facebook.com/jane.doe/videos/some-title/555/',
        'https://www.facebook.com/watch/?v=666',
        'https://www.facebook.com/reel/777',
        'https://www.facebook.com/groups/somegroup/posts/888/',
        'https://www.facebook.com/groups/123/permalink/999/',
        'https://www.facebook.com/events/101010/',
        'https://www.facebook.com/marketplace/item/121212/',
      ])('ITEM: %s', (url) => {
        expect(classifyFacebookUrl(new URL(url))).toBe('ITEM');
      });

      it.each([
        'https://www.facebook.com/share/p/SYNTH/',
        'https://www.facebook.com/share/v/SYNTH/',
        'https://www.facebook.com/share/r/SYNTH/',
        'https://www.facebook.com/share/SYNTH',
        'https://www.facebook.com/l.php?u=https%3A%2F%2Fexample.com',
        'https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.com',
        'https://fb.me/SYNTH',
        'https://fb.watch/SYNTH/',
      ])('WRAPPER: %s', (url) => {
        expect(classifyFacebookUrl(new URL(url))).toBe('WRAPPER');
      });

      it.each([
        'https://www.facebook.com/SomeISP/',
        'https://www.facebook.com/SomeISP',
        'https://www.facebook.com/profile.php?id=123',
        'https://www.facebook.com/pages/Some-ISP/123456',
        'https://www.facebook.com/people/Jane-Doe/100000/',
        'https://www.facebook.com/SomeISP/photos/',
        'https://www.facebook.com/SomeISP/videos/',
        'https://www.facebook.com/SomeISP/posts/',
        'https://www.facebook.com/SomeISP/photos/a.111/',
        'https://www.facebook.com/watch/',
        'https://www.facebook.com/watch/?v=notanid',
        'https://www.facebook.com/permalink.php?id=456',
        'https://www.facebook.com/photo.php?fbid=',
        'https://www.facebook.com/events/',
        'https://www.facebook.com/reel/',
        'https://www.facebook.com/groups/somegroup/',
        'https://www.facebook.com/some/unknown/format/123',
        // More than one intermediate segment under photos/videos is not an evidenced item shape.
        'https://www.facebook.com/SomeISP/photos/tab/archive/123',
        'https://www.facebook.com/SomeISP/videos/list/archive/123',
        // pfbid is accepted only for post paths and story_fbid; elsewhere it fails closed.
        'https://www.facebook.com/groups/g/posts/pfbidSYNTH',
        'https://www.facebook.com/groups/g/permalink/pfbidSYNTH',
        'https://www.facebook.com/photo.php?fbid=pfbidSYNTH',
        'https://www.facebook.com/photo/?fbid=pfbidSYNTH',
        'https://www.facebook.com/watch?v=pfbidSYNTH',
        'https://www.facebook.com/watch/?v=pfbidSYNTH',
      ])('PROFILE_OR_PAGE (fail closed): %s', (url) => {
        expect(classifyFacebookUrl(new URL(url))).toBe('PROFILE_OR_PAGE');
      });

      it('ROOT and INTERSTITIAL', () => {
        expect(classifyFacebookUrl(new URL('https://www.facebook.com/'))).toBe('ROOT');
        expect(classifyFacebookUrl(new URL('https://www.facebook.com/login/?next=x'))).toBe('INTERSTITIAL');
        expect(classifyFacebookUrl(new URL('https://www.facebook.com/checkpoint/1/'))).toBe('INTERSTITIAL');
        expect(classifyFacebookUrl(new URL('https://login.facebook.com/'))).toBe('INTERSTITIAL');
      });
    });

    describe('isFacebookFamilyUrl', () => {
      it.each([
        'https://www.facebook.com/share/p/abc/',
        'https://m.facebook.com/story.php?id=1',
        'https://fb.watch/xyz/',
        'www.facebook.com/share/p/abc/',
        'facebook.com/jane.doe/posts/1',
        '  m.facebook.com/share/v/abc  ',
        'fb.me/abc',
        'www.facebook.com:443/share/p/abc/',
      ])('recognises %s', (url) => {
        expect(isFacebookFamilyUrl(url)).toBe(true);
      });

      it.each([
        'https://www.facebook.com.example.com/share/p/abc/',
        'www.facebook.com.example.com/share/p/abc/',
        'https://notfacebook.com/share/p/abc/',
        'https://example.com/?next=www.facebook.com',
        'https://example.com/www.facebook.com/share',
        'ftp://example.com/facebook.com',
        'not a url',
        '',
      ])('does not recognise %s', (url) => {
        expect(isFacebookFamilyUrl(url)).toBe(false);
      });
    });
  });
});
