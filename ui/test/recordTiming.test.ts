import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_QUANTIZE, QUANTIZE_CHOICES, asQuantize, recordPosition, type RecordMoment } from '../src/services/recordTiming.ts';
import { BrowserTransport } from '../src/services/browserTransport.ts';

// A sixteen-step lane (two ticks a step). The scheduler has played up to tick `scheduled - 1`,
// so the lane's playhead is on the step that tick is in.
const moment = (heardTicks: number, extra: Partial<RecordMoment> = {}): RecordMoment => {
  const scheduledTicks = extra.scheduledTicks ?? Math.floor(heardTicks) + 2, ticksPerStep = extra.ticksPerStep ?? 2, steps = extra.steps ?? 16;
  return { heardTicks, scheduledTicks, ticksPerStep, steps, strength: 1, playheadStep: Math.floor((scheduledTicks - 1) / ticksPerStep) % steps, ...extra };
};

test('a note is written on the step the player is hearing, not the one the scheduler has run on to', () => {
  // Heard at the very start of step 4 (tick 8), with the scheduler a step ahead on step 5.
  assert.deepEqual(recordPosition(moment(8, { scheduledTicks: 12 })), { step: 4, offset: 0 });
  // A little after the step: still that step. Most of the way to the next: the next.
  assert.deepEqual(recordPosition(moment(8.6, { scheduledTicks: 12 })), { step: 4, offset: 0 });
  assert.deepEqual(recordPosition(moment(9.4, { scheduledTicks: 12 })), { step: 5, offset: 0 });
  // However far ahead the scheduler is, the answer is the same.
  for (const scheduledTicks of [9, 10, 11, 13, 14]) assert.equal(recordPosition(moment(8.2, { scheduledTicks })).step, 4, String(scheduledTicks));
  // Round the end of the pattern: just before the bar line is the first step of the next pass.
  assert.deepEqual(recordPosition(moment(31.6, { scheduledTicks: 34, playheadStep: 0 })), { step: 0, offset: 0 });
  assert.deepEqual(recordPosition(moment(30.2, { scheduledTicks: 32, playheadStep: 15 })), { step: 15, offset: 0 });
  // A lane of thirty-two steps to the bar has a tick to a step.
  assert.deepEqual(recordPosition(moment(8.2, { ticksPerStep: 1, steps: 32, scheduledTicks: 10 })), { step: 8, offset: 0 });
});

test('quantize strength is how far a note is moved towards its nearest step', () => {
  const late = (strength: number) => recordPosition(moment(8.6, { scheduledTicks: 12, strength }));
  // Played 30% of the way into step 4.
  assert.deepEqual(late(1), { step: 4, offset: 0 });
  assert.deepEqual(late(0.5), { step: 4, offset: 0.15 });
  assert.deepEqual(late(0), { step: 4, offset: 0.3 });
  // Played early, 30% of a step before step 5: it stays in step 4, most of the way through.
  const early = (strength: number) => recordPosition(moment(9.4, { scheduledTicks: 12, strength }));
  assert.deepEqual(early(1), { step: 5, offset: 0 });
  assert.deepEqual(early(0.5), { step: 4, offset: 0.85 });
  assert.deepEqual(early(0), { step: 4, offset: 0.7 });
  // Never later in a step than a step's offset can be, and a hair off a step is on it.
  assert.deepEqual(recordPosition(moment(9.96, { scheduledTicks: 12, strength: 0 })), { step: 5, offset: 0 });
  assert.deepEqual(recordPosition(moment(8.04, { scheduledTicks: 12, strength: 0 })), { step: 4, offset: 0 });
  for (let ticks = 0; ticks < 32; ticks += 0.37) {
    for (const strength of QUANTIZE_CHOICES) {
      const at = recordPosition(moment(ticks, { strength }));
      assert.ok(Number.isInteger(at.step) && at.step >= 0 && at.step < 16 && at.offset >= 0 && at.offset <= 0.95);
    }
  }
});

test('quantize is one of the strengths offered, and full to begin with', () => {
  assert.equal(DEFAULT_QUANTIZE, 1);
  for (const value of QUANTIZE_CHOICES) assert.equal(asQuantize(value), value);
  for (const odd of [0.3, 2, -1, '1', null, undefined, Number.NaN]) assert.equal(asQuantize(odd), 1);
});

test('the transport says where a moment on the clock falls, behind what it has already scheduled', () => {
  let now = 10;
  const transport = new BrowserTransport(() => now, () => 120, () => {});
  assert.equal(transport.ticksAt(now), 0, 'nothing before it has started');
  transport.start(0.04);
  // At 120 a tick is a sixteenth of a second. It has scheduled a little ahead of the clock.
  assert.ok(transport.scheduledTicks >= 1);
  assert.ok(Math.abs(transport.ticksAt(10.04)) < 1e-9, 'the first tick is at the start time');
  assert.ok(Math.abs(transport.ticksAt(10.04 + 0.0625 * 3) - 3) < 1e-9);
  now = 11.04;
  transport.pump();
  assert.ok(Math.abs(transport.ticksAt(11.04) - 16) < 1e-9, 'a second later it is sixteen ticks on');
  assert.ok(transport.scheduledTicks > transport.ticksAt(now), 'and the scheduler is ahead of that');
  transport.stop();
});
