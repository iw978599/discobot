import { useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { usePlayheadMark } from '../hooks/usePlayhead';
import type { PlayheadLane } from '../services/playhead';
import { gridKeyTarget } from './gridKeys';
import type { OverviewCell } from '../services/deskOverview';

// One column of a row, with what is drawn on it. `strength` is 0 to 1 and only means something when `on`.
export interface DeskCellData extends OverviewCell {
  on: boolean;
  strength: number;
  // A hit that may not play (chance below one), drawn dashed as the drum grid does.
  dashed: boolean;
  selected: boolean;
  text?: string;
  title?: string;
}

interface DeskCellsProps {
  // What the row is called in its cells' names: "Synth 2", "Kick", "Drums".
  name: string;
  cells: DeskCellData[];
  // How many steps the pattern has, to number a repeat.
  stepCount: number;
  // Whose playhead lights the row.
  lane: PlayheadLane;
  playing: boolean;
  // A cell pressed; `shift` when Shift was held (or Shift+Enter was pressed).
  onCell: (cell: DeskCellData, shift: boolean) => void;
  // Whether a cell says it is on or off to a screen reader. The drums' combined line only opens its fold.
  pressable?: boolean;
}

const vertical = (event: KeyboardEvent<HTMLElement>) => {
  const row = (event.target as HTMLElement).closest<HTMLElement>('.desk-cells');
  const cell = (event.target as HTMLElement).closest<HTMLElement>('.desk-cell');
  const grid = row?.closest<HTMLElement>('.desk-grid');
  if (!row || !cell || !grid) return null;
  const rows = [...grid.querySelectorAll<HTMLElement>('.desk-cells')];
  const next = rows[rows.indexOf(row) + (event.key === 'ArrowDown' ? 1 : -1)];
  if (!next) return null;
  const cells = next.querySelectorAll<HTMLElement>('.desk-cell');
  const at = [...row.querySelectorAll<HTMLElement>('.desk-cell')].indexOf(cell);
  return cells[Math.min(at, cells.length - 1)] ?? null;
};

// A track's pattern as a row of cells (docs/DESK_LAYOUT_PLAN.md, stage 3). Each cell is a button; the
// row is one stop for the Tab key and the arrow keys walk it, Up and Down going to the row above or
// below. The playing step is lit by `usePlayheadMark`, so a cell carries `data-step` and the light's
// class is never in its className. A repeat of a short pattern has no `data-step`: the light stays on the
// step it repeats.
export default function DeskCells({ name, cells, stepCount, lane, playing, onCell, pressable = true }: DeskCellsProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState<number | null>(null);
  usePlayheadMark(rowRef, lane, playing, '.desk-cell[data-step]', 'now');
  const picked = cells.find(cell => cell.selected && !cell.ghost)?.column;
  const stop = focused !== null && focused < cells.length ? focused : picked ?? 0;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const cell = (event.target as HTMLElement).closest<HTMLElement>('.desk-cell');
    if (!cell) return;
    const next = event.key === 'ArrowUp' || event.key === 'ArrowDown'
      ? vertical(event)
      : gridKeyTarget(event.key, [[...event.currentTarget.querySelectorAll<HTMLElement>('.desk-cell')]], cell);
    if (!next) return;
    event.preventDefault();
    next.focus();
  };
  return (
    <div ref={rowRef} className="desk-cells" role="group" aria-label={`Overview ${name}`} style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` } as CSSProperties} onKeyDown={onKeyDown}>
      {cells.map(cell => {
        const repeat = Math.floor(cell.column / stepCount);
        return (
          <button
            key={cell.column}
            className={`desk-cell${cell.on ? ' on' : ''}${cell.dashed ? ' chance' : ''}${cell.ghost ? ' ghost' : ''}${cell.selected ? ' selected' : ''}${cell.beat ? ' beat' : ''}${cell.barStart ? ' bar' : ''}`}
            data-step={cell.ghost ? undefined : cell.step}
            aria-label={`Overview ${name} step ${cell.step + 1}${cell.ghost ? ` repeat ${repeat + 1}` : ''}`}
            aria-pressed={pressable ? cell.on : undefined}
            tabIndex={cell.column === stop ? 0 : -1}
            style={cell.on ? { '--strength': cell.strength } as CSSProperties : undefined}
            title={cell.title}
            onFocus={() => setFocused(cell.column)}
            onClick={event => onCell(cell, event.shiftKey)}
          >
            {cell.text}
          </button>
        );
      })}
    </div>
  );
}
