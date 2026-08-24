// Provider-agnostic contract so the worker never talks to a vendor SDK
// directly (spec §4: "AI: Provider abstraction... record model versions").

export interface MemoryUnderstanding {
  title: string;
  summary: string;
  type:
    | 'article'
    | 'video'
    | 'post'
    | 'image'
    | 'note'
    | 'document'
    | 'event'
    | 'place'
    | 'product'
    | 'tutorial'
    | 'other';
  topics: string[];
  confidence: number; // 0..1, overall — per-field confidence is layered on by the caller
  modelVersion: string;
}

export interface UnderstandInput {
  /** Raw text, OCR output, or a short description of the asset to understand. */
  text: string;
  sourceUri?: string;
}

export interface ContextMemory {
  memoryId: string;
  title: string;
  summary: string;
  sourceUri: string | null;
}

export interface AnswerWithContextResponse {
  answer: string;
  citedMemoryIds: string[];
}

export interface AiProvider {
  /** §9 AI Processing Contract — title/summary/type/topics extraction. */
  understand(input: UnderstandInput): Promise<MemoryUnderstanding>;

  /** Ask/RAG Contract — answer a question grounded in user's Memories. */
  answerWithContext(
    question: string,
    context: ContextMemory[],
  ): Promise<AnswerWithContextResponse>;
}
