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

export interface UserConfirmation {
  id: string;
  memoryId: string;
  userId: string;
  field: string;
  confirmedValue: any;
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
  url?: string;
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
  personId?: string;
  assets?: MemoryAsset[];
  aiInferences?: AIInference[];
  userConfirmations?: UserConfirmation[];
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
  pageIndex?: number,
): Promise<MemoryAsset> {
  return makeRequest('/assets/complete-upload', 'POST', token, {
    memoryId,
    objectKey,
    mimeType,
    checksum,
    pageIndex,
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

export interface Collection {
  id: string;
  userId: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  memories?: Array<{ memory: Memory; addedAt: string }>;
}

export interface CreateCollectionRequest {
  name: string;
  description?: string;
}

export async function listCollections(token: string | null): Promise<Collection[]> {
  return makeRequest('/collections', 'GET', token);
}

export async function createCollection(
  token: string | null,
  data: CreateCollectionRequest,
): Promise<Collection> {
  return makeRequest('/collections', 'POST', token, data);
}

export async function getCollectionDetail(token: string | null, id: string): Promise<Collection> {
  return makeRequest(`/collections/${id}`, 'GET', token);
}

export async function deleteCollection(token: string | null, id: string): Promise<void> {
  return makeRequest(`/collections/${id}`, 'DELETE', token);
}

export async function addMemoryToCollection(
  token: string | null,
  collectionId: string,
  memoryId: string,
): Promise<any> {
  return makeRequest(`/collections/${collectionId}/memories/${memoryId}`, 'POST', token);
}

export async function removeMemoryFromCollection(
  token: string | null,
  collectionId: string,
  memoryId: string,
): Promise<{ success: boolean }> {
  return makeRequest(`/collections/${collectionId}/memories/${memoryId}`, 'DELETE', token);
}

export async function listVaultMemories(token: string | null): Promise<Memory[]> {
  return makeRequest('/vault', 'GET', token);
}

export async function getVaultMemoryDetail(token: string | null, id: string): Promise<Memory> {
  return makeRequest(`/vault/${id}`, 'GET', token);
}

export async function getVaultProcessingStatus(
  token: string | null,
  id: string,
): Promise<ProcessingStatus> {
  return makeRequest(`/vault/${id}/processing-status`, 'GET', token);
}

export async function lockMemory(token: string | null, memoryId: string): Promise<Memory> {
  return makeRequest(`/vault/${memoryId}/lock`, 'POST', token);
}

export async function unlockMemory(token: string | null, memoryId: string): Promise<Memory> {
  return makeRequest(`/vault/${memoryId}/unlock`, 'POST', token);
}

export async function reprocessMemory(token: string | null, memoryId: string): Promise<{ id: string; processingState: string }> {
  return makeRequest(`/memories/${memoryId}/reprocess`, 'POST', token);
}

export async function confirmField(
  token: string | null,
  memoryId: string,
  field: string,
  confirmedValue: any,
): Promise<UserConfirmation> {
  return makeRequest(`/memories/${memoryId}/confirm`, 'POST', token, {
    field,
    confirmedValue,
  });
}

export async function deleteMemory(token: string | null, memoryId: string): Promise<Memory> {
  return makeRequest(`/memories/${memoryId}`, 'DELETE', token);
}

export async function restoreMemory(token: string | null, memoryId: string): Promise<Memory> {
  return makeRequest(`/memories/${memoryId}/restore`, 'POST', token);
}

export async function deleteVaultMemory(token: string | null, memoryId: string): Promise<Memory> {
  return makeRequest(`/vault/${memoryId}`, 'DELETE', token);
}

export async function restoreVaultMemory(token: string | null, memoryId: string): Promise<Memory> {
  return makeRequest(`/vault/${memoryId}/restore`, 'POST', token);
}

export async function confirmVaultField(
  token: string | null,
  memoryId: string,
  field: string,
  confirmedValue: any,
): Promise<UserConfirmation> {
  return makeRequest(`/vault/${memoryId}/confirm`, 'POST', token, {
    field,
    confirmedValue,
  });
}

export async function summarizeMemory(token: string | null, memoryId: string): Promise<string> {
  return makeRequest(`/memories/${memoryId}/summarize`, 'POST', token);
}

export async function extractKeyPoints(token: string | null, memoryId: string): Promise<string[]> {
  return makeRequest(`/memories/${memoryId}/key-points`, 'POST', token);
}

export interface Reminder {
  id: string;
  userId: string;
  memoryId: string;
  note?: string;
  remindAt: string;
  status: 'pending' | 'due' | 'dismissed' | 'completed';
  createdAt: string;
  updatedAt: string;
}

export interface CreateReminderRequest {
  memoryId: string;
  remindAt: string;
  note?: string;
}

export async function listReminders(token: string | null, status?: string): Promise<Reminder[]> {
  const params = status ? `?status=${encodeURIComponent(status)}` : '';
  return makeRequest(`/reminders${params}`, 'GET', token);
}

export async function createReminder(token: string | null, data: CreateReminderRequest): Promise<Reminder> {
  return makeRequest('/reminders', 'POST', token, data);
}

export async function updateReminderStatus(
  token: string | null,
  reminderId: string,
  status: string,
): Promise<Reminder> {
  return makeRequest(`/reminders/${reminderId}`, 'PATCH', token, { status });
}

export async function deleteReminder(token: string | null, reminderId: string): Promise<void> {
  return makeRequest(`/reminders/${reminderId}`, 'DELETE', token);
}

export async function getRediscoveryMemories(token: string | null): Promise<Memory[]> {
  return makeRequest('/engagement/rediscover', 'GET', token);
}

export interface UpcomingMemory {
  id: string;
  title: string;
  date: string;
  daysUntil: number;
}

export async function getUpcomingMemories(token: string | null): Promise<UpcomingMemory[]> {
  return makeRequest('/engagement/upcoming', 'GET', token);
}

export async function recordRediscoveryFeedback(
  token: string | null,
  memoryId: string,
  feedback: string,
): Promise<any> {
  return makeRequest(`/engagement/rediscover/${memoryId}/feedback`, 'POST', token, { feedback });
}

export async function compareMemories(token: string | null, memoryIds: string[]): Promise<{ comparison: string; keyDifferences: string[] }> {
  return makeRequest('/memories/compare', 'POST', token, { memoryIds });
}

export interface AccountExportData {
  user: {
    id: string;
    email: string;
    displayName?: string;
    locale?: string;
    plan?: string;
    preferences?: any;
    createdAt: string;
    updatedAt: string;
  };
  memories: Memory[];
  collections: Collection[];
  reminders: Reminder[];
}

export async function exportAccountData(token: string | null): Promise<AccountExportData> {
  return makeRequest('/account/export', 'GET', token);
}

export async function deleteAccount(token: string | null, confirmEmail: string): Promise<{ deleted: boolean; assetCleanupFailures: number }> {
  return makeRequest('/account', 'DELETE', token, { confirmEmail });
}

export interface Person {
  id: string;
  userId: string;
  name: string;
  relationship?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePersonRequest {
  name: string;
  relationship?: string;
}

export async function listPeople(token: string | null): Promise<Person[]> {
  return makeRequest('/people', 'GET', token);
}

export async function createPerson(token: string | null, data: CreatePersonRequest): Promise<Person> {
  return makeRequest('/people', 'POST', token, data);
}

export async function deletePerson(token: string | null, personId: string): Promise<void> {
  return makeRequest(`/people/${personId}`, 'DELETE', token);
}

export async function assignPersonToMemory(
  token: string | null,
  personId: string,
  memoryId: string,
): Promise<Memory> {
  return makeRequest(`/people/${personId}/assign-to-memory/${memoryId}`, 'POST', token);
}

export async function unassignPersonFromMemory(
  token: string | null,
  personId: string,
  memoryId: string,
): Promise<Memory> {
  return makeRequest(`/people/${personId}/assign-to-memory/${memoryId}`, 'DELETE', token);
}
