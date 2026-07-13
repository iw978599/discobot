export function hasBearerAuthorizationHeader(authorizationHeader: unknown): boolean {
  if (typeof authorizationHeader !== 'string') return false;
  return authorizationHeader.trimStart().startsWith('Bearer ');
}

export function shouldUseCompatibilityFallback(authorizationHeader: unknown): boolean {
  return !hasBearerAuthorizationHeader(authorizationHeader);
}
