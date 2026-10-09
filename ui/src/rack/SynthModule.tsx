import { useEffect, useRef, useState } from 'react';
import type { Studio } from '../studio/useStudio';
import { SynthModelParams } from '../types';
import { getSynthModelDefinition } from '../synthModels';
import Knob from '../components/Knob';
import SynthControls, { type SynthTab } from '../components/SynthControls';
import KeyboardPanel from '../components/KeyboardPanel';
import StepRow from './StepRow';

const AMBER = '#ffb000';

const percent = (input: string): number | null => {
  const value = Number.parseFloat(input.replace(/[^0-9+-.]/g, ''));
  return Number.isFinite(value) ? value / 100 : null;
};
const cutoff = (input: string): number | null => {
  const value = Number.parseFloat(input.replace(/[^0-9+-.]/g, ''));
  if (!Number.isFinite(value)) return null;
  return /k/i.test(input) ? value * 1000 : value;
};

const milliseconds = (input: string): number | null => {
  const value = Number.parseFloat(input.replace(/[^0-9+-.]/g, ''));
  return Number.isFinite(value) ? value / 1000 : null;
};

interface SynthModuleProps {
  studio: Studio;
  synthId: number;
}

// One rack unit per synth lane: name plate, mute and solo, the pattern, and the few knobs
// you reach for most. The selected lane also opens its full editor underneath.
// How late a step can start, as a fraction of a step.
const TIMINGS: Array<[number, string]> = [[0, 'On the step'], [0.25, '¼ step late'], [1 / 3, '⅓ step late'], [0.5, '½ step late'], [2 / 3, '⅔ step late'], [0.75, '¾ step late']];

export default function SynthModule({ studio, synthId }: SynthModuleProps) {
  const [tab, setTab] = useState<SynthTab>('notes');
  const synth = studio.synths.find(entry => entry.id === synthId);
  const selected = studio.selectedSynthId === synthId;
  const sectionRef = useRef<HTMLElement>(null);
  const selectedStep = synth?.selectedStep ?? null;
  const stepCount = synth?.pattern?.steps.length ?? 0;
  const selectStep = studio.handleStepSelect;

  // With a step selected on the open lane, the left and right arrow keys walk along the row.
  useEffect(() => {
    if (!selected || selectedStep === null || stepCount === 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      // Knobs, sliders, menus, text fields and the piano roll use the arrow keys themselves.
      if (target?.closest('input, select, textarea, [role="slider"], [role="menu"], [role="tablist"], [aria-modal="true"], .piano-roll')) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      const next = (selectedStep + (event.key === 'ArrowRight' ? 1 : stepCount - 1)) % stepCount;
      selectStep(synthId, next);
      // Keep keyboard focus on the selected cell if it was on the row, so Enter still acts on what is highlighted.
      const cells = sectionRef.current?.querySelectorAll<HTMLElement>('.step-cell');
      if (cells && target?.classList.contains('step-cell')) cells[next]?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selected, selectedStep, stepCount, synthId, selectStep]);

  if (!synth) {
    return (
      <section className="rack-unit empty" aria-label={`Synth ${synthId}`}>
        <button
          className="rack-btn"
          onClick={() => { void studio.ensureSynthExists(synthId).then(created => { if (created) studio.setSelectedSynthId(synthId); }); }}
        >
          Synth {synthId} +
        </button>
        <span className="rack-hint">Empty slot. Add a third voice to the arrangement.</span>
      </section>
    );
  }

  const params = synth.synthParams;
  const model = getSynthModelDefinition(synth.synthModelId);
  const change = studio.handleParameterChange;

  return (
    <section ref={sectionRef} className={`rack-unit synth-module ${selected ? 'selected' : ''}`} aria-label={`Synth ${synthId} module`}>
      <div className="rack-row">
        <button
          className="rack-plate"
          aria-label={`Synth ${synthId}`}
          aria-pressed={selected}
          onClick={() => studio.setSelectedSynthId(synthId)}
          title={selected ? 'This lane is open for editing' : 'Open this lane for editing'}
        >
          <b>Synth {synthId}</b>
          <span>{model.id === 'generic' ? 'Analog' : model.name}</span>
        </button>
        <div className="rack-ms">
          <button
            className={synth.muted ? 'on' : ''}
            aria-label={`Mute Synth ${synthId}`}
            aria-pressed={synth.muted}
            onClick={() => { void studio.handleSynthMixChange(synthId, { muted: !synth.muted }); }}
          >
            M
          </button>
          <button
            className={synth.solo ? 'on' : ''}
            aria-label={`Solo Synth ${synthId}`}
            aria-pressed={synth.solo}
            onClick={() => { void studio.handleSynthMixChange(synthId, { solo: !synth.solo }); }}
          >
            S
          </button>
        </div>
        {synth.pattern && (
          <StepRow
            pattern={synth.pattern}
            isPlaying={synth.isPlaying}
            currentStep={synth.currentStep}
            selectedStep={synth.selectedStep}
            onStepClick={(step) => {
              studio.setSelectedSynthId(synthId);
              void studio.handleStepChange(synthId, step);
            }}
          />
        )}
        {params && (
          <div className="rack-knobs">
            {model.macros.length > 0 ? (
              <div className="synth-model-macro-grid" title={model.subtitle}>
                {model.macros.map((macro) => (
                  <Knob
                    key={macro.key}
                    size="small"
                    label={macro.label}
                    ariaLabel={`Synth ${synthId} ${macro.label}`}
                    value={synth.synthModelParams[macro.key]}
                    displayValue={`${Math.round(synth.synthModelParams[macro.key] * 100)}%`}
                    parseInputValue={percent}
                    onChange={(value) => { void studio.handleSynthModelChange(synthId, synth.synthModelId, { [macro.key]: value } as Partial<SynthModelParams>); }}
                    color={AMBER}
                  />
                ))}
              </div>
            ) : (
              <>
                <Knob
                  size="small"
                  label="Cutoff"
                  ariaLabel={`Synth ${synthId} cutoff`}
                  value={params.filter.frequency}
                  min={20}
                  max={20000}
                  step={10}
                  displayValue={params.filter.frequency >= 1000 ? `${(params.filter.frequency / 1000).toFixed(1)}k` : `${params.filter.frequency}`}
                  parseInputValue={cutoff}
                  onChange={(value) => { void change(synthId, { filter: { ...params.filter, frequency: value } }); }}
                  color={AMBER}
                />
                <Knob
                  size="small"
                  label="Reso"
                  ariaLabel={`Synth ${synthId} resonance`}
                  value={params.filter.q}
                  min={0.1}
                  max={20}
                  step={0.1}
                  onChange={(value) => { void change(synthId, { filter: { ...params.filter, q: value } }); }}
                  color={AMBER}
                />
                <Knob
                  size="small"
                  label="Env"
                  ariaLabel={`Synth ${synthId} filter envelope`}
                  value={params.filter.envAmount ?? 0}
                  min={-1}
                  max={1}
                  displayValue={`${Math.round((params.filter.envAmount ?? 0) * 100)}%`}
                  parseInputValue={percent}
                  onChange={(value) => { void change(synthId, { filter: { ...params.filter, envAmount: value } }); }}
                  color={AMBER}
                />
                <Knob
                  size="small"
                  label="Decay"
                  ariaLabel={`Synth ${synthId} decay`}
                  value={params.envelope.decay}
                  min={0}
                  max={2}
                  displayValue={`${Math.round(params.envelope.decay * 1000)}ms`}
                  parseInputValue={milliseconds}
                  onChange={(value) => { void change(synthId, { envelope: { ...params.envelope, decay: value } }); }}
                  color={AMBER}
                />
              </>
            )}
            <Knob
              size="small"
              label="Level"
              ariaLabel={`Synth ${synthId} level`}
              value={params.gain}
              min={0}
              max={2}
              displayValue={`${Math.round(params.gain * 100)}%`}
              parseInputValue={percent}
              onChange={(value) => { void change(synthId, { gain: value }); }}
              color="#f1f1ee"
            />
          </div>
        )}
      </div>

      {selected && params && (
        <SynthControls
          parameters={params}
          onParameterChange={(next) => { void change(synthId, next); }}
          presets={studio.synthPresets}
          onSavePreset={(name) => studio.handleSaveSynthPreset(synthId, name)}
          onLoadPreset={(presetId) => { void studio.handleLoadSynthPreset(synthId, presetId); }}
          onDeletePreset={studio.handleDeleteSynthPreset}
          synthModelId={synth.synthModelId}
          onModelChange={(modelId) => { void studio.handleSynthModelChange(synthId, modelId); }}
          tab={tab}
          onTabChange={setTab}
          onRemove={synthId !== 1 ? () => { void studio.handleRemoveSynth(synthId); } : undefined}
          notes={synth.pattern && (
            <div className="synth-notes">
              <div className="step-tools">
                <label>
                  Length
                  <select
                    aria-label="Sequence length"
                    value={synth.pattern.steps.length}
                    onChange={(event) => { void studio.handleStepCountChange(synthId, Number(event.target.value) as 16 | 32); }}
                  >
                    <option value={16}>16 steps</option>
                    <option value={32}>32 steps</option>
                  </select>
                </label>
                {synth.selectedStep === null ? (
                  <span className="rack-hint">Select a step above, then play a key to put a note on it. The arrow keys move along the row; click a step with a note again to clear it. In the piano roll, click several notes in one column for a chord.</span>
                ) : (
                  <>
                    <span className="step-tools-name">Step {synth.selectedStep + 1}</span>
                    <label>
                      Velocity
                      <input
                        type="range"
                        aria-label={`Step ${synth.selectedStep + 1} velocity`}
                        min={0}
                        max={1}
                        step={0.01}
                        value={synth.pattern.steps[synth.selectedStep]?.velocity ?? 0.7}
                        onChange={(event) => { void studio.handleStepVelocityChange(synthId, synth.selectedStep!, Number(event.target.value)); }}
                      />
                      <span className="rack-readout">{Math.round((synth.pattern.steps[synth.selectedStep]?.velocity ?? 0.7) * 127)}</span>
                    </label>
                    <label title="Hold this note into the next step. On a mono synth the pitch glides instead of retriggering.">
                      <input
                        type="checkbox"
                        aria-label={`Step ${synth.selectedStep + 1} slide`}
                        checked={Boolean(synth.pattern.steps[synth.selectedStep]?.slide)}
                        onChange={(event) => { void studio.handleStepSlideChange(synthId, synth.selectedStep!, event.target.checked); }}
                      />
                      Slide
                    </label>
                    <label title="How often this step plays each time the pattern comes round">
                      Chance
                      <input
                        type="range"
                        aria-label={`Step ${synth.selectedStep + 1} chance`}
                        min={0}
                        max={1}
                        step={0.05}
                        disabled={!synth.pattern.steps[synth.selectedStep]?.note}
                        value={synth.pattern.steps[synth.selectedStep]?.probability ?? 1}
                        onChange={(event) => { void studio.handleStepDetailChange(synthId, synth.selectedStep!, { probability: Number(event.target.value) }); }}
                      />
                      <span className="rack-readout">{Math.round((synth.pattern.steps[synth.selectedStep]?.probability ?? 1) * 100)}%</span>
                    </label>
                    <label title="Hits packed evenly into this step's length">
                      Repeats
                      <select
                        aria-label={`Step ${synth.selectedStep + 1} repeats`}
                        disabled={!synth.pattern.steps[synth.selectedStep]?.note}
                        value={synth.pattern.steps[synth.selectedStep]?.ratchet ?? 1}
                        onChange={(event) => { void studio.handleStepDetailChange(synthId, synth.selectedStep!, { ratchet: Number(event.target.value) }); }}
                      >
                        {[1, 2, 3, 4].map((count) => <option key={count} value={count}>{count}</option>)}
                      </select>
                    </label>
                    <label title="Start this step's notes late, between this step and the next">
                      Timing
                      <select
                        aria-label={`Step ${synth.selectedStep + 1} timing`}
                        disabled={!synth.pattern.steps[synth.selectedStep]?.note}
                        value={String(TIMINGS.reduce((best, [value]) => (Math.abs(value - (synth.pattern!.steps[synth.selectedStep!]?.offset ?? 0)) < Math.abs(best - (synth.pattern!.steps[synth.selectedStep!]?.offset ?? 0)) ? value : best), 0))}
                        onChange={(event) => { void studio.handleStepDetailChange(synthId, synth.selectedStep!, { offset: Number(event.target.value) }); }}
                      >
                        {TIMINGS.map(([value, label]) => <option key={label} value={String(value)}>{label}</option>)}
                      </select>
                    </label>
                    <label title="How many steps this step's notes last">
                      Note length
                      <select
                        aria-label={`Step ${synth.selectedStep + 1} note length`}
                        value={synth.pattern.steps[synth.selectedStep]?.length ?? 1}
                        disabled={!synth.pattern.steps[synth.selectedStep]?.note}
                        onChange={(event) => { void studio.handleStepLengthChange(synthId, synth.selectedStep!, Number(event.target.value)); }}
                      >
                        {Array.from({ length: synth.pattern.steps.length - synth.selectedStep }, (_, index) => (
                          <option key={index + 1} value={index + 1}>{index + 1} {index === 0 ? 'step' : 'steps'}</option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
              </div>
              <KeyboardPanel
                mode={synth.keyboardMode}
                onModeChange={(mode) => studio.handleKeyboardModeChange(synthId, mode)}
                pattern={synth.pattern}
                currentStep={synth.currentStep}
                isPlaying={synth.isPlaying}
                selectedStep={synth.selectedStep}
                octaveShift={synth.octaveShift}
                onOctaveShift={(direction) => studio.handleOctaveShift(synthId, direction)}
                holdEnabled={Boolean(params.hold)}
                releaseSignal={synth.forceReleaseSignal}
                computerKeyNotes={studio.computerKeyNotes}
                onStepSelect={(step) => { studio.handleStepSelect(synthId, step); }}
                onNoteAssign={(stepIndex, note, on, offset) => { void studio.handlePianoRollNoteAssign(synthId, stepIndex, note, on, offset); }}
                onNoteLength={(stepIndex, length) => { void studio.handleStepLengthChange(synthId, stepIndex, length); }}
                onClearPattern={() => { void studio.handleClearPatternNotes(synthId); }}
                onNotePlay={(note) => { void studio.handleNotePlay(synthId, note); }}
                onNoteRelease={(note) => { void studio.handleNoteRelease(synthId, note); }}
              />
            </div>
          )}
        />
      )}
    </section>
  );
}
