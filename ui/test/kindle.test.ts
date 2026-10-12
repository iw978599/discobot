import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { isKindle, KINDLE_PATTERN, KINDLE_VIEWPORT_WIDTH } from '../src/services/kindle';

const yes = {
  'Silk tablet view (Amazon guide)': 'Mozilla/5.0 (Linux; Android 4.4.3; KFTHWI Build/KTU84M) AppleWebKit/537.36 (KHTML, like Gecko) Silk/44.1.54 like Chrome/44.0.2403.63 Safari/537.36',
  'Silk mobile view (Amazon guide)': 'Mozilla/5.0 (Linux; U; Android 4.4.3; KFTHWI Build/KTU84M) AppleWebKit/537.36 (KHTML, like Gecko) Silk/44.1.54 like Chrome/44.0.2403.63 Mobile Safari/537.36',
  'Silk desktop view, no Android and no model (Amazon guide)': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Silk/44.1.54 like Chrome/44.0.2403.63 Safari/537.36',
  'Silk on a recent Fire': 'Mozilla/5.0 (Linux; Android 9; KFMAWI) AppleWebKit/537.36 (KHTML, like Gecko) Silk/120.4.1 like Chrome/120.0.6099.144 Safari/537.36',
  'Kindle Fire first generation': 'Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_3; en-us; Silk/1.0.13.81_10003810) AppleWebKit/533.16 (KHTML, like Gecko) Version/5.0 Safari/533.16 Silk-Accelerated=true',
  'Kindle e-reader browser': 'Mozilla/5.0 (X11; U; Linux armv7l like Android; en-us) AppleWebKit/531.2+ (KHTML, like Gecko) Version/5.0 Safari/533.2+ Kindle/3.0+',
  'another browser on a Fire, naming the model': 'Mozilla/5.0 (Linux; Android 11; KFRAWI) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

const no = {
  'Chrome on an Android phone': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Chrome on a desktop': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Safari on an iPad': 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Firefox': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Samsung tablet': 'Mozilla/5.0 (Linux; Android 12; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'empty': '',
};

test('a Kindle or Fire user agent is recognised', () => {
  for (const [name, ua] of Object.entries(yes)) assert.equal(isKindle(ua), true, name);
});

test('other devices are not', () => {
  for (const [name, ua] of Object.entries(no)) assert.equal(isKindle(ua), false, name);
});

test('index.html uses the same expression and a width under the phone layout limit', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(html.includes(`/${KINDLE_PATTERN.source}/`), 'the inline script must hold the same expression');
  assert.ok(html.includes(`'width=${KINDLE_VIEWPORT_WIDTH}, viewport-fit=cover'`), 'the width is set without an initial scale, which would override it');
  assert.ok(KINDLE_VIEWPORT_WIDTH <= 720);
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover"/);
});
