import { Test, TestingModule } from '@nestjs/testing';
import { UrlMetadataService } from './url-metadata.service';

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
});
