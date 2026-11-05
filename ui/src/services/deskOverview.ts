import type { SequencerStep } from '../types';
import { onBeat } from './patternLength';
import { stepNotes } from './noteScheduling';

// The desk's overview grid (docs/DESK_LAYOUT_PLAN.md, stage 3): each track's pattern for the open scene
// laid across the scene's whole length. These are its pure parts.

// One column of a track's row. `step` is the step of the pattern the column plays, which is the step a
// click on it edits; a `ghost` is a repeat of a pattern shorter than the scene.
export interface OverviewCell { column: number; step: number; ghost: boolean; barStart: boolean; beat: boolean }

// The columns of a row: `perBar` of them for each of the scene's `bars`, so a lane of 32 steps a bar has
// twice the columns of one of 16 and fills the same width. A pattern of fewer steps than the columns is
// played again from its start, which is what the repeats show.
export function overviewColumns(stepCount: number, perBar: number, bars: number, signature?: unknown): OverviewCell[] {
  if (stepCount < 1 || perBar < 1 || bars < 1) return [];
  return Array.from({ length: perBar * bars }, (_, column) => ({
    column,
    step: column % stepCount,
    ghost: column >= stepCount,
    barStart: column % perBar === 0,
    beat: onBeat(signature, column % perBar, perBar),
  }));
}

// What a click on a lane's step does: take its notes away when it has any, otherwise give it one. The
// note is the lowest C the lane's keyboard shows, as a randomised line starts on (`useStudioLanes`).
export function toggledNotes(step: SequencerStep | undefined, octaveShift: number): { notes: string[]; on: boolean } {
  const notes = stepNotes(step);
  if (notes.length > 0) return { notes, on: false };
  return { notes: [`C${Math.min(7, Math.max(0, 3 + octaveShift))}`], on: true };
}

interface DrumSteps { steps: boolean[]; stepVelocities?: number[] }

// The drums as one line: a step is lit when any of the rows hits on it, as strongly as the strongest.
export function drumLine(rows: DrumSteps[], length: number): Array<{ on: boolean; velocity: number }> {
  return Array.from({ length }, (_, step) => {
    let on = false, velocity = 0;
    for (const row of rows) {
      if (!row.steps[step]) continue;
      on = true;
      velocity = Math.max(velocity, row.stepVelocities?.[step] ?? 1);
    }
    return { on, velocity };
  });
}

// How faint a hit of this strength is drawn: the drum grid's own range.
export const strengthOpacity = (velocity: number) => 0.45 + Math.min(1, Math.max(0, velocity)) * 0.55;
