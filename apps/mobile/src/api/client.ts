export interface HealthResponse {
  status: string;
  timestamp?: string;
  [key: string]: any;
}

export interface AIInference {
  id: string;
  memoryId: string;
  field: string;
  valueJson: any;
  confidence: number;
  provenance?: string;
  modelVersion: string;
  createdAt: string;
}

export interface MemoryAsset {
  id: string;
  memoryId: string;
  objectKey: string;
  mimeType: string;
  checksum?: string;
  pageIndex?: number;
  variant?: string;
  createdAt: string;
}

export interface Memory {
  id: string;
  userId: string;
  sourceType: string;
  sourceUri?: string;
  memoryType?: string;
  title?: string;
  capturedAt: string;
  processingState: 'queued' | 'processing' | 'understood' | 'partial' | 'failed';
  lifecycleState: string;
  securityScope: string;
  idempotencyKey: string;
  assets?: MemoryAsset[];
  aiInferences?: AIInference[];
  createdAt: string;
  updatedAt: string;
}

export interface ProcessingStatus {
  id: string;
  userId: string;
  processingState: 'queued' | 'processing' | 'understood' | 'partial' | 'failed';
  updatedAt: string;
  securityScope: string;
}

export interface SearchResult {
  id: string;
  title: string;
  summary: string;
  sourceUri: string | null;
  distance: number;
  createdAt: string;
}

export interface AskSource {
  memoryId: string;
  title: string;
  summary: string;
  sourceUri: string | null;
}

export interface AskResponse {
  answer: string;
  citedMemoryIds: string[];
  sources: AskSource[];
}

async function makeRequest(
  endpoint: string,
  method: string,
  token: string | null,
  body?: any,
): Promise<any> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL;

  if (!apiUrl) {
    throw new Error('Missing EXPO_PUBLIC_API_URL environment variable');
  }

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${apiUrl}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.json();
}

export async function fetchHealth(token: string | null): Promise<HealthResponse> {
  return makeRequest('/health', 'GET', token);
}

export async function createMemory(
  token: string | null,
  sourceType: string,
  idempotencyKey: string,
  sourceUri?: string,
  title?: string,
): Promise<Memory> {
  return makeRequest('/memories', 'POST', token, {
    sourceType,
    idempotencyKey,
    sourceUri,
    title,
  });
}

export async function fetchMemories(token: string | null): Promise<Memory[]> {
  return makeRequest('/memories', 'GET', token);
}

export async function fetchMemoryDetail(token: string | null, id: string): Promise<Memory> {
  return makeRequest(`/memories/${id}`, 'GET', token);
}

export async function fetchProcessingStatus(
  token: string | null,
  id: string,
): Promise<ProcessingStatus> {
  return makeRequest(`/memories/${id}/processing-status`, 'GET', token);
}

export async function createUpload(
  token: string | null,
  memoryId: string,
  mimeType: string,
): Promise<{ objectKey: string; uploadUrl: string; mimeType: string; expiresInSeconds: number }> {
  return makeRequest('/assets/create-upload', 'POST', token, { memoryId, mimeType });
}

export async function completeUpload(
  token: string | null,
  memoryId: string,
  objectKey: string,
  mimeType: string,
  checksum?: string,
): Promise<MemoryAsset> {
  return makeRequest('/assets/complete-upload', 'POST', token, {
    memoryId,
    objectKey,
    mimeType,
    checksum,
  });
}

export async function search(token: string | null, query: string): Promise<SearchResult[]> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL;
  if (!apiUrl) {
    throw new Error('Missing EXPO_PUBLIC_API_URL environment variable');
  }

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${apiUrl}/search?query=${encodeURIComponent(query)}`, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    throw new Error(`Search failed with status ${response.status}`);
  }

  return response.json();
}

export async function ask(token: string | null, question: string): Promise<AskResponse> {
  return makeRequest('/ask', 'POST', token, { question });
}
