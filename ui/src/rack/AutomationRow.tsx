import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import type { Pattern, SynthParameters } from '../types';
import { AUTOMATABLE, MAX_AUTOMATED, automatedKeys, describeValue, toUnit } from '../services/automation';
import { LANE_PARAMS, fromUnit } from '../services/paramTargets';
import { barSteps, onBeat, stepsAcross } from '../services/patternLength';
import { usePlayheadMark } from '../hooks/usePlayhead';

interface AutomationRowProps {
  synthId: number;
  pattern: Pattern;
  // The lane's own sound: what a step with no value plays.
  params: SynthParameters;
  isPlaying: boolean;
  // The bar on show, as the step row above has it.
  firstStep: number;
  visibleSteps: number;
  signature: unknown;
  // Auto: knobs turned while the song plays are written into the pattern.
  recording: boolean;
  onRecordingChange: (recording: boolean) => void;
  onDraw: (key: string, steps: number[], value: number | null) => void;
  onClear: (key: string) => void;
}

const within = (unit: number) => Math.max(0, Math.min(1, unit));

// The row under a lane's steps that shows one parameter's automation: a bar for each step of the
// bar on show, as tall as the value, and nothing where the step has none. It is laid out on the
// lane's own columns, so each bar stands under its step. Which parameter is on show is this
// row's own; everything else is the pattern's.
export default function AutomationRow({ synthId, pattern, params, isPlaying, firstStep, visibleSteps, signature, recording, onRecordingChange, onDraw, onClear }: AutomationRowProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [chosen, setChosen] = useState('');
  const [erasing, setErasing] = useState(false);
  // The step the keyboard was last on: the strip is one stop for the Tab key.
  const [focused, setFocused] = useState<number | null>(null);
  const drawing = useRef<{ pointer: number; step: number; unit: number | null } | null>(null);
  usePlayheadMark(stripRef, synthId, isPlaying, '.auto-cell', 'playing');

  const automated = automatedKeys(pattern.automation);
  // A parameter that was chosen stays on show; with none chosen, the first that has automation is.
  const key = AUTOMATABLE.includes(chosen) ? chosen : automated[0] ?? '';
  const range = key ? LANE_PARAMS[key] : null;
  const values = key ? pattern.automation?.[key] : undefined;
  const own = range ? range.path!.reduce<unknown>((inner, name) => (inner as Record<string, unknown> | undefined)?.[name], params) : undefined;
  const rest = range ? (typeof own === 'number' ? own : range.min) : 0;
  const count = pattern.steps.length, last = Math.min(count, firstStep + visibleSteps) - 1;
  const onShow = (step: number | null): step is number => step !== null && step >= firstStep && step <= last;
  const stop = onShow(focused) ? focused : firstStep;

  const cellAt = (x: number, y: number) => {
    const cell = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('.auto-cell');
    return cell && stripRef.current?.contains(cell) ? cell : null;
  };
  const unitAt = (cell: HTMLElement, y: number) => {
    const box = cell.getBoundingClientRect();
    return within(1 - (y - box.top) / Math.max(1, box.height));
  };
  // One step drawn: its bar set to where the pointer is in the cell, or rubbed out.
  const draw = (step: number, unit: number | null) => { if (range) onDraw(key, [step], unit === null ? null : fromUnit(range, unit)); };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>('.auto-cell');
    if (!cell || !range || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const step = Number(cell.dataset.step), unit = erasing ? null : unitAt(cell, event.clientY);
    drawing.current = { pointer: event.pointerId, step, unit };
    cell.focus({ preventScroll: true });
    draw(step, unit);
  };
  // A pointer that moves draws along its way. Steps it passed over between two events are drawn
  // too, on a line between the two, so a quick stroke leaves no gaps.
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const stroke = drawing.current;
    if (!stroke || stroke.pointer !== event.pointerId) return;
    const cell = cellAt(event.clientX, event.clientY);
    if (!cell) return;
    const step = Number(cell.dataset.step), unit = erasing ? null : unitAt(cell, event.clientY);
    if (step === stroke.step && unit === stroke.unit) return;
    const span = Math.abs(step - stroke.step), direction = step > stroke.step ? 1 : -1;
    for (let passed = 1; passed < span; passed++) {
      draw(stroke.step + passed * direction, unit === null || stroke.unit === null ? unit : stroke.unit + (unit - stroke.unit) * (passed / span));
    }
    draw(step, unit);
    drawing.current = { pointer: stroke.pointer, step, unit };
  };
  const endStroke = (event: PointerEvent<HTMLDivElement>) => { if (drawing.current?.pointer === event.pointerId) drawing.current = null; };

  // Up and down change the step's value, a twentieth of the range at a time (a hundredth with
  // Shift, a fifth with Page Up and Page Down); Home and End are its ends; Delete takes it away;
  // left and right move along the steps.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>('.auto-cell');
    if (!cell || !range || event.ctrlKey || event.metaKey || event.altKey) return;
    const step = Number(cell.dataset.step), value = values?.[step] ?? null, unit = toUnit(range, value ?? rest);
    const moves: Record<string, number> = { ArrowUp: event.shiftKey ? 0.01 : 0.05, ArrowDown: event.shiftKey ? -0.01 : -0.05, PageUp: 0.2, PageDown: -0.2 };
    if (event.key in moves) draw(step, within(unit + moves[event.key]));
    else if (event.key === 'Home') draw(step, 0);
    else if (event.key === 'End') draw(step, 1);
    else if (event.key === 'Delete' || event.key === 'Backspace') draw(step, null);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const next = step + (event.key === 'ArrowRight' ? 1 : -1);
      if (onShow(next)) stripRef.current?.querySelector<HTMLElement>(`.auto-cell[data-step="${next}"]`)?.focus();
    } else return;
    event.preventDefault();
  };

  const shown = onShow(focused) ? focused : null;
  const full = automated.length >= MAX_AUTOMATED;
  return (
    <div className="rack-row auto-row">
      <label className="auto-pick">
        <span>Automation</span>
        <select aria-label={`Synth ${synthId} automation parameter`} title="The parameter whose automation is shown and drawn here" value={key} onChange={(event) => { setChosen(event.target.value); setErasing(false); }}>
          {!key && <option value="">Choose…</option>}
          {automated.length > 0 && (
            <optgroup label="Automated">
              {automated.map(entry => <option key={entry} value={entry}>{LANE_PARAMS[entry].label}</option>)}
            </optgroup>
          )}
          <optgroup label={full ? 'Add… (a lane can automate eight)' : 'Add…'}>
            {AUTOMATABLE.filter(entry => !automated.includes(entry)).map(entry => <option key={entry} value={entry} disabled={full}>{LANE_PARAMS[entry].label}</option>)}
          </optgroup>
        </select>
      </label>
      {range ? (
        <div
          ref={stripRef}
          className={`auto-strip${visibleSteps > barSteps(signature) ? ' fine' : ''}${erasing ? ' erasing' : ''}`}
          role="group"
          aria-label={`${range.label} automation`}
          style={{ gridTemplateColumns: `repeat(${visibleSteps}, minmax(0, 1fr))`, '--bar': barSteps(signature), '--across': stepsAcross(signature) } as CSSProperties}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          onKeyDown={onKeyDown}
        >
          {Array.from({ length: last - firstStep + 1 }, (_, column) => {
            const step = firstStep + column, value = values?.[step] ?? null;
            return (
              <div
                key={step}
                className={`auto-cell${value !== null ? ' set' : ''}${onBeat(signature, column, visibleSteps) ? ' beat' : ''}`}
                data-step={step}
                role="slider"
                aria-orientation="vertical"
                aria-label={`${range.label} automation, step ${step + 1}`}
                aria-valuemin={range.min}
                aria-valuemax={range.max}
                aria-valuenow={value ?? rest}
                aria-valuetext={value === null ? `No value: plays the sound's own, ${describeValue(key, rest)}` : describeValue(key, value)}
                title={`Step ${step + 1}: ${value === null ? `no value, plays the sound's own ${describeValue(key, rest)}` : describeValue(key, value)}`}
                tabIndex={step === stop ? 0 : -1}
                onFocus={() => setFocused(step)}
              >
                <span className="auto-rest" style={{ bottom: `${toUnit(range, rest) * 100}%` }} />
                {value !== null && <span className="auto-bar" style={{ height: `${Math.max(6, toUnit(range, value) * 100)}%` }} />}
              </div>
            );
          })}
        </div>
      ) : (
        <span className="rack-hint auto-empty">Choose a parameter to draw how it moves through the bar, or switch Auto on and turn one of this lane’s knobs while the song plays.</span>
      )}
      <div className="auto-tools">
        <button
          className={recording ? 'rack-btn on' : 'rack-btn'}
          aria-pressed={recording}
          aria-label="Record automation"
          title="Auto: while the song plays, turning one of a lane's knobs is written into its pattern step by step, and the sound's own setting stays where it was. Stop, or Auto switched off, ends the pass; one Undo takes the whole pass back"
          onClick={() => onRecordingChange(!recording)}
        >
          Auto
        </button>
        {range && (
          <>
            <button className={erasing ? 'rack-btn on' : 'rack-btn'} aria-pressed={erasing} aria-label="Erase automation steps" title="Drawing across steps takes their values away instead of setting them" onClick={() => setErasing(on => !on)}>Erase</button>
            <button className="rack-btn" aria-label="Clear this automation" title={`Take all of ${range.label}'s automation out of this lane's pattern`} disabled={!values} onClick={() => onClear(key)}>Clear</button>
            <span className="rack-readout auto-readout">{shown === null ? '' : `${shown + 1}: ${values?.[shown] == null ? '–' : describeValue(key, values[shown]!)}`}</span>
          </>
        )}
      </div>
    </div>
  );
}
