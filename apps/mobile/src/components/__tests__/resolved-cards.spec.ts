import React from 'react';
import TestRenderer, { act, ReactTestInstance } from 'react-test-renderer';
import type { Memory } from '@/src/api/client';
import type { ResolvedMemoryView } from '@/src/api/resolved';
import { resolveCardType } from '../memory-cards/cardTypeResolver';
import { CompactCard } from '../memory-cards/CompactCard';
import { ShareCardView } from '../memory-cards/ShareCardView';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  Image: 'Image',
}));
jest.mock('../AuthenticatedAssetImage', () => ({ AuthenticatedAssetImage: 'AuthenticatedAssetImage' }));

const baseMemory = (overrides: Partial<Memory> = {}): Memory => ({
  id: 'mem-1',
  userId: 'user-1',
  sourceType: 'url',
  title: 'https://example.com/raw',
  memoryType: 'event',
  capturedAt: '2026-09-01T10:00:00Z',
  processingState: 'understood',
  lifecycleState: 'active',
  securityScope: 'private',
  idempotencyKey: 'idem',
  createdAt: '2026-09-01T10:00:00Z',
  updatedAt: '2026-09-01T10:00:00Z',
  ...overrides,
});

const rawInference = (field: string, valueJson: unknown) => ({
  id: `inf-${field}`,
  memoryId: 'mem-1',
  field,
  valueJson,
  confidence: 0.99,
  modelVersion: 't',
  createdAt: '2026-09-01T10:00:00Z',
});

function textOf(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('');
}

function renderText(element: React.ReactElement): string {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  const text = textOf(renderer.root);
  act(() => renderer.unmount());
  return text;
}

describe('resolveCardType', () => {
  it.each([
    ['EVENT', 'event'],
    ['PLACE', 'place'],
    ['PRODUCT', 'product'],
    ['OFFER', 'offer'],
    ['ARTICLE_LEARNING', 'article_learning'],
    ['VIDEO_SOCIAL', 'video_social'],
    ['DOCUMENT', 'document'],
    ['GENERIC', 'generic'],
  ] as const)('maps resolved %s to the %s card', (type, cardType) => {
    const resolved: ResolvedMemoryView = { type: { value: type, source: 'ai', confidence: 0.9 } };
    expect(resolveCardType(baseMemory({ memoryType: 'note', resolved }))).toBe(cardType);
  });

  it('resolved type beats a conflicting raw memoryType', () => {
    const resolved: ResolvedMemoryView = { type: { value: 'PLACE', source: 'user', confidence: null } };
    expect(resolveCardType(baseMemory({ memoryType: 'event', resolved }))).toBe('place');
  });

  it('renders generic when resolved exists without a type, never falling back to raw memoryType', () => {
    expect(resolveCardType(baseMemory({ memoryType: 'event', resolved: {} }))).toBe('generic');
  });

  it('keeps the legacy mapping when resolved is absent', () => {
    expect(resolveCardType(baseMemory({ memoryType: 'tutorial' }))).toBe('article_learning');
    expect(resolveCardType(baseMemory({ memoryType: 'post' }))).toBe('video_social');
    expect(resolveCardType(baseMemory({ memoryType: 'EVENT' }))).toBe('event');
    expect(resolveCardType(baseMemory({ memoryType: undefined }))).toBe('generic');
    expect(resolveCardType(undefined)).toBe('generic');
  });
});

describe('CompactCard', () => {
  it('uses the resolved preview for title, type and snippet (GET /memories)', () => {
    const text = renderText(
      React.createElement(CompactCard, { memory: baseMemory({
          memoryType: 'event',
          aiInferences: [rawInference('price', '$999')],
          resolved: {
            title: { value: 'MacBook Air', source: 'user', confidence: null },
            type: { value: 'PRODUCT', source: 'ai', confidence: 0.9 },
            price: { value: '$1,099', source: 'ai', confidence: 0.8 },
          },
        }) }),
    );
    expect(text).toContain('MacBook Air');
    expect(text).toContain('Product');
    expect(text).toContain('$1,099');
    expect(text).not.toContain('$999');
    expect(text).not.toContain('https://example.com/raw');
  });

  it('does not fall back to raw inferences or raw title for keys missing from resolved', () => {
    const text = renderText(
      React.createElement(CompactCard, { memory: baseMemory({
          aiInferences: [rawInference('price', '$999')],
          resolved: { type: { value: 'PRODUCT', source: 'ai', confidence: 0.9 } },
        }) }),
    );
    expect(text).not.toContain('$999');
    expect(text).not.toContain('https://example.com/raw');
    expect(text).toContain('url Memory');
  });

  it('keeps the legacy behaviour for objects without resolved (Collections, Vault list, Workspaces)', () => {
    const collectionStyle = renderText(
      React.createElement(CompactCard, { memory: baseMemory({ memoryType: 'product', aiInferences: [rawInference('price', '$999')] }) }),
    );
    expect(collectionStyle).toContain('https://example.com/raw');
    expect(collectionStyle).toContain('$999');

    const vaultListStyle = renderText(React.createElement(CompactCard, { memory: baseMemory({ title: undefined, memoryType: 'document' }) }));
    expect(vaultListStyle).toContain('url Memory');

    const workspaceStyle = renderText(
      React.createElement(CompactCard, { memory: baseMemory({ title: 'Server-resolved workspace title', memoryType: 'PLACE' }) }),
    );
    expect(workspaceStyle).toContain('Server-resolved workspace title');
  });
});

describe('ShareCardView', () => {
  const fieldProps = {
    aiSummary: null,
    aiTopics: null,
    aiIntent: null,
    aiEntities: null,
    aiLocation: null,
    aiDate: null,
    aiBrand: null,
    aiModel: null,
    aiPrice: null,
    aiCategory: null,
    aiMerchant: null,
    aiOriginalPrice: null,
    aiOfferPrice: null,
    aiDiscount: null,
    aiPromoCode: null,
    sourceUri: null,
  };

  it('uses the resolved title', () => {
    const memory = baseMemory({ resolved: { title: { value: 'Jazz Night', source: 'ai', confidence: 0.9 } } });
    const text = renderText(React.createElement(ShareCardView, { memory: memory, ...fieldProps }));
    expect(text).toContain('Jazz Night');
    expect(text).not.toContain('https://example.com/raw');
  });

  it('falls back to the raw title, then to "Memory"', () => {
    expect(renderText(React.createElement(ShareCardView, { memory: baseMemory({ resolved: {} }), ...fieldProps }))).toContain(
      'https://example.com/raw',
    );
    expect(renderText(React.createElement(ShareCardView, { memory: baseMemory({ title: '', resolved: {} }), ...fieldProps }))).toContain(
      'Memory',
    );
  });
});
