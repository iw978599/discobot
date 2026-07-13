export type WebSocketChannel = 'ui' | 'bot';

const DEFAULT_PORTS_BY_PROTOCOL: Record<string, string> = {
  'http:': '80',
  'https:': '443',
};

const normalizeHost = (value: string): string => value.split(',')[0].trim().toLowerCase();

const stripPort = (host: string): string => host.replace(/:\d+$/, '');

export const getWebSocketRequestPath = (requestUrl: string | undefined): string =>
  requestUrl?.split('?')[0] ?? '';

export const getWebSocketChannel = (
  requestPath: string,
  uiPaths: Set<string>,
  botPaths: Set<string>,
): WebSocketChannel | null => {
  if (uiPaths.has(requestPath)) return 'ui';
  if (botPaths.has(requestPath)) return 'bot';
  return null;
};

export const isAllowedUpgradeOrigin = (
  origin: string | undefined,
  requestHost: string | undefined,
  allowedOrigins: string[],
): boolean => {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  if (!requestHost) return false;

  try {
    const parsedOrigin = new URL(origin);
    const originPort = parsedOrigin.port || DEFAULT_PORTS_BY_PROTOCOL[parsedOrigin.protocol] || '';
    const originHostWithPort = normalizeHost(`${parsedOrigin.hostname}:${originPort}`);
    const requestHostWithPort = normalizeHost(requestHost);
    const originHostOnly = stripPort(originHostWithPort);
    const requestHostOnly = stripPort(requestHostWithPort);
    return originHostWithPort === requestHostWithPort || originHostOnly === requestHostOnly;
  } catch {
    return false;
  }
};
