import type { DrumRow } from '../types';

// The drum and step the drums' controls are about. The drum unit and the desk's overview both show it,
// so it is held here, outside React, and read with useSyncExternalStore. It is view state, never the
// project's. `outside` goes up when something other than the drum unit chose, so the unit can bring
// the bar of that step into view; its own clicks are on screen already.
export interface DrumSelection { row: DrumRow; step: number; outside: number }

let selection: DrumSelection = { row: 'kick', step: 0, outside: 0 };
const listeners = new Set<() => void>();

const change = (next: DrumSelection) => {
  if (next.row === selection.row && next.step === selection.step && next.outside === selection.outside) return;
  selection = next;
  listeners.forEach(listener => listener());
};

export const drumSelection = {
  get: () => selection,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  set(next: Partial<Pick<DrumSelection, 'row' | 'step'>>) {
    change({ ...selection, ...next });
  },
  pick(row: DrumRow, step: number) {
    change({ row, step, outside: selection.outside + 1 });
  },
};
