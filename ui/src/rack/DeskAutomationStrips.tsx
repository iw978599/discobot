import { memo, type CSSProperties } from 'react';
import type { Automation } from '../types';
import { DRUM_PARAMS } from '../services/paramTargets';
import { describeRange, toUnit } from '../services/automation';
import { drumAutomatedKeys } from '../services/drumAutomation';
import type { OverviewCell } from '../services/deskOverview';

interface Props {
  // The drum, as its cells are named: "Snare".
  name: string;
  automation: Automation | undefined;
  // The row's columns, the same as its cells, so a value sits under its step and a repeat repeats it.
  columns: OverviewCell[];
  // Shows the drum, and so its automation row, in the dock.
  onShow: () => void;
}

// A drum's automation in the desk's overview (docs/DRUM_AUTOMATION_PLAN.md): under the drum's cells, a
// thin strip for each automated setting, a bar in each column as high as the step's value (from the
// middle for a setting that goes both ways, tune and pan), nothing where a step has none. It only
// shows: a press puts the drum in the dock, where its automation row edits it.
function DeskAutomationStrips({ name, automation, columns, onShow }: Props) {
  const keys = drumAutomatedKeys(automation);
  if (keys.length === 0) return null;
  return (
    <div className="desk-auto-strips">
      {keys.map(key => {
        const range = DRUM_PARAMS[key];
        const values = automation![key];
        const middle = range.min < 0 ? 0.5 : 0;
        const set = values.filter(value => value !== null).length;
        return (
          <button
            key={key}
            type="button"
            className="desk-auto-strip"
            aria-label={`${name} ${range.label} automation, ${set} of ${values.length} steps set. Show it in the dock`}
            title={`${name} ${range.label}: automated on ${set} of ${values.length} steps. Press to edit it in the dock`}
            style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` } as CSSProperties}
            onClick={onShow}
          >
            {columns.map(cell => {
              const value = values[cell.step] ?? null;
              const level = value === null ? null : toUnit(range, value);
              const style = level === null ? undefined : {
                '--from': `${Math.min(level, middle) * 100}%`, '--size': `${Math.abs(level - middle) * 100}%`,
              } as CSSProperties;
              return (
                <i
                  key={cell.column}
                  className={`${level === null ? '' : 'set'}${cell.ghost ? ' ghost' : ''}${cell.barStart ? ' bar' : ''}`}
                  style={style}
                  title={value === null ? undefined : `Step ${cell.step + 1}: ${describeRange(range, value)}`}
                />
              );
            })}
            <span className="desk-auto-label" aria-hidden="true">{range.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export default memo(DeskAutomationStrips);
