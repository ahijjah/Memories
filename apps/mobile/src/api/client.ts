export interface HealthResponse {
  status: string;
  timestamp?: string;
  [key: string]: any;
}

export async function fetchHealth(token: string | null): Promise<HealthResponse> {
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

  const response = await fetch(`${apiUrl}/health`, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    throw new Error(`Health check failed with status ${response.status}`);
  }

  return response.json();
}
