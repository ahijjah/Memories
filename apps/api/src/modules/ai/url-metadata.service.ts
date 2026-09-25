import { Injectable, Logger } from '@nestjs/common';
import { load } from 'cheerio';
import { URL } from 'node:url';
import { promises as dns } from 'node:dns';
import {
  PageMarkers,
  PageRejectReason,
  describeFacebookPageSignals,
  evaluateFacebookPageTrust,
  hostOf,
  isFacebookFamilyHost,
} from './url-page-trust';

export interface UrlMetadata {
  title?: string;
  description?: string;
  imageUrl?: string;
  author?: string;
  datePublished?: string;
  price?: string;
  priceCurrency?: string;
  brand?: string;
  sku?: string;
  availability?: string;
}

export type UrlMetadataUnavailableReason = 'INVALID_URL' | 'HOST_REJECTED' | 'FETCH_FAILED';

// Only an 'ok' result carries page-derived evidence (metadata, og:image). A rejected or
// unavailable page exposes nothing, so none of its content can reach the AI.
export type UrlMetadataResult =
  | {
      status: 'ok';
      metadata: UrlMetadata;
      requestedHost: string;
      finalHost: string;
      redirectCount: number;
    }
  | {
      status: 'rejected';
      reason: PageRejectReason;
      requestedHost: string;
      finalHost: string;
      redirectCount: number;
    }
  | {
      status: 'unavailable';
      reason: UrlMetadataUnavailableReason;
      requestedHost: string;
    };

interface FetchedResource {
  finalUrl: URL;
  redirectCount: number;
}

@Injectable()
export class UrlMetadataService {
  private readonly logger = new Logger(UrlMetadataService.name);
  private readonly REQUEST_TIMEOUT_MS = 5000;
  private readonly MAX_RESPONSE_SIZE = 2 * 1024 * 1024; // 2 MB
  private readonly MAX_REDIRECTS = 3;

  async fetchMetadata(urlString: string): Promise<UrlMetadataResult> {
    const { result, facebookSignals } = await this.fetchMetadataResult(urlString);
    const finalHost = result.status === 'unavailable' ? '-' : result.finalHost;
    const redirects = result.status === 'unavailable' ? '-' : result.redirectCount;
    const reason = result.status === 'ok' ? '-' : result.reason;
    this.logger.debug(
      `metadata fetch host=${result.requestedHost} final_host=${finalHost} redirects=${redirects} result=${result.status} reason=${reason}` +
        (facebookSignals ? ` ${facebookSignals}` : ''),
    );
    return result;
  }

  // `facebookSignals` holds non-identifying class/boolean labels for the debug line only; it
  // never becomes part of the returned result.
  private async fetchMetadataResult(
    urlString: string,
  ): Promise<{ result: UrlMetadataResult; facebookSignals?: string }> {
    const requestedHost = hostOf(urlString);
    try {
      const parsedUrl = this.validateUrl(urlString);
      if (!parsedUrl) {
        return { result: { status: 'unavailable', reason: 'INVALID_URL', requestedHost } };
      }

      // SSRF protection: resolve hostname and validate before making request
      const hostname = parsedUrl.hostname;
      if (!(await this.isValidHostname(hostname))) {
        this.logger.warn(`Invalid hostname for metadata fetch: ${hostname}`);
        return { result: { status: 'unavailable', reason: 'HOST_REJECTED', requestedHost } };
      }

      const page = await this.fetchHtml(urlString);
      if (!page) {
        return { result: { status: 'unavailable', reason: 'FETCH_FAILED', requestedHost } };
      }

      const metadata = this.extractMetadata(page.html);
      const finalHost = page.finalUrl.hostname;

      // Facebook page-derived content is deny-by-default for AI enrichment: a Facebook-family
      // source or final host never yields `ok`, whatever the page looks like. Classification
      // still runs for sanitized diagnostics and to keep a more specific rejection reason.
      const facebookInvolved = isFacebookFamilyHost(hostname) || isFacebookFamilyHost(finalHost);
      let facebookReason: PageRejectReason = 'FACEBOOK_DENY_BY_DEFAULT';
      let facebookSignals: string | undefined;
      if (isFacebookFamilyHost(finalHost)) {
        const signals = this.extractPageSignals(page.html);
        const pageSignals = {
          finalUrl: page.finalUrl,
          title: metadata.title,
          description: metadata.description,
          ogUrl: signals.ogUrl,
          canonicalUrl: signals.canonicalUrl,
          markers: signals.markers,
        };
        facebookSignals = describeFacebookPageSignals(pageSignals);
        const decision = evaluateFacebookPageTrust(pageSignals);
        if (!decision.trusted) {
          facebookReason = decision.reason;
        }
      }

      if (facebookInvolved) {
        return {
          result: {
            status: 'rejected',
            reason: facebookReason,
            requestedHost,
            finalHost,
            redirectCount: page.redirectCount,
          },
          facebookSignals,
        };
      }

      return {
        result: {
          status: 'ok',
          metadata,
          requestedHost,
          finalHost,
          redirectCount: page.redirectCount,
        },
        facebookSignals,
      };
    } catch (err) {
      this.logger.warn(
        `Failed to fetch URL metadata for host ${requestedHost}: ${(err as Error).name}`,
      );
      return { result: { status: 'unavailable', reason: 'FETCH_FAILED', requestedHost } };
    }
  }

  private validateUrl(urlString: string): URL | null {
    try {
      const url = new URL(urlString);
      // Only allow http and https schemes
      if (!['http:', 'https:'].includes(url.protocol)) {
        return null;
      }
      return url;
    } catch {
      return null;
    }
  }

  private async isValidHostname(hostname: string): Promise<boolean> {
    // Reject obviously invalid hostnames
    if (!hostname || hostname.length === 0) {
      return false;
    }

    // Reject localhost and loopback ranges
    if (
      hostname === 'localhost' ||
      hostname.startsWith('127.') ||
      hostname === '::1'
    ) {
      return false;
    }

    // Reject cloud metadata endpoints
    if (
      hostname === '169.254.169.254' ||
      hostname === 'metadata.google.internal' ||
      hostname.endsWith('.local')
    ) {
      return false;
    }

    // DNS rebinding protection: resolve hostname to actual IP addresses
    // and validate each one against private/internal ranges
    try {
      return await this.validateResolvedIps(hostname);
    } catch (err) {
      this.logger.warn(`DNS resolution failed for ${hostname}: ${(err as Error).message}`);
      // Reject on resolution failure to be safe
      return false;
    }
  }

  private async validateResolvedIps(hostname: string): Promise<boolean> {
    try {
      // Resolve to both IPv4 and IPv6 addresses
      const addresses = await dns.resolve4(hostname, { ttl: true }).catch(() => []);
      const addressesIpv6 = await dns.resolve6(hostname, { ttl: true }).catch(() => []);

      // If no addresses resolved, reject
      if (addresses.length === 0 && addressesIpv6.length === 0) {
        return false;
      }

      // Check all IPv4 addresses
      for (const addr of addresses) {
        const address = typeof addr === 'string' ? addr : addr.address;
        if (this.isPrivateIpv4(address)) {
          this.logger.warn(`${hostname} resolves to private IPv4: ${address}`);
          return false;
        }
      }

      // Check all IPv6 addresses
      for (const addr of addressesIpv6) {
        const address = typeof addr === 'string' ? addr : addr.address;
        if (this.isPrivateIpv6(address)) {
          this.logger.warn(`${hostname} resolves to private IPv6: ${address}`);
          return false;
        }
      }

      return true;
    } catch (err) {
      this.logger.warn(`Failed to resolve ${hostname}: ${(err as Error).message}`);
      return false;
    }
  }

  private isPrivateIpv4(ip: string): boolean {
    const parts = ip.split('.');
    if (parts.length !== 4) {
      return false;
    }

    const octets = parts.map((p) => parseInt(p, 10));
    if (octets.some((o) => isNaN(o) || o < 0 || o > 255)) {
      return false;
    }

    // 10.0.0.0 - 10.255.255.255
    if (octets[0] === 10) {
      return true;
    }

    // 172.16.0.0 - 172.31.255.255
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) {
      return true;
    }

    // 192.168.0.0 - 192.168.255.255
    if (octets[0] === 192 && octets[1] === 168) {
      return true;
    }

    // 169.254.0.0 - 169.254.255.255 (link-local/APIPA)
    if (octets[0] === 169 && octets[1] === 254) {
      return true;
    }

    // 127.0.0.0 - 127.255.255.255 (loopback)
    if (octets[0] === 127) {
      return true;
    }

    return false;
  }

  private isPrivateIpv6(ip: string): boolean {
    const normalized = ip.toLowerCase();

    // ::1 (loopback)
    if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') {
      return true;
    }

    // fc00::/7 (unique local)
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) {
      return true;
    }

    // fe80::/10 (link-local)
    if (normalized.startsWith('fe8') || normalized.startsWith('fe9') ||
        normalized.startsWith('fea') || normalized.startsWith('feb')) {
      return true;
    }

    return false;
  }

  async fetchImageBytes(
    urlString: string,
  ): Promise<{ data: Buffer; mimeType: string } | null> {
    try {
      const parsedUrl = this.validateUrl(urlString);
      if (!parsedUrl) {
        return null;
      }

      // SSRF protection: validate hostname before making request
      if (!(await this.isValidHostname(parsedUrl.hostname))) {
        this.logger.warn(`Invalid hostname for image fetch: ${parsedUrl.hostname}`);
        return null;
      }

      const result = await this.fetchWithValidation(urlString);
      if (!result || !result.buffer || !result.mimeType) {
        return null;
      }

      // Only accept image MIME types that Claude's vision API supports
      const supportedMimeTypes = [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
      ];
      if (!supportedMimeTypes.includes(result.mimeType)) {
        this.logger.warn(
          `Unsupported image MIME type for vision analysis: ${result.mimeType}`,
        );
        return null;
      }

      return { data: result.buffer, mimeType: result.mimeType };
    } catch (err) {
      this.logger.warn(
        `Failed to fetch image bytes from host ${hostOf(urlString)}: ${(err as Error).name}`,
      );
      return null;
    }
  }

  private async fetchHtml(
    urlString: string,
  ): Promise<{ html: string; finalUrl: URL; redirectCount: number } | null> {
    try {
      const result = await this.fetchWithValidation(urlString);
      if (!result || !result.text) {
        return null;
      }
      return { html: result.text, finalUrl: result.finalUrl, redirectCount: result.redirectCount };
    } catch (err) {
      this.logger.warn(
        `Failed to fetch HTML from host ${hostOf(urlString)}: ${(err as Error).name}`,
      );
      return null;
    }
  }

  private async fetchWithValidation(
    urlString: string,
  ): Promise<
    | (FetchedResource & { text: string; buffer?: never; mimeType?: never })
    | (FetchedResource & { buffer: Buffer; mimeType: string; text?: never })
    | null
  > {
    let currentUrl = urlString;
    let redirectCount = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const controller = new AbortController();
        const timeoutHandle = setTimeout(
          () => controller.abort(),
          this.REQUEST_TIMEOUT_MS,
        );

        const response = await fetch(currentUrl, {
          signal: controller.signal,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (compatible; MemoriesBot/1.0; +http://memories.ai970.cloud)',
          },
          redirect: 'manual', // Don't follow redirects automatically
        });

        clearTimeout(timeoutHandle);

        // Handle redirects manually with re-validation
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) {
            this.logger.warn(`Redirect without Location header from host ${hostOf(currentUrl)}`);
            return null;
          }

          redirectCount++;
          if (redirectCount > this.MAX_REDIRECTS) {
            this.logger.warn(
              `Too many redirects (>${this.MAX_REDIRECTS}) starting from host ${hostOf(urlString)}`,
            );
            return null;
          }

          // Resolve Location header relative to current URL
          let redirectUrl: URL;
          try {
            redirectUrl = new URL(location, currentUrl);
          } catch {
            this.logger.warn(`Invalid redirect Location header from host ${hostOf(currentUrl)}`);
            return null;
          }

          // Re-validate the redirect target before following
          if (redirectUrl.protocol !== 'http:' && redirectUrl.protocol !== 'https:') {
            this.logger.warn(`Redirect to non-http(s) scheme: ${redirectUrl.protocol}`);
            return null;
          }

          if (!(await this.isValidHostname(redirectUrl.hostname))) {
            this.logger.warn(
              `Redirect target failed validation: ${redirectUrl.hostname}`,
            );
            return null;
          }

          currentUrl = redirectUrl.toString();
          continue; // Follow the validated redirect
        }

        if (!response.ok || !response.body) {
          if (!response.ok) {
            this.logger.warn(
              `Non-OK response (status ${response.status}) from host ${hostOf(currentUrl)}`,
            );
          }
          return null;
        }

        // Check content-length header to avoid buffering huge responses
        const contentLength = response.headers.get('content-length');
        if (contentLength && parseInt(contentLength, 10) > this.MAX_RESPONSE_SIZE) {
          this.logger.warn(
            `Response too large (${contentLength} bytes) from host ${hostOf(currentUrl)}`,
          );
          return null;
        }

        // Determine response type based on Content-Type header
        const contentType = response.headers.get('content-type') || '';
        const isTextContent =
          contentType.includes('text/') ||
          contentType.includes('application/json') ||
          contentType.includes('application/xml');

        // Buffer the response with size limit
        const chunks: Buffer[] = [];
        const reader = response.body.getReader();

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          if (value) {
            chunks.push(Buffer.from(value));
          }

          const totalSize = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
          if (totalSize > this.MAX_RESPONSE_SIZE) {
            this.logger.warn(
              `Response exceeded size limit from host ${hostOf(currentUrl)}`,
            );
            return null;
          }
        }

        const buffer = Buffer.concat(chunks);
        const fetched: FetchedResource = { finalUrl: new URL(currentUrl), redirectCount };

        // Return text or binary based on content type
        if (isTextContent) {
          const decoder = new TextDecoder();
          const text = decoder.decode(buffer);
          return { ...fetched, text };
        } else {
          // Extract MIME type from Content-Type header
          const mimeType = contentType.split(';')[0].trim();
          return { ...fetched, buffer, mimeType };
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          this.logger.warn(`URL fetch timeout for host ${hostOf(currentUrl)}`);
        } else {
          this.logger.warn(
            `Failed to fetch from host ${hostOf(currentUrl)}: ${(err as Error).name}`,
          );
        }
        return null;
      }
    }
  }

  private extractMetadata(html: string): UrlMetadata {
    try {
      const $ = load(html);

      const metadata: UrlMetadata = {};

      // Extract Open Graph tags (takes priority for title, description, image)
      const ogTitle = $('meta[property="og:title"]').attr('content');
      const ogDescription = $('meta[property="og:description"]').attr(
        'content',
      );
      const ogImage = $('meta[property="og:image"]').attr('content');

      // Use Open Graph title, fall back to <title>
      metadata.title =
        ogTitle || $('title').text() || undefined;

      // Use Open Graph description
      metadata.description =
        ogDescription ||
        $('meta[name="description"]').attr('content') ||
        undefined;

      // Store Open Graph image URL
      metadata.imageUrl = ogImage || undefined;

      // Extract JSON-LD structured data for new fields
      this.extractJsonLd($, metadata);

      return metadata;
    } catch (err) {
      this.logger.warn(
        `Failed to extract metadata from HTML: ${(err as Error).message}`,
      );
      return {};
    }
  }

  private extractPageSignals(html: string): {
    ogUrl?: string;
    canonicalUrl?: string;
    markers: PageMarkers;
  } {
    try {
      const $ = load(html);
      return {
        ogUrl: $('meta[property="og:url"]').attr('content') || undefined,
        canonicalUrl: $('link[rel="canonical"]').attr('href') || undefined,
        markers: {
          hasLoginForm:
            $('form#login_form').length > 0 ||
            $('form[action*="/login"]').length > 0 ||
            ($('input[name="email"]').length > 0 && $('input[name="pass"]').length > 0),
          hasCheckpointForm:
            $('form[action*="/checkpoint"]').length > 0 ||
            $('#checkpointSubmitButton').length > 0,
          hasConsentDialog:
            $('[data-testid="cookie-policy-manage-dialog"]').length > 0 ||
            $('form[action*="/cookie/consent"]').length > 0 ||
            $('[data-cookiebanner]').length > 0,
        },
      };
    } catch {
      return { markers: { hasLoginForm: false, hasCheckpointForm: false, hasConsentDialog: false } };
    }
  }

  private extractJsonLd(
    $: ReturnType<typeof load>,
    metadata: UrlMetadata,
  ): void {
    try {
      const jsonLdScripts = $('script[type="application/ld+json"]');

      for (let i = 0; i < jsonLdScripts.length; i++) {
        const scriptContent = $(jsonLdScripts[i]).html();
        if (!scriptContent) continue;

        let schemas: any[] = [];

        try {
          const parsed = JSON.parse(scriptContent);

          // Handle @graph wrapper (array of entities)
          if (parsed['@graph']) {
            schemas = Array.isArray(parsed['@graph'])
              ? parsed['@graph']
              : [parsed['@graph']];
          } else if (Array.isArray(parsed)) {
            // Direct array of schemas
            schemas = parsed;
          } else {
            // Single schema object
            schemas = [parsed];
          }
        } catch {
          // Skip malformed JSON-LD blocks
          continue;
        }

        // Process each schema entity
        for (const schema of schemas) {
          if (!schema['@type']) continue;

          const types = Array.isArray(schema['@type'])
            ? schema['@type']
            : [schema['@type']];

          // Look for Article types
          if (
            types.some((t: string) =>
              ['Article', 'NewsArticle', 'BlogPosting'].includes(t),
            )
          ) {
            // Extract author (handle string, object, and array)
            if (!metadata.author && schema.author) {
              const author = this.extractAuthor(schema.author);
              if (author) metadata.author = author;
            }

            // Extract datePublished
            if (!metadata.datePublished && schema.datePublished) {
              metadata.datePublished = String(schema.datePublished);
            }
          }

          // Look for Product type
          if (types.includes('Product')) {
            // Extract brand (string or object with name)
            if (!metadata.brand && schema.brand) {
              metadata.brand = this.extractBrand(schema.brand);
            }

            // Extract SKU
            if (!metadata.sku && schema.sku) {
              metadata.sku = String(schema.sku);
            }

            // Extract price and currency from offers
            if (schema.offers && !metadata.price) {
              const offers = Array.isArray(schema.offers)
                ? schema.offers[0]
                : schema.offers;

              if (offers) {
                if (offers.price) metadata.price = String(offers.price);
                if (offers.priceCurrency)
                  metadata.priceCurrency = String(offers.priceCurrency);
                if (offers.availability)
                  metadata.availability = String(offers.availability);
              }
            }
          }
        }
      }
    } catch (err) {
      this.logger.debug(
        `Error extracting JSON-LD: ${(err as Error).message}`,
      );
    }
  }

  private extractAuthor(author: any): string | undefined {
    if (typeof author === 'string') {
      return author || undefined;
    }

    if (Array.isArray(author)) {
      // Take first author
      const first = author[0];
      if (typeof first === 'string') return first || undefined;
      if (first && typeof first === 'object' && first.name) {
        return String(first.name) || undefined;
      }
    }

    if (author && typeof author === 'object' && author.name) {
      return String(author.name) || undefined;
    }

    return undefined;
  }

  private extractBrand(brand: any): string | undefined {
    if (typeof brand === 'string') {
      return brand || undefined;
    }

    if (brand && typeof brand === 'object' && brand.name) {
      return String(brand.name) || undefined;
    }

    return undefined;
  }
}
