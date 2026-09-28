const mockCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ messages: { create: mockCreate } })),
}));

import { AnthropicAiProvider, EVIDENCE_LABELS, SOURCE_EVIDENCE_NOTICE, USER_TEXT_LABEL } from '@memory-app/ai';

// LOSSLESS-CAPTURE-01: user text shared with a link reaches the model labelled as the user's own
// words; requests without it are built exactly as before.
describe('AnthropicAiProvider.understand - user text shared with a link', () => {
  const CAPTURED_AT = '2026-09-28T10:00:00.000Z';
  const REFERENCE = `Reference date for date resolution: ${CAPTURED_AT}\n(Use this as "today" when resolving partial dates like "next Friday" or "September 20" without a year)`;
  const URL = 'https://example.com/post';
  const USER_TEXT = 'Look at this https://example.com/post\nMeet there Friday 6pm';

  let provider: AnthropicAiProvider;
  const content = () => mockCreate.mock.calls[0][0].messages[0].content;

  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '{"title":"t","summary":"s","type":"GENERIC","topics":[],"confidence":0.5}' }],
    });
    provider = new AnthropicAiProvider('sk-test', 'test-model');
  });

  it('the label never calls user text page content or verified', () => {
    expect(USER_TEXT_LABEL).toMatch(/user's own words/);
    expect(USER_TEXT_LABEL).toMatch(/not content fetched from or verified by the linked page/);
  });

  it('text-only: link, admitted page metadata and user text are separate, labelled items', async () => {
    await provider.understand({
      text: 'Page title\n\nPage description',
      sourceUri: URL,
      capturedAt: CAPTURED_AT,
      sourceEvidence: { textKind: 'fetched_page_metadata' },
      userText: USER_TEXT,
    });

    expect(content()).toEqual([
      { type: 'text', text: REFERENCE },
      { type: 'text', text: SOURCE_EVIDENCE_NOTICE },
      {
        type: 'text',
        text: [
          `Link the user shared (not opened or verified by this system): ${URL}`,
          `${EVIDENCE_LABELS.fetched_page_metadata}\nPage title\n\nPage description`,
          `${USER_TEXT_LABEL}\n${USER_TEXT}`,
        ].join('\n\n'),
      },
    ]);
  });

  it('no admitted metadata: the link and the user text only; the user text is never labelled as page metadata', async () => {
    await provider.understand({
      text: URL,
      sourceUri: URL,
      capturedAt: CAPTURED_AT,
      sourceEvidence: { textKind: 'memory_text' },
      userText: USER_TEXT,
    });

    const [, , last] = content();
    expect(last.text).toBe(
      `Link the user shared (not opened or verified by this system): ${URL}\n\n${USER_TEXT_LABEL}\n${USER_TEXT}`,
    );
    expect(last.text).not.toContain(EVIDENCE_LABELS.fetched_page_metadata);
  });

  it('with a source screenshot: images keep their labels and the user text is added, labelled', async () => {
    await provider.understand({
      text: URL,
      sourceUri: URL,
      images: [{ base64: 'SHOT', mediaType: 'image/png', evidence: { kind: 'user_source_screenshot', assetId: 'a1' } }],
      capturedAt: CAPTURED_AT,
      sourceEvidence: { textKind: 'memory_text' },
      userText: USER_TEXT,
    });

    const blocks = content();
    expect(blocks[2]).toEqual({ type: 'text', text: `Image 1: ${EVIDENCE_LABELS.user_source_screenshot}` });
    expect(blocks[4].text).toContain(`${USER_TEXT_LABEL}\n${USER_TEXT}`);
  });

  describe('requests without user text are unchanged', () => {
    it('text-only with sourceUri: same string content as before', async () => {
      await provider.understand({ text: 'Page title', sourceUri: URL, capturedAt: CAPTURED_AT });

      expect(content()).toBe(`${REFERENCE}\n\nSource: ${URL}\n\nContent:\nPage title`);
    });

    it('text memory: same string content as before', async () => {
      await provider.understand({ text: 'My full note\nsecond line', capturedAt: CAPTURED_AT });

      expect(content()).toBe(`${REFERENCE}\n\nMy full note\nsecond line`);
    });

    it('sourceEvidence without images or user text still takes the unlabelled branch', async () => {
      await provider.understand({
        text: 'Page title',
        sourceUri: URL,
        capturedAt: CAPTURED_AT,
        sourceEvidence: { textKind: 'fetched_page_metadata' },
      });

      expect(content()).toBe(`${REFERENCE}\n\nSource: ${URL}\n\nContent:\nPage title`);
    });
  });
});
