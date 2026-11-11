import type { SynthParameters } from '../types';
import { SURGE_PATCHES, surgePatch } from '../services/surgePatches';
import { useSurgeStatus, type SurgeState } from '../services/surgeStatus';
import Knob from './Knob';

// What a lane on Surge XT's engine shows (docs/SURGE_XT_PLAN.md): which of Discobot's own Surge
// patches it plays, a knob for each macro the patch names, and what the engine is doing.
const SAYS: Record<SurgeState, string> = {
  loading: 'Loading Surge XT…',
  ready: '',
  shed: 'Surge is playing fewer notes at once to keep up.',
  muted: 'Surge could not keep up on this computer and this lane was silenced. Choose another patch to try again.',
  refused: 'Two lanes already play Surge XT, which is as many as can.',
  failed: 'Surge XT could not be loaded.',
};

// A macro typed as a percentage, "60" or "60%".
const percent = (input: string): number | null => {
  const value = Number.parseFloat(input.replace(/[^0-9+-.]/g, ''));
  return Number.isFinite(value) ? value / 100 : null;
};

export default function SurgeColumn({ laneId, parameters, onParameterChange }: {
  laneId: number; parameters: SynthParameters; onParameterChange: (params: Partial<SynthParameters>) => void;
}) {
  const state = useSurgeStatus(laneId);
  const patch = surgePatch(parameters.surge?.patch) ?? SURGE_PATCHES[0];
  const macros = parameters.surge?.macros ?? [0, 0, 0, 0, 0, 0, 0, 0];
  const setMacro = (index: number, value: number) => onParameterChange({
    surge: { patch: patch.id, macros: macros.map((old, at) => at === index ? value : old) },
  });
  return (
    <div className="synth-column" data-tab="osc">
      <h3>SURGE XT</h3>
      <div className="synth-column-controls">
        <div className="synth-waveform-selector">
          <label>PATCH</label>
          <select
            className="synth-select synth-sample-select"
            aria-label="Surge patch"
            value={patch.id}
            onChange={(event) => onParameterChange({ surge: { patch: event.target.value, macros: [0, 0, 0, 0, 0, 0, 0, 0] } })}
          >
            {SURGE_PATCHES.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
        </div>
        {patch.macros.map((name, index) => (
          <Knob
            key={`${patch.id}-${index}`}
            label={name}
            ariaLabel={`Surge ${name}`}
            param={`surgeMacro${index + 1}`}
            value={macros[index] ?? 0}
            defaultValue={0}
            min={0}
            max={1}
            step={0.01}
            displayValue={`${Math.round((macros[index] ?? 0) * 100)}%`}
            onChange={(value) => setMacro(index, value)}
            parseInputValue={percent}
            color="#a855f7"
            tooltip={`${patch.name}'s ${name} macro`}
          />
        ))}
        {state && SAYS[state] && <p className="synth-sample-note" role="status">{SAYS[state]}</p>}
        <p className="synth-sample-note">Surge XT, free and open-source, by the Surge Synth Team (GPL-3). The other pages' sound controls do not change a Surge patch; level, pan, sends and inserts do.</p>
      </div>
    </div>
  );
}
