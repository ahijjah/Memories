import Anthropic from '@anthropic-ai/sdk';
import type {
  AiProvider,
  MemoryUnderstanding,
  UnderstandInput,
  ContextMemory,
  AnswerWithContextResponse,
} from './provider.interface';

// Model string is configurable — never hardcode a bare assumption about
// "the current model" outside of one place. Defaults to a capable,
// cost-reasonable model; override via ANTHROPIC_MODEL for evaluation
// (spec §9: "record model/provider/prompt or pipeline version").
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5';

const SYSTEM_PROMPT = `You extract structured metadata from a saved "Memory" for a personal knowledge app.
Respond with ONLY a JSON object, no prose, no markdown fences, with these required fields:
{"title": string, "summary": string, "type": "article"|"video"|"post"|"image"|"note"|"document"|"event"|"place"|"product"|"tutorial"|"other", "topics": string[], "confidence": number between 0 and 1}

OPTIONAL fields (only include if genuinely present/inferable, NEVER hallucinate):
- "intent": "visit"|"buy"|"read"|"attend"|"reference" — user's likely action with this memory
- "entities": string[] — people, brands, organizations mentioned (empty array if none)
- "location": string — geographic location if applicable (omit if not present)
- "date": string — ISO date string if an event date, publication date, or expiry date is mentioned (omit if not present)

Guidelines: Keep title short and meaningful. Keep summary short and faithful to source.
DO NOT invent facts, locations, dates, or intentions not clearly present in input.
Only populate optional fields when you are confident they apply.`;

export class AnthropicAiProvider implements AiProvider {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string = DEFAULT_MODEL) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async understand(input: UnderstandInput): Promise<MemoryUnderstanding> {
    // Build multimodal content when image is present
    let content: string | any[];
    if (input.imageBase64 && input.imageMediaType) {
      content = [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: input.imageMediaType,
            data: input.imageBase64,
          },
        },
        {
          type: 'text',
          text: input.sourceUri
            ? `Source: ${input.sourceUri}\n\nCaption/Context:\n${input.text}`
            : `Content:\n${input.text}`,
        },
      ];
    } else {
      // Text-only content
      content = input.sourceUri
        ? `Source: ${input.sourceUri}\n\nContent:\n${input.text}`
        : input.text;
    }

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content,
        },
      ],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('AI provider returned no text content');
    }

    let parsed: Omit<MemoryUnderstanding, 'modelVersion'>;
    try {
      parsed = JSON.parse(textBlock.text.trim());
    } catch (err) {
      throw new Error(`AI provider returned unparseable JSON: ${(err as Error).message}`);
    }

    return { ...parsed, modelVersion: this.model };
  }

  async answerWithContext(
    question: string,
    context: ContextMemory[],
  ): Promise<AnswerWithContextResponse> {
    const contextStr = context
      .map(
        (mem, idx) =>
          `${idx + 1}. [${mem.memoryId}] ${mem.title}\n` +
          `   Summary: ${mem.summary}\n` +
          (mem.sourceUri ? `   Source: ${mem.sourceUri}\n` : ''),
      )
      .join('\n');

    const systemPrompt = `You are a helpful assistant that answers questions based ONLY on the user's saved Memories provided below.
You MUST:
- Only use information present in the provided context
- Say "I don't have enough saved information to answer that" if the context doesn't contain sufficient information
- NEVER use general knowledge or information not in the Memories
- Respond in strict JSON: {"answer": string, "citedMemoryIds": string[]}
- List only the memory IDs (from brackets like [memory-id]) that you actually cited to answer the question`;

    const userMessage = `Here are my saved Memories:\n\n${contextStr}\n\nQuestion: ${question}`;

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1500,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userMessage,
        },
      ],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('AI provider returned no text content');
    }

    let parsed: AnswerWithContextResponse;
    try {
      parsed = JSON.parse(textBlock.text.trim());
    } catch (err) {
      throw new Error(
        `AI provider returned unparseable JSON: ${(err as Error).message}`,
      );
    }

    if (
      !parsed.answer ||
      typeof parsed.answer !== 'string' ||
      !Array.isArray(parsed.citedMemoryIds)
    ) {
      throw new Error(
        'AI provider response missing or malformed answer/citedMemoryIds',
      );
    }

    return parsed;
  }
}
