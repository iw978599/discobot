import test from 'node:test';
import assert from 'node:assert/strict';
import { hasBearerAuthorizationHeader, shouldUseCompatibilityFallback } from '../authFallback';

test('detects bearer auth headers', () => {
  assert.equal(hasBearerAuthorizationHeader('******'), true);
  assert.equal(hasBearerAuthorizationHeader('   ******'), true);
  assert.equal(hasBearerAuthorizationHeader('Basic abc'), false);
  assert.equal(hasBearerAuthorizationHeader(undefined), false);
});

test('compatibility fallback is only used without bearer headers', () => {
  assert.equal(shouldUseCompatibilityFallback(undefined), true);
  assert.equal(shouldUseCompatibilityFallback('Basic abc'), true);
  assert.equal(shouldUseCompatibilityFallback('******'), false);
});
