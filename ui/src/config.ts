const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

const isLocalhost = (): boolean =>
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

const isLocalDevUi = (): boolean =>
  typeof window !== 'undefined' &&
  isLocalhost() &&
  window.location.port === '3000';

const normalizeWebSocketBaseUrl = (value: string): string => {
  const trimmed = trimTrailingSlash(value.trim());
  if (!trimmed) return trimmed;
  if (trimmed.startsWith('ws://') || trimmed.startsWith('wss://')) return trimmed;
  if (trimmed.startsWith('http://')) return `ws://${trimmed.slice('http://'.length)}`;
  if (trimmed.startsWith('https://')) return `wss://${trimmed.slice('https://'.length)}`;
  if (trimmed.startsWith('/')) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}${trimmed}`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${trimmed}`;
};

export const getApiBaseUrl = (): string => {
  const envBase = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_API_BASE_URL;
  if (envBase) return trimTrailingSlash(envBase);
  if (isLocalDevUi()) return 'http://localhost:3001';
  if (window.location.port === '3001' || isLocalhost()) return window.location.origin;
  return '/api';
};

export const apiUrl = (path: string): string => `${getApiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;

export const getWebSocketUrl = (sessionToken?: string | null): string => {
  const envWs = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_WS_URL;
  const baseUrl = (() => {
    if (envWs) return normalizeWebSocketBaseUrl(envWs);
    if (isLocalDevUi()) return 'ws://localhost:3001/ws';
    if (window.location.port === '3001' || isLocalhost()) {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${protocol}//${window.location.hostname}:3001/ws`;
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
  })();
  if (!sessionToken) return baseUrl;
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}sessionToken=${encodeURIComponent(sessionToken)}`;
};
