import { Injectable, Logger } from '@nestjs/common';
import { load } from 'cheerio';
import { URL } from 'node:url';
import { promises as dns } from 'node:dns';

interface UrlMetadata {
  title?: string;
  description?: string;
  imageUrl?: string;
}

@Injectable()
export class UrlMetadataService {
  private readonly logger = new Logger(UrlMetadataService.name);
  private readonly REQUEST_TIMEOUT_MS = 5000;
  private readonly MAX_RESPONSE_SIZE = 2 * 1024 * 1024; // 2 MB
  private readonly MAX_REDIRECTS = 3;

  async fetchMetadata(urlString: string): Promise<UrlMetadata | null> {
    try {
      const parsedUrl = this.validateUrl(urlString);
      if (!parsedUrl) {
        return null;
      }

      // SSRF protection: resolve hostname and validate before making request
      const hostname = parsedUrl.hostname;
      if (!(await this.isValidHostname(hostname))) {
        this.logger.warn(`Invalid hostname for metadata fetch: ${hostname}`);
        return null;
      }

      const html = await this.fetchHtml(urlString);
      if (!html) {
        return null;
      }

      return this.extractMetadata(html);
    } catch (err) {
      this.logger.warn(
        `Failed to fetch URL metadata for ${urlString}: ${(err as Error).message}`,
      );
      return null;
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
        `Failed to fetch image bytes from ${urlString}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async fetchHtml(urlString: string): Promise<string | null> {
    try {
      const result = await this.fetchWithValidation(urlString);
      if (!result || !result.text) {
        return null;
      }
      return result.text;
    } catch (err) {
      this.logger.warn(
        `Failed to fetch HTML from ${urlString}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async fetchWithValidation(
    urlString: string,
  ): Promise<
    | { text: string; buffer?: never; mimeType?: never }
    | { buffer: Buffer; mimeType: string; text?: never }
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
            this.logger.warn(`Redirect without Location header from ${currentUrl}`);
            return null;
          }

          redirectCount++;
          if (redirectCount > this.MAX_REDIRECTS) {
            this.logger.warn(
              `Too many redirects (>${this.MAX_REDIRECTS}) starting from ${urlString}`,
            );
            return null;
          }

          // Resolve Location header relative to current URL
          let redirectUrl: URL;
          try {
            redirectUrl = new URL(location, currentUrl);
          } catch {
            this.logger.warn(`Invalid redirect URL: ${location}`);
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
          return null;
        }

        // Check content-length header to avoid buffering huge responses
        const contentLength = response.headers.get('content-length');
        if (contentLength && parseInt(contentLength, 10) > this.MAX_RESPONSE_SIZE) {
          this.logger.warn(
            `Response too large (${contentLength} bytes) for ${currentUrl}`,
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
              `Response exceeded size limit for ${currentUrl}`,
            );
            return null;
          }
        }

        const buffer = Buffer.concat(chunks);

        // Return text or binary based on content type
        if (isTextContent) {
          const decoder = new TextDecoder();
          const text = decoder.decode(buffer);
          return { text };
        } else {
          // Extract MIME type from Content-Type header
          const mimeType = contentType.split(';')[0].trim();
          return { buffer, mimeType };
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          this.logger.warn(`URL fetch timeout for ${currentUrl}`);
        } else {
          this.logger.warn(
            `Failed to fetch from ${currentUrl}: ${(err as Error).message}`,
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

      // Extract Open Graph tags
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

      return metadata;
    } catch (err) {
      this.logger.warn(
        `Failed to extract metadata from HTML: ${(err as Error).message}`,
      );
      return {};
    }
  }
}
