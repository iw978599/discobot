// The desk layout on a phone (docs/DESK_LAYOUT_PLAN.md, stage 5): the dock is a sheet raised from the
// bottom edge. It has three heights, a peek, about half the screen and nearly all of it, and the one
// last chosen is this browser's, never the project's.

export type SheetSize = 'peek' | 'half' | 'full';
export const SHEET_SIZES: readonly SheetSize[] = ['peek', 'half', 'full'];

const SHEET_KEY = 'discobot_desk_sheet_v1';

// The bar over the sheet's unit (its handle and tabs), in pixels. rack.css takes it as --sheet-bar.
export const SHEET_BAR = 68;

export const asSheetSize = (value: unknown): SheetSize | null => (SHEET_SIZES.includes(value as SheetSize) ? value as SheetSize : null);
export const readSheetSize = (raw: string | null): SheetSize => asSheetSize(raw) ?? 'half';

export function storedSheetSize(): SheetSize {
  try { return readSheetSize(localStorage.getItem(SHEET_KEY)); } catch { return 'half'; }
}

export function storeSheetSize(size: SheetSize) {
  try { localStorage.setItem(SHEET_KEY, size); } catch { /* kept for this visit only */ }
}

// The three heights on a screen this tall, bar included. A phone on its side is short, and gives the
// sheet more of what it has: it peeks lower and half is more than half. The top bar stays in view even
// when the sheet is full.
export function sheetHeights(viewport: number): Record<SheetSize, number> {
  const short = viewport < 500;
  const peek = short ? 128 : 168;
  const half = Math.max(peek + 48, Math.round(viewport * (short ? 0.6 : 0.5)));
  const full = Math.max(half + 48, viewport - (short ? 48 : 60));
  return { peek, half, full };
}

export const sheetHeight = (size: SheetSize, viewport: number): number => sheetHeights(viewport)[size];

// A height dragged to, held between the peek and full.
export function clampSheetHeight(height: number, viewport: number): number {
  const { peek, full } = sheetHeights(viewport);
  return Math.min(full, Math.max(peek, Number.isFinite(height) ? Math.round(height) : peek));
}

// Where a drag that let go at this height settles: the size whose height is nearest.
export function nearestSheetSize(height: number, viewport: number): SheetSize {
  const heights = sheetHeights(viewport);
  return SHEET_SIZES.reduce((best, size) => (Math.abs(heights[size] - height) < Math.abs(heights[best] - height) ? size : best), 'half' as SheetSize);
}

// What a key does to the sheet's size: Up is taller (the handle is over the sheet), Home the peek and
// End the most. Anything else is not for the handle.
export function sheetKeySize(key: string, size: SheetSize): SheetSize | null {
  const at = SHEET_SIZES.indexOf(size);
  if (key === 'ArrowUp') return SHEET_SIZES[Math.min(SHEET_SIZES.length - 1, at + 1)];
  if (key === 'ArrowDown') return SHEET_SIZES[Math.max(0, at - 1)];
  if (key === 'Home') return 'peek';
  if (key === 'End') return 'full';
  return null;
}
