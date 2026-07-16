import { apiUrl } from './config';

interface AuthState {
  sessionToken: string | null;
  csrfToken: string | null;
  onUnauthorized?: () => void;
}

const authState: AuthState = {
  sessionToken: null,
  csrfToken: null,
};

export function setAuthContext(sessionToken: string | null, csrfToken: string | null, onUnauthorized?: () => void) {
  authState.sessionToken = sessionToken;
  authState.csrfToken = csrfToken;
  authState.onUnauthorized = onUnauthorized;
}

export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method || 'GET').toUpperCase();
  const mutating = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';

  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
  };
  if (authState.sessionToken) headers.Authorization = 'Bearer ' + authState.sessionToken;
  if (mutating && authState.csrfToken) headers['x-csrf-token'] = authState.csrfToken;
  if (init.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

  const response = await fetch(apiUrl(path), {
    ...init,
    headers,
  });

  if (response.status === 401 || response.status === 403) {
    authState.onUnauthorized?.();
  }

  return response;
}

export async function exchangeLoginToken(loginToken: string) {
  const response = await fetch(apiUrl('/auth/exchange'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ loginToken }),
  });
  if (!response.ok) throw new Error('Exchange failed');
  return response.json();
}

export async function fetchSessionInfo(sessionToken: string) {
  const response = await fetch(apiUrl('/auth/session'), {
    headers: { Authorization: 'Bearer ' + sessionToken },
  });
  if (!response.ok) throw new Error('Session lookup failed');
  return response.json();
}

export async function compatibilityLogin() {
  const response = await fetch(apiUrl('/auth/compatibility'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) throw new Error('Compatibility login failed');
  return response.json();
}
