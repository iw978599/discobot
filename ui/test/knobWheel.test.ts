import test from 'node:test';
import assert from 'node:assert/strict';
import { notchSize, wheelNotches } from '../src/components/knobWheel.ts';

test('a mouse notch is one notch, up for a wheel turned away from the person', () => {
  assert.equal(wheelNotches({ deltaX: 0, deltaY: -100, deltaMode: 0 }), 1);
  assert.equal(wheelNotches({ deltaX: 0, deltaY: 100, deltaMode: 0 }), -1);
  assert.equal(wheelNotches({ deltaX: 0, deltaY: -3, deltaMode: 1 }), 1);
  assert.equal(wheelNotches({ deltaX: 0, deltaY: 1, deltaMode: 2 }), -1);
});

test('a trackpad sends small events that are a part of a notch, and a flick is never more than one', () => {
  assert.equal(wheelNotches({ deltaX: 0, deltaY: -4, deltaMode: 0 }), 0.04);
  assert.equal(wheelNotches({ deltaX: 0, deltaY: -900, deltaMode: 0 }), 1);
  assert.equal(wheelNotches({ deltaX: 0, deltaY: 900, deltaMode: 0 }), -1);
});

test('with Shift a browser may send the turn as sideways scroll', () => {
  assert.equal(wheelNotches({ deltaX: -100, deltaY: 0, deltaMode: 0 }), 1);
});

test('a notch is a fiftieth of the range and at least a step; fine is one step', () => {
  assert.equal(notchSize(0, 1, 0.01, false), 0.02);
  assert.equal(notchSize(0, 100, 1, false), 2);
  assert.equal(notchSize(0, 1, 0.01, true), 0.01);
  assert.equal(notchSize(0, 14, 0.5, false), 0.5);
  assert.ok(Math.abs(notchSize(20, 20000, 1, false) - 399.6) < 1e-9);
});
