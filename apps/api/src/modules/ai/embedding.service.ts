import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VoyageAiProvider, EmbeddingInputType } from '@memory-app/ai';

@Injectable()
export class EmbeddingService {
  private provider: VoyageAiProvider;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.getOrThrow('VOYAGE_API_KEY');
    const model = this.config.get('VOYAGE_MODEL', 'voyage-4');
    this.provider = new VoyageAiProvider(apiKey, model);
  }

  async embed(text: string, inputType: EmbeddingInputType): Promise<number[]> {
    return this.provider.embed(text, inputType);
  }

  getModel(): string {
    return this.config.get('VOYAGE_MODEL', 'voyage-4');
  }
}
