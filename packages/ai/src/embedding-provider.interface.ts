export type EmbeddingInputType = 'document' | 'query';

export interface EmbeddingProvider {
  embed(text: string, inputType: EmbeddingInputType): Promise<number[]>;
}
