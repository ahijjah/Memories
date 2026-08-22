import Anthropic from '@anthropic-ai/sdk';
import type { AiProvider, MemoryUnderstanding, UnderstandInput } from './provider.interface';

// Model string is configurable — never hardcode a bare assumption about
// "the current model" outside of one place. Defaults to a capable,
// cost-reasonable model; override via ANTHROPIC_MODEL for evaluation
// (spec §9: "record model/provider/prompt or pipeline version").
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5';

const SYSTEM_PROMPT = `You extract structured metadata from a saved "Memory" for a personal knowledge app.
Respond with ONLY a JSON object, no prose, no markdown fences, matching exactly:
{"title": string, "summary": string, "type": "article"|"video"|"post"|"image"|"note"|"document"|"event"|"place"|"product"|"tutorial"|"other", "topics": string[], "confidence": number between 0 and 1}
Keep the title short and meaningful. Keep the summary short and faithful to the source — do not invent facts not present in the input.`;

export class AnthropicAiProvider implements AiProvider {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string = DEFAULT_MODEL) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async understand(input: UnderstandInput): Promise<MemoryUnderstanding> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: input.sourceUri
            ? `Source: ${input.sourceUri}\n\nContent:\n${input.text}`
            : input.text,
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
}
