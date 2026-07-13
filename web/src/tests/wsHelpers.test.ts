import test from 'node:test';
import assert from 'node:assert/strict';
import { getWebSocketChannel, getWebSocketRequestPath, isAllowedUpgradeOrigin } from '../wsHelpers';

const UI_PATHS = new Set(['/ws', '/ws/']);
const BOT_PATHS = new Set(['/ws/bot', '/ws/bot/']);

test('extracts request path without query params', () => {
  assert.equal(getWebSocketRequestPath('/ws?sessionToken=abc'), '/ws');
  assert.equal(getWebSocketRequestPath('/ws/bot/?foo=bar'), '/ws/bot/');
});

test('maps websocket paths to channels', () => {
  assert.equal(getWebSocketChannel('/ws', UI_PATHS, BOT_PATHS), 'ui');
  assert.equal(getWebSocketChannel('/ws/bot/', UI_PATHS, BOT_PATHS), 'bot');
  assert.equal(getWebSocketChannel('/unknown', UI_PATHS, BOT_PATHS), null);
});

test('allows same-host origin for websocket upgrades', () => {
  assert.equal(
    isAllowedUpgradeOrigin('https://discobot-production.up.railway.app', 'discobot-production.up.railway.app', []),
    true,
  );
});

test('rejects unknown non-matching origins for websocket upgrades', () => {
  assert.equal(
    isAllowedUpgradeOrigin('https://evil.example', 'discobot-production.up.railway.app', []),
    false,
  );
});
