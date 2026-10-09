import { useEffect, useRef, useState } from 'react';
import { listSamples, saveSample } from '../services/sampleStore';
import { BAR_CHOICES, drumBars } from '../services/patternLength';
import type { Studio } from '../studio/useStudio';
import { DrumInstrument, DrumKitId, DrumState, CymbalType } from '../types';
import DrumKnob from '../components/DrumKnob';

const INSTRUMENTS: DrumInstrument[] = ['kick', 'snare', 'clap', 'closedHH', 'openHH', 'snare2', 'ride', 'crash'];
const STEPS = Array.from({ length: 16 }, (_, i) => i);

const LABELS: Record<DrumInstrument, string> = {
  kick: 'Kick', snare: 'Snare', clap: 'Clap', closedHH: 'Closed Hat', openHH: 'Open Hat',
  snare2: 'Low Tom', ride: 'High Tom', crash: 'Cymbal',
};
const SHORT_LABELS: Record<DrumInstrument, string> = {
  kick: 'BD', snare: 'SD', clap: 'CP', closedHH: 'CH', openHH: 'OH', snare2: 'LT', ride: 'HT', crash: 'CY',
};
const COLORS: Record<DrumInstrument, string> = {
  kick: '#ef4444', snare: '#f59e0b', clap: '#f97316', closedHH: '#3b82f6', openHH: '#22c55e',
  snare2: '#14b8a6', ride: '#8b5cf6', crash: '#ec4899',
};

const EXTRA: Record<DrumInstrument, { knob: string; display: (v: number) => string; parse: (n: number) => number }> = {
  kick: { knob: 'Punch', display: (v) => `${(20 + v * 80).toFixed(0)}%`, parse: (n) => (n - 20) / 80 },
  snare: { knob: 'Snap', display: (v) => `${(10 + v * 90).toFixed(0)}%`, parse: (n) => (n - 10) / 90 },
  clap: { knob: 'Spread', display: (v) => `${(8 + (1 - v) * 28).toFixed(0)}ms`, parse: (n) => (36 - n) / 28 },
  closedHH: { knob: 'Tight', display: (v) => `${(15 + (1 - v) * 130).toFixed(0)}ms`, parse: (n) => (145 - n) / 130 },
  openHH: { knob: 'Decay', display: (v) => `${((0.22 + v * 0.85) * 1000).toFixed(0)}ms`, parse: (n) => (n / 1000 - 0.22) / 0.85 },
  snare2: { knob: 'Bend', display: (v) => `${(20 + v * 80).toFixed(0)}%`, parse: (n) => (n - 20) / 80 },
  ride: { knob: 'Decay', display: (v) => `${((0.4 + v * 1.2) * 1000).toFixed(0)}ms`, parse: (n) => (n / 1000 - 0.4) / 1.2 },
  crash: { knob: 'Wash', display: (v) => `${((0.8 + v * 2.1) * 1000).toFixed(0)}ms`, parse: (n) => (n / 1000 - 0.8) / 2.1 },
};

const parseNumber = (input: string): number | null => {
  const n = Number.parseFloat(input.replace(/[^0-9+-.]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const parsePercent = (input: string): number | null => {
  const n = parseNumber(input);
  return n === null ? null : n / 100;
};
const parseTune = (input: string): number | null => {
  const n = parseNumber(input);
  return n === null ? null : n / 12;
};
const parsePan = (input: string): number | null => {
  const text = input.trim().toUpperCase();
  if (text === 'C') return 0;
  const n = parseNumber(text);
  return n === null ? null : (text.startsWith('L') ? -Math.abs(n) : n) / 50;
};
const percentText = (value: number) => `${Math.round(value * 100)}%`;

// The whole drum kit as one grid: eight instruments down, sixteen steps across, lined up
// with the synth lanes above. The strip underneath edits the instrument and step you last touched.
export default function DrumModule({ studio }: { studio: Studio }) {
  const {
    drumState, drumAudio, drumKits, drumKitsLoading, drumKitsError, selectedDrumKitId, drumFx, drumMasterVolume, drumSwing,
    handleDrumStepToggle: onStepToggle, handleDrumStepVelocity: onStepVelocity, handleDrumStepDetail: onStepDetail,
    handleDrumSettingsChange: onSettings, handleDrumMixChange: onMix, handleDrumFxChange: onFx,
  } = studio;
  const [selected, setSelected] = useState<DrumInstrument>('kick');
  const [selectedStep, setSelectedStep] = useState(0);
  const [showMore, setShowMore] = useState(false);
  const [showSends, setShowSends] = useState(false);
  // A drum pattern longer than one bar is shown a bar at a time. `base` is the first step on show.
  const bars = drumBars(drumState);
  const [viewBar, setViewBar] = useState(0);
  const [follow, setFollow] = useState(true);
  const playingBar = studio.isAnyPlaying ? Math.floor(studio.drumCurrentStep / 16) : null;
  const shownBar = Math.min(bars - 1, follow && playingBar !== null ? playingBar : viewBar);
  const base = shownBar * 16;
  // A pattern made shorter can leave the selected step past its end.
  useEffect(() => { if (selectedStep >= bars * 16) setSelectedStep(0); }, [bars, selectedStep]);
  // Imported samples a lane can play instead of its built-in sound.
  const [samples, setSamples] = useState<Array<{ id: string; name: string }>>([]);
  const sampleFileRef = useRef<HTMLInputElement>(null);
  const refreshSamples = () => listSamples().then(list => setSamples(list.map(({ id, name }) => ({ id, name })))).catch(() => {});
  useEffect(() => { void refreshSamples(); }, []);

  const anySolo = INSTRUMENTS.some((instrument) => Boolean(drumState[instrument].solo));
  const allMuted = INSTRUMENTS.every((instrument) => Boolean(drumState[instrument].muted));
  const audible = (state: DrumState, instrument: DrumInstrument) =>
    !state[instrument].muted && (!INSTRUMENTS.some((other) => state[other].solo) || state[instrument].solo);
  const preview = (instrument: DrumInstrument, state: DrumState = drumState, velocity?: number) => {
    if (audible(state, instrument)) void drumAudio.playDrumHit(instrument, state[instrument].settings, velocity ?? false);
  };

  const track = drumState[selected];
  const isRide = selected === 'crash' && track.settings.cymbalType === 'ride';
  const extra = isRide ? EXTRA.ride : EXTRA[selected];
  const stepLabel = `${LABELS[selected]} step ${selectedStep + 1}`;

  const handleStepClick = (instrument: DrumInstrument, step: number, shiftKey: boolean) => {
    setSelected(instrument);
    setSelectedStep(step);
    // Editing a bar holds the view on it.
    setViewBar(Math.floor(step / 16));
    setFollow(false);
    const row = drumState[instrument];
    if (shiftKey && row.steps[step]) {
      const levels = [0.25, 0.5, 0.75, 1.0];
      const next = levels[(levels.indexOf(row.stepVelocities?.[step] ?? 1) + 1) % levels.length] ?? 1;
      onStepVelocity(instrument, step, next);
      preview(instrument, drumState, next);
      return;
    }
    if (!row.steps[step]) preview(instrument, drumState, row.stepVelocities?.[step] ?? 1);
    onStepToggle(instrument, step, !row.steps[step]);
  };

  // The pattern tools move steps around; velocity, chance and repeats travel with their step.
  // They work on the bar on show.
  const rearrange = (sourceFor: (step: number) => number) => {
    const steps = STEPS.map((column) => track.steps[base + sourceFor(column)]);
    STEPS.forEach((column) => {
      const step = base + column, from = base + sourceFor(column);
      if (track.stepVelocities) onStepVelocity(selected, step, track.stepVelocities[from] ?? 1);
      if (track.stepProbabilities || track.stepRatchets) {
        const probability = track.stepProbabilities?.[from] ?? 1, ratchet = track.stepRatchets?.[from] ?? 1;
        if (probability !== (track.stepProbabilities?.[step] ?? 1) || ratchet !== (track.stepRatchets?.[step] ?? 1)) {
          onStepDetail(selected, step, { probability, ratchet });
        }
      }
      if (steps[column] !== track.steps[step]) onStepToggle(selected, step, steps[column]);
    });
  };

  const selectKit = async (kitId: DrumKitId) => {
    const next = await studio.handleDrumKitChange(kitId, true);
    preview(selected, next || drumState);
  };

  return (
    <section className="rack-unit drum-machine" aria-label="Drums module">
      <div className="rack-row drum-top">
        <div className="rack-plate static">
          <b>Drums</b>
          <select
            className="drum-kit-select"
            aria-label="Drum kit"
            value={selectedDrumKitId}
            disabled={drumKitsLoading || drumKits.length === 0}
            onChange={(event) => { void selectKit(event.target.value as DrumKitId); }}
          >
            {drumKitsLoading && <option value={selectedDrumKitId}>Loading kits...</option>}
            {!drumKitsLoading && drumKits.length === 0 && <option value={selectedDrumKitId}>No kits available</option>}
            {drumKits.map((kit) => <option key={kit.id} value={kit.id}>{kit.name}</option>)}
          </select>
          <div className="rack-plate-actions">
            <button
              className="rack-btn"
              disabled={drumKitsLoading || drumKits.length === 0}
              onClick={() => { void selectKit(selectedDrumKitId); }}
              title="Put every instrument back to this kit's settings"
            >
              Apply Kit
            </button>
            <button className="rack-btn" onClick={studio.handleDrumReset} title="Clear the drum pattern and settings" aria-label="Reset drums">↺</button>
          </div>
          {drumKitsError && <span className="rack-hint" role="alert">{drumKitsError}</span>}
        </div>

        <div className="drum-grid">
          <div className="drum-grid-row header">
            <span />
            <span />
            <div className="drum-cells">
              {STEPS.map((column) => (
                <span key={column} className={`drum-step-indicator ${studio.isAnyPlaying && studio.drumCurrentStep === base + column ? 'active' : ''}`}>{column + 1}</span>
              ))}
            </div>
          </div>
          {INSTRUMENTS.map((instrument) => {
            const row = drumState[instrument];
            const short = instrument === 'crash' && row.settings.cymbalType === 'ride' ? 'RD' : SHORT_LABELS[instrument];
            return (
              <div
                key={instrument}
                className={`drum-grid-row ${selected === instrument ? 'selected' : ''}`}
                style={{ '--drum-color': COLORS[instrument] } as React.CSSProperties}
              >
                <button
                  className="drum-name"
                  aria-label={`Select ${LABELS[instrument]}`}
                  aria-pressed={selected === instrument}
                  title={`${LABELS[instrument]}: click to hear it and edit its sound`}
                  onClick={() => { setSelected(instrument); preview(instrument); }}
                >
                  {short}
                </button>
                <div className="rack-ms small">
                  <button
                    className={row.muted ? 'on' : ''}
                    aria-label={`Mute ${LABELS[instrument]}`}
                    aria-pressed={Boolean(row.muted)}
                    onClick={() => onMix(instrument, { muted: !row.muted })}
                  >
                    M
                  </button>
                  <button
                    className={row.solo ? 'on' : ''}
                    aria-label={`Solo ${LABELS[instrument]}`}
                    aria-pressed={Boolean(row.solo)}
                    onClick={() => onMix(instrument, { solo: !row.solo })}
                  >
                    S
                  </button>
                </div>
                <div className="drum-cells">
                  {STEPS.map((column) => {
                    const step = base + column;
                    const active = row.steps[step];
                    const velocity = row.stepVelocities?.[step] ?? 1;
                    const chance = row.stepProbabilities?.[step] ?? 1;
                    const repeats = row.stepRatchets?.[step] ?? 1;
                    const picked = selected === instrument && selectedStep === step;
                    return (
                      <button
                        key={step}
                        className={`drum-step-btn ${active ? 'active' : ''} ${active && chance < 1 ? 'chance' : ''} ${picked ? 'picked' : ''} ${column % 4 === 0 ? 'beat' : ''} ${studio.isAnyPlaying && studio.drumCurrentStep === step ? 'current' : ''}`}
                        aria-label={`${LABELS[instrument]} step ${step + 1}`}
                        aria-pressed={active}
                        style={active ? { opacity: 0.45 + velocity * 0.55 } : undefined}
                        onClick={(event) => handleStepClick(instrument, step, event.shiftKey)}
                        title={active ? `Velocity ${percentText(velocity)} (Shift+click to change) · Chance ${percentText(chance)} · Repeats ${repeats}` : ''}
                      >
                        {active && repeats > 1 ? `×${repeats}` : ''}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="rack-knobs">
          <DrumKnob
            label="Swing"
            value={drumSwing}
            min={0}
            max={0.75}
            displayValue={percentText(drumSwing)}
            parseInputValue={parsePercent}
            onChange={studio.handleDrumSwingChange}
            title="Swing amount - delays off-beat steps for groove"
          />
          <DrumKnob
            label="Master"
            value={drumMasterVolume}
            displayValue={percentText(drumMasterVolume)}
            parseInputValue={parsePercent}
            onChange={studio.handleDrumMasterVolumeChange}
            title="Level of the whole drum kit"
          />
        </div>
      </div>

      <div className="rack-row drum-strip" style={{ '--drum-color': COLORS[selected] } as React.CSSProperties}>
        <div className="drum-strip-name">
          <span className="drum-selected-dot" />
          <b>{isRide ? 'Ride' : LABELS[selected]}</b>
          {selected === 'crash' && (
            <button
              className="rack-btn"
              aria-label="Switch cymbal type"
              onClick={() => onSettings('crash', { cymbalType: (isRide ? 'crash' : 'ride') as CymbalType })}
              title="Switch this lane between a crash and a ride"
            >
              {isRide ? 'Ride' : 'Crash'}
            </button>
          )}
        </div>
        <label className="drum-sound" title="Play an imported sample on this lane instead of its built-in sound. Volume, tune and pan still apply">
          Sound
          <select
            aria-label={`${LABELS[selected]} sound`}
            value={track.sampleId ?? ''}
            onFocus={() => { void refreshSamples(); }}
            onChange={(event) => {
              if (event.target.value === 'import') sampleFileRef.current?.click();
              else void studio.handleDrumSampleChange(selected, event.target.value || null);
            }}
          >
            <option value="">Built-in</option>
            {samples.map(sample => <option key={sample.id} value={sample.id}>{sample.name}</option>)}
            {track.sampleId && !samples.some(sample => sample.id === track.sampleId) && <option value={track.sampleId}>Sample not on this device</option>}
            <option value="import">Import a sample…</option>
          </select>
        </label>
        <input
          ref={sampleFileRef}
          type="file"
          hidden
          accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a"
          aria-label="Import drum sample"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (!file) return;
            const lane = selected;
            void saveSample(file)
              .then(async (sample) => { await refreshSamples(); await studio.handleDrumSampleChange(lane, sample.id); })
              .catch((cause) => studio.setStorageError(cause instanceof Error ? cause.message : 'The sample could not be imported.'));
          }}
        />
        {studio.missingDrumSamples.includes(selected) && (
          <span className="rack-hint" role="status">This lane's sample is not on this device, so its built-in sound is playing.</span>
        )}
        <label className="drum-sound" title="How many bars the drum pattern lasts">
          Bars
          <select aria-label="Drum bars" value={bars} onChange={(event) => { void studio.handleDrumBarsChange(Number(event.target.value)); }}>
            {BAR_CHOICES.map(choice => <option key={choice} value={choice}>{choice}</option>)}
          </select>
        </label>
        {bars > 1 && (
          <span className="bar-tabs" role="group" aria-label="Drum bar on show">
            {Array.from({ length: bars }, (_, bar) => (
              <button
                key={bar}
                className={`rack-btn ${bar === shownBar ? 'on' : ''} ${bar === playingBar ? 'playing' : ''}`}
                aria-label={`Drum bar ${bar + 1}`}
                aria-pressed={bar === shownBar}
                onClick={() => { setViewBar(bar); setFollow(false); setSelectedStep(bar * 16 + (selectedStep % 16)); }}
              >
                {bar + 1}
              </button>
            ))}
            <button className={`rack-btn ${follow ? 'on' : ''}`} aria-pressed={follow} title="Show whichever bar is playing" onClick={() => setFollow(value => !value)}>Follow</button>
          </span>
        )}
        <div className="drum-tools">
          <button
            className="rack-btn"
            title="Random fill for selected instrument"
            onClick={() => STEPS.forEach((column) => {
              const step = base + column;
              const active = Math.random() < 0.4;
              if (active !== track.steps[step]) onStepToggle(selected, step, active);
            })}
          >
            Fill
          </button>
          <button className="rack-btn" title="Shift pattern right" onClick={() => rearrange((step) => (step + 15) % 16)}>→</button>
          <button className="rack-btn" title="Reverse pattern" onClick={() => rearrange((step) => 15 - step)}>⇄</button>
          <button className="rack-btn" title="Duplicate first 8 steps to last 8" onClick={() => rearrange((step) => (step >= 8 ? step - 8 : step))}>⇈</button>
        </div>
        <div className="drum-step-details">
          <span className="step-tools-name">Step {selectedStep + 1}</span>
          <label>
            Velocity
            <input
              type="range"
              aria-label={`${stepLabel} velocity`}
              min={0}
              max={1}
              step={0.01}
              value={track.stepVelocities?.[selectedStep] ?? 1}
              onChange={(event) => onStepVelocity(selected, selectedStep, Number(event.target.value))}
            />
          </label>
          <label title="How often this step plays each time the pattern comes round">
            Chance
            <input
              type="range"
              aria-label={`${stepLabel} chance`}
              min={0}
              max={1}
              step={0.05}
              value={track.stepProbabilities?.[selectedStep] ?? 1}
              onChange={(event) => onStepDetail(selected, selectedStep, { probability: Number(event.target.value) })}
            />
            <span className="rack-readout">{percentText(track.stepProbabilities?.[selectedStep] ?? 1)}</span>
          </label>
          <label title="Hits packed evenly into this step">
            Repeats
            <select
              aria-label={`${stepLabel} repeats`}
              value={track.stepRatchets?.[selectedStep] ?? 1}
              onChange={(event) => onStepDetail(selected, selectedStep, { ratchet: Number(event.target.value) })}
            >
              {[1, 2, 3, 4].map((count) => <option key={count} value={count}>{count}</option>)}
            </select>
          </label>
        </div>
        <div className="rack-knobs">
          <DrumKnob
            key={`${selected}-volume`}
            label="Volume"
            ariaLabel={`${LABELS[selected]} volume`}
            value={track.settings.volume}
            displayValue={percentText(track.settings.volume)}
            parseInputValue={parsePercent}
            onChange={(value) => onSettings(selected, { volume: value })}
          />
          <DrumKnob
            key={`${selected}-tone`}
            label="Tone"
            ariaLabel={`${LABELS[selected]} tone`}
            value={track.settings.tone}
            displayValue={track.settings.tone.toFixed(2)}
            parseInputValue={parseNumber}
            onChange={(value) => onSettings(selected, { tone: value })}
          />
          <DrumKnob
            key={`${selected}-tune`}
            label="Tune"
            ariaLabel={`${LABELS[selected]} tune`}
            value={track.settings.tune ?? 0}
            min={-1}
            max={1}
            displayValue={`${((track.settings.tune ?? 0) * 12).toFixed(1)} st`}
            parseInputValue={parseTune}
            onChange={(value) => onSettings(selected, { tune: value })}
          />
          <DrumKnob
            key={`${selected}-extraknob`}
            label={extra.knob}
            ariaLabel={`${LABELS[selected]} ${extra.knob}`}
            value={track.settings.extra}
            displayValue={extra.display(track.settings.extra)}
            parseInputValue={(input) => { const n = parseNumber(input); return n === null ? null : extra.parse(n); }}
            onChange={(value) => onSettings(selected, { extra: value })}
          />
          {showMore && (
            <>
              <DrumKnob
                key={`${selected}-human`}
                label="Human"
                ariaLabel={`${LABELS[selected]} humanize`}
                value={track.settings.humanize ?? 0.35}
                displayValue={percentText(track.settings.humanize ?? 0.35)}
                parseInputValue={parsePercent}
                onChange={(value) => onSettings(selected, { humanize: value })}
                title="Small random pitch changes from hit to hit"
              />
              <DrumKnob
                key={`${selected}-pan`}
                label="Pan"
                ariaLabel={`${LABELS[selected]} pan`}
                min={-1}
                max={1}
                value={track.settings.pan ?? 0}
                displayValue={(() => {
                  const pan = track.settings.pan ?? 0;
                  if (Math.abs(pan) < 0.05) return 'C';
                  return pan < 0 ? `L${Math.round(Math.abs(pan) * 50)}` : `R${Math.round(pan * 50)}`;
                })()}
                parseInputValue={parsePan}
                onChange={(value) => onSettings(selected, { pan: value })}
              />
            </>
          )}
        </div>
        <div className="drum-strip-toggles">
          <button className={`rack-btn ${showMore ? 'on' : ''}`} aria-pressed={showMore} onClick={() => setShowMore((value) => !value)} title="Show the humanize and pan knobs">More</button>
          <button className={`rack-btn ${showSends ? 'on' : ''}`} aria-pressed={showSends} onClick={() => setShowSends((value) => !value)} title="Show the kit's effect sends and mute controls">Sends</button>
        </div>
      </div>

      {showSends && (
        <div className="rack-row drum-sends">
          <span className="step-tools-name">Kit sends</span>
          <div className="rack-knobs">
            {(['reverb', 'delay', 'drive', 'phaser', 'chorus'] as const).map((send) => {
              const label = { reverb: 'Rev Send', delay: 'Dly Send', drive: 'Drv Send', phaser: 'Phs Send', chorus: 'Cho Send' }[send];
              return (
                <DrumKnob
                  key={send}
                  label={label}
                  value={drumFx.sends[send] ?? 0}
                  displayValue={percentText(drumFx.sends[send] ?? 0)}
                  parseInputValue={parsePercent}
                  onChange={(value) => onFx({ sends: { [send]: value } })}
                  title={`Amount of the drum kit sent to the ${send}`}
                />
              );
            })}
            <DrumKnob
              label="FX Return"
              value={drumFx.returnLevel}
              displayValue={percentText(drumFx.returnLevel)}
              parseInputValue={parsePercent}
              onChange={(value) => onFx({ returnLevel: value })}
              title="Level of the drum kit's effects coming back"
            />
          </div>
          <div className="drum-tools">
            <button
              className={`rack-btn ${allMuted ? 'on' : ''}`}
              aria-pressed={allMuted}
              onClick={() => studio.handleDrumMuteAll(!allMuted)}
              title={allMuted ? 'Unmute all drum tracks' : 'Mute all drum tracks'}
            >
              Mute All
            </button>
            <button className="rack-btn" disabled={!anySolo} onClick={studio.handleDrumSoloAll} title="Clear all drum track solos">Clear Solos</button>
          </div>
        </div>
      )}
    </section>
  );
}
