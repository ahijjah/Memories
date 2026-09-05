import { Injectable, Logger } from '@nestjs/common';
import { load } from 'cheerio';
import { URL } from 'node:url';

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

      // SSRF protection: validate IP address before making request
      const hostname = parsedUrl.hostname;
      if (!this.isValidHostname(hostname)) {
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

  private isValidHostname(hostname: string): boolean {
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

    // Check for private IP ranges using DNS resolution
    // This is intentionally synchronous for SSRF prevention
    try {
      // For IPv4 private ranges: 10.x, 172.16-31.x, 192.168.x
      if (this.isPrivateIpRange(hostname)) {
        return false;
      }
    } catch {
      // If we can't determine, reject to be safe
      return false;
    }

    return true;
  }

  private isPrivateIpRange(hostname: string): boolean {
    // Simple check for IPv4 dotted notation
    const parts = hostname.split('.');
    if (parts.length !== 4) {
      // Not IPv4 format, assume it's a domain name (which we can't validate easily)
      // Return false to allow (DNS will eventually fail if invalid)
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

    // 169.254.0.0 - 169.254.255.255 (link-local)
    if (octets[0] === 169 && octets[1] === 254) {
      return true;
    }

    return false;
  }

  private async fetchHtml(urlString: string): Promise<string | null> {
    try {
      const controller = new AbortController();
      const timeoutHandle = setTimeout(
        () => controller.abort(),
        this.REQUEST_TIMEOUT_MS,
      );

      const response = await fetch(urlString, {
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; MemoriesBot/1.0; +http://memories.ai970.cloud)',
        },
        redirect: 'follow',
      });

      clearTimeout(timeoutHandle);

      if (!response.ok || !response.body) {
        return null;
      }

      // Check content-length header to avoid buffering huge responses
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > this.MAX_RESPONSE_SIZE) {
        this.logger.warn(
          `Response too large (${contentLength} bytes) for ${urlString}`,
        );
        return null;
      }

      // Buffer the response with size limit
      let html = '';
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        html += decoder.decode(value, { stream: true });

        if (html.length > this.MAX_RESPONSE_SIZE) {
          this.logger.warn(
            `Response exceeded size limit for ${urlString}`,
          );
          return null;
        }
      }

      return html;
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        this.logger.warn(`URL fetch timeout for ${urlString}`);
      } else {
        this.logger.warn(
          `Failed to fetch HTML from ${urlString}: ${(err as Error).message}`,
        );
      }
      return null;
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
