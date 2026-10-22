// Swing and its templates. The drums' swing is one amount, how late the swung steps play, in
// steps, from 0 to 0.75; the grid says which steps swing. On sixteenths (the default, and all
// there was before) every second sixteenth of the bar is late by the amount. On eighths the
// second eighth of each beat is late by twice the amount, and the sixteenths either side of it
// by the amount, so they stay evenly between: an eighth-note shuffle.

export type SwingGrid = 16 | 8;
export const MAX_SWING = 0.75;

export const swingGridOf = (value: unknown): SwingGrid => (value === 8 ? 8 : 16);

// How late step `index` of a bar plays, in steps.
export function swingSteps(index: number, swing: number, grid: SwingGrid = 16): number {
  if (!(swing > 0)) return 0;
  const step = Math.floor(index + 1e-6);
  if (grid === 8) {
    const at = ((step % 4) + 4) % 4;
    return at === 2 ? swing * 2 : at % 2 === 1 ? swing : 0;
  }
  return Math.abs(step % 2) === 1 ? swing : 0;
}

// A swing template: the amount and the grid together, named the way drum machines count swing,
// as where the late note falls between its neighbours (50% is straight, 66.7% a triplet).
export interface SwingTemplate { id: string; name: string; grid: SwingGrid; swing: number; hint: string }

const percent = (swing: number) => 50 + swing * 50;
const named = (grid: SwingGrid, swing: number, name?: string): SwingTemplate => ({
  id: `${grid}-${Math.round(percent(swing) * 10)}`,
  name: name ?? `${grid === 16 ? '16ths' : '8ths'} ${Math.round(percent(swing))}%`,
  grid,
  swing,
  hint: swing === 0 ? 'Straight: every step on the grid'
    : `${grid === 16 ? 'Sixteenths' : 'Eighths'} swung to ${percent(swing).toFixed(swing === 1 / 3 ? 1 : 0)}%${swing === 1 / 3 ? ', a triplet feel' : ''}`,
});

export const SWING_TEMPLATES: SwingTemplate[] = [
  named(16, 0, 'Straight'),
  ...[0.08, 0.16, 0.24, 0.32].map(swing => named(16, swing)),
  named(16, 1 / 3, '16ths triplet'),
  ...[0.42, 0.5].map(swing => named(16, swing)),
  ...[0.08, 0.16, 0.24].map(swing => named(8, swing)),
  named(8, 1 / 3, '8ths shuffle'),
  named(8, 0.5),
];

// The groups the menu shows them in.
export const SWING_GROUPS: Array<{ label: string; templates: SwingTemplate[] }> = [
  { label: 'Sixteenths', templates: SWING_TEMPLATES.filter(template => template.grid === 16) },
  { label: 'Eighths', templates: SWING_TEMPLATES.filter(template => template.grid === 8) },
];

// The template the drums' swing is set to now, or none when the amount was turned by hand.
// Straight is straight on either grid.
export function currentTemplate(swing: number, grid: SwingGrid): SwingTemplate | undefined {
  if (swing === 0) return SWING_TEMPLATES[0];
  return SWING_TEMPLATES.find(template => template.grid === grid && Math.abs(template.swing - swing) < 0.004);
}
