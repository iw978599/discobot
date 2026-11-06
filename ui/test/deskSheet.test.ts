import test from 'node:test';
import assert from 'node:assert/strict';
import { SHEET_SIZES, asSheetSize, clampSheetHeight, nearestSheetSize, readSheetSize, sheetHeight, sheetHeights, sheetKeySize } from '../src/services/deskSheet.ts';

test('a stored sheet size is one of the three, or half', () => {
  for (const size of SHEET_SIZES) assert.equal(readSheetSize(size), size);
  for (const bad of [null, '', 'tall', '3']) assert.equal(readSheetSize(bad), 'half');
  assert.equal(asSheetSize('full'), 'full');
  assert.equal(asSheetSize(5), null);
});

test('the three heights grow, on a tall phone and on a phone on its side', () => {
  for (const viewport of [320, 390, 480, 600, 727, 915, 1200]) {
    const { peek, half, full } = sheetHeights(viewport);
    assert.ok(peek < half && half < full, `${viewport}: ${peek} ${half} ${full}`);
  }
  assert.equal(sheetHeight('peek', 800), 168);
  assert.equal(sheetHeight('half', 800), 400);
  assert.equal(sheetHeight('full', 800), 740, 'the top bar stays in view');
  assert.ok(sheetHeight('half', 390) > 390 / 2, 'a short screen gives the sheet more');
});

test('a dragged height is held between the peek and full, and settles on the nearest size', () => {
  assert.equal(clampSheetHeight(10, 800), 168);
  assert.equal(clampSheetHeight(5000, 800), 740);
  assert.equal(clampSheetHeight(NaN, 800), 168);
  assert.equal(nearestSheetSize(180, 800), 'peek');
  assert.equal(nearestSheetSize(380, 800), 'half');
  assert.equal(nearestSheetSize(700, 800), 'full');
});

test('the arrow keys step the size, Home and End go to the ends', () => {
  assert.equal(sheetKeySize('ArrowUp', 'peek'), 'half');
  assert.equal(sheetKeySize('ArrowUp', 'full'), 'full');
  assert.equal(sheetKeySize('ArrowDown', 'half'), 'peek');
  assert.equal(sheetKeySize('ArrowDown', 'peek'), 'peek');
  assert.equal(sheetKeySize('Home', 'full'), 'peek');
  assert.equal(sheetKeySize('End', 'peek'), 'full');
  assert.equal(sheetKeySize('a', 'half'), null);
});
