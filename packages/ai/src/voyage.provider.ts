import { EmbeddingProvider, EmbeddingInputType } from './embedding-provider.interface';

interface VoyageResponse {
  data?: Array<{ embedding?: number[] }>;
}

export class VoyageAiProvider implements EmbeddingProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string = process.env.VOYAGE_MODEL ?? 'voyage-4') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async embed(text: string, inputType: EmbeddingInputType): Promise<number[]> {
    const response = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: [text],
        model: this.model,
        input_type: inputType,
        output_dimension: 1024,
      }),
    });

    if (!response.ok) {
      throw new Error(`Voyage AI API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as VoyageResponse;

    if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
      throw new Error('Invalid response from Voyage AI API: missing embedding data');
    }

    const embedding = data.data[0].embedding;
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error('Invalid embedding array from Voyage AI API');
    }

    return embedding;
  }
}
