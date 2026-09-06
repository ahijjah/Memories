// Provider-agnostic contract so the worker never talks to a vendor SDK
// directly (spec §4: "AI: Provider abstraction... record model versions").

export interface MemoryUnderstanding {
  title: string;
  summary: string;
  type:
    // Legacy lowercase values (existing data)
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
    | 'other'
    // New Smart Memory Card Framework uppercase values (for new captures going forward)
    | 'GENERIC'
    | 'EVENT'
    | 'PLACE'
    | 'PRODUCT'
    | 'ARTICLE_LEARNING'
    | 'VIDEO_SOCIAL'
    | 'OFFER'
    | 'DOCUMENT';
  topics: string[];
  confidence: number; // 0..1, overall — type classification and general confidence
  modelVersion: string;

  // P0.1: Structured AI Understanding — optional fields, only populated if genuinely present
  intent?: 'visit' | 'buy' | 'read' | 'attend' | 'reference';
  entities?: string[]; // people/brands/orgs mentioned
  location?: string; // free-text location if applicable
  date?: string; // ISO date string — event date, expiry, publication date, etc.

  // P0.3: Product/Offer/Place fields — SC-P1 card types
  brand?: string; // product brand (e.g. "Apple", "Nike")
  model?: string; // product model (e.g. "iPhone 15", "Air Max 90")
  price?: string; // display-ready price string, e.g. "$299" or "45 JOD" — formatted single string
  category?: string; // product or place category, e.g. "Laptop", "Italian restaurant"
  merchant?: string; // offer/deal merchant or seller name
  originalPrice?: string; // original price before discount
  offerPrice?: string; // discounted offer price
  discount?: string; // e.g. "20% off" or "$50 off"
  promoCode?: string; // promotional code if visible

  // P0.2a: Per-field confidence — separate confidence for each optional field (only for fields included)
  fieldConfidence?: {
    intent?: number; // 0..1, confidence specifically for the intent field
    entities?: number; // 0..1, confidence specifically for entities extraction
    location?: number; // 0..1, confidence specifically for location extraction
    date?: number; // 0..1, confidence specifically for date extraction
    brand?: number; // 0..1, confidence specifically for brand extraction
    model?: number; // 0..1, confidence specifically for model extraction
    price?: number; // 0..1, confidence specifically for price extraction
    category?: number; // 0..1, confidence specifically for category extraction
    merchant?: number; // 0..1, confidence specifically for merchant extraction
    originalPrice?: number; // 0..1, confidence specifically for originalPrice extraction
    offerPrice?: number; // 0..1, confidence specifically for offerPrice extraction
    discount?: number; // 0..1, confidence specifically for discount extraction
    promoCode?: number; // 0..1, confidence specifically for promoCode extraction
  };
}

export interface UnderstandInput {
  /** Raw text, OCR output, or a short description of the asset to understand. */
  text: string;
  sourceUri?: string;
  /** Base64-encoded image data for vision analysis. */
  imageBase64?: string;
  /** MIME type of the image (e.g. 'image/jpeg', 'image/png'). */
  imageMediaType?: string;
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
