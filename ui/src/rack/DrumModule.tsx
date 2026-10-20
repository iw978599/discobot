import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { isAudioFile, listSamples, saveSample } from '../services/sampleStore';
import { MAX_KIT_FILES } from '../services/kitImport';
import KitImportDialog from './KitImportDialog';
import { usePlayhead, usePlayheadMark } from '../hooks/usePlayhead';
import { useHandOvers } from '../hooks/useHandedTo';
import { tracked } from '../studio/tracked';
import UnitHelp, { UNIT_HELP } from './UnitHelp';
import { gridKeyTarget } from './gridKeys';
import { BAR_CHOICES, barSteps, drumBars, onBeat, stepsAcross } from '../services/patternLength';
import CopyToScene from './CopyToScene';
import CopyBar from './CopyBar';
import type { Studio } from '../studio/useStudio';
import { CYMBAL_TYPES, PERC_CHOICES } from '@discobot/engine';
import { DRUM_NAMES, DRUM_ROWS, DRUM_SETTINGS_DEFAULT } from '../services/drumKits';
import { DRUM_FX_DEFAULT } from '../services/effectSettings';
import { DrumInstrument, DrumKitId, DrumState, CymbalType, PercType } from '../types';
import DrumKnob from '../components/DrumKnob';

const INSTRUMENTS = DRUM_ROWS;

const LABELS = DRUM_NAMES;

// The cymbals the Cymbal lane can be. A crash is the lane's own name; the others show theirs.
const PERC_NAMES: Record<PercType, string> = { tambourine: 'Tambourine', shaker: 'Shaker', cowbell: 'Cowbell', sidestick: 'Cross-stick', conga: 'Conga', bongo: 'Bongo' };
const CYMBAL_NAMES: Record<CymbalType, string> = { crash: 'Crash', ride: 'Ride', bell: 'Bell', splash: 'Splash' };
const cymbalName = (type: CymbalType | undefined) => (type && type !== 'crash' && CYMBAL_NAMES[type]) || LABELS.crash;
// A sample's name as a lane shows it: its file's name without the ending.
const sampleTitle = (name: string) => name.replace(/.[a-z0-9]{1,5}$/i, '') || name;

const EXTRA: Record<DrumInstrument, { knob: string; display: (v: number) => string; parse: (n: number) => number }> = {
  kick: { knob: 'Punch', display: (v) => `${(20 + v * 80).toFixed(0)}%`, parse: (n) => (n - 20) / 80 },
  snare: { knob: 'Snap', display: (v) => `${(10 + v * 90).toFixed(0)}%`, parse: (n) => (n - 10) / 90 },
  clap: { knob: 'Spread', display: (v) => `${(8 + (1 - v) * 28).toFixed(0)}ms`, parse: (n) => (36 - n) / 28 },
  closedHH: { knob: 'Tight', display: (v) => `${(15 + (1 - v) * 130).toFixed(0)}ms`, parse: (n) => (145 - n) / 130 },
  openHH: { knob: 'Decay', display: (v) => `${((0.22 + v * 0.85) * 1000).toFixed(0)}ms`, parse: (n) => (n / 1000 - 0.22) / 0.85 },
  snare2: { knob: 'Bend', display: (v) => `${(20 + v * 80).toFixed(0)}%`, parse: (n) => (n - 20) / 80 },
  ride: { knob: 'Decay', display: (v) => `${((0.4 + v * 1.2) * 1000).toFixed(0)}ms`, parse: (n) => (n / 1000 - 0.4) / 1.2 },
  // The cymbal is a recording: its knob is how much of the recording's own ring is left, not a time.
  crash: { knob: 'Decay', display: (v) => `${Math.round(v * 100)}%`, parse: (n) => n / 100 },
};

// In the recorded kit every drum is a recording, and its knob is how much of the recording's own ring is left.
const RECORDING_EXTRA = { knob: 'Decay', display: (v: number) => `${Math.round(v * 100)}%`, parse: (n: number) => n / 100 };

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

// The two effects a drum has a send of its own to. Each is a share of the kit's send to that effect.
const OWN_SENDS = [
  { key: 'delaySend', label: 'Delay', effect: 'delay', kitKnob: 'Dly Send' },
  { key: 'reverbSend', label: 'Reverb', effect: 'reverb', kitKnob: 'Rev Send' },
] as const;

// The whole drum kit as one grid: eight instruments down, sixteen steps across, lined up
// with the synth lanes above. The strip underneath edits the instrument and step you last touched.
function DrumModule({ studio, onHelp }: { studio: Studio; onHelp?: (section: string) => void }) {
  // The kit or a drum handed to a guest says so: it is heard through the guest, not the mix.
  const handed = useHandOvers();
  const {
    drumState, drumAudio, drumKits, selectedDrumKitId, drumFx, drumMasterVolume, drumSwing,
    handleDrumStepToggle: onStepToggle, handleDrumStepVelocity: onStepVelocity, handleDrumStepDetail: onStepDetail,
    handleDrumSettingsChange: onSettings, handleDrumMixChange: onMix, handleDrumFxChange: onFx,
  } = studio;
  const [selected, setSelected] = useState<DrumInstrument>('kick');
  const [selectedStep, setSelectedStep] = useState(0);
  const [showMore, setShowMore] = useState(false);
  const [showSends, setShowSends] = useState(false);
  // A drum pattern longer than one bar is shown a bar at a time. `base` is the first step on show.
  // How long a bar is comes from the open scene's time signature.
  const signature = studio.signature, perBar = barSteps(signature);
  const STEPS = Array.from({ length: perBar }, (_, i) => i);
  const cellsStyle = { '--bar': perBar, '--across': stepsAcross(signature) } as CSSProperties;
  const bars = drumBars(drumState, signature);
  const [viewBar, setViewBar] = useState(0);
  const [follow, setFollow] = useState(true);
  const barAtPlayhead = usePlayhead('drums', step => Math.max(0, Math.floor(step / perBar)));
  const playingBar = studio.isAnyPlaying ? barAtPlayhead : null;
  const gridRef = useRef<HTMLDivElement>(null);
  usePlayheadMark(gridRef, 'drums', studio.isAnyPlaying, '.drum-step-indicator', 'active');
  usePlayheadMark(gridRef, 'drums', studio.isAnyPlaying, '.drum-step-btn', 'current');
  const shownBar = Math.min(bars - 1, follow && playingBar !== null ? playingBar : viewBar);
  const base = shownBar * perBar;
  // The grid's steps are one stop for the Tab key, on the step the keyboard was last on.
  const [gridCursor, setGridCursor] = useState<{ instrument: DrumInstrument; step: number } | null>(null);
  const gridStop = gridCursor && gridCursor.step >= base && gridCursor.step < base + perBar ? gridCursor : { instrument: selected, step: selectedStep >= base && selectedStep < base + perBar ? selectedStep : base };
  // A pattern made shorter can leave the selected step past its end.
  useEffect(() => { if (selectedStep >= bars * perBar) setSelectedStep(0); }, [bars, perBar, selectedStep]);
  // Imported samples a lane can play instead of its built-in sound.
  const [samples, setSamples] = useState<Array<{ id: string; name: string }>>([]);
  const sampleFileRef = useRef<HTMLInputElement>(null);
  const refreshSamples = () => listSamples().then(list => setSamples(list.map(({ id, name }) => ({ id, name })))).catch(() => {});
  // Read again when a lane's sample changes: an imported project file brings its own.
  const laneSamples = INSTRUMENTS.map(instrument => drumState[instrument].sampleId ?? '').join('|');
  // What a lane is shown as: the sample it plays, where it plays one that is on this device; the
  // kind of cymbal; or the drum. Its controls keep the drum's name, as a screen reader and the tests know them.
  const shownName = (instrument: DrumInstrument): string => {
    const track = drumState[instrument], sample = track.sampleId ? samples.find(entry => entry.id === track.sampleId) : undefined;
    if (sample) return sampleTitle(sample.name);
    return instrument === 'crash' ? cymbalName(track.settings.cymbalType) : LABELS[instrument];
  };
  useEffect(() => { void refreshSamples(); }, [laneSamples, studio.sampleStoreVersion]);
  // Several files picked at once, waiting in the kit import dialog to be given lanes.
  const [kitFiles, setKitFiles] = useState<{ files: File[]; picked: number } | null>(null);
  const kitFileRef = useRef<HTMLInputElement>(null);

  const anySolo = INSTRUMENTS.some((instrument) => Boolean(drumState[instrument].solo));
  const allMuted = INSTRUMENTS.every((instrument) => Boolean(drumState[instrument].muted));
  const audible = (state: DrumState, instrument: DrumInstrument) =>
    !state[instrument].muted && (!INSTRUMENTS.some((other) => state[other].solo) || state[instrument].solo);
  const preview = (instrument: DrumInstrument, state: DrumState = drumState, velocity?: number) => {
    if (audible(state, instrument)) void drumAudio.playDrumHit(instrument, state[instrument].settings, velocity ?? false);
  };

  const track = drumState[selected];
  const extra = selectedDrumKitId === 'recorded' && !track.sampleId ? RECORDING_EXTRA : EXTRA[selected];
  const stepLabel = `${LABELS[selected]} step ${selectedStep + 1}`;

  const handleStepClick = (instrument: DrumInstrument, step: number, shiftKey: boolean) => {
    setSelected(instrument);
    setSelectedStep(step);
    // Editing a bar holds the view on it.
    setViewBar(Math.floor(step / perBar));
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
    <section className="rack-unit drum-machine" aria-label="Drums module" data-unit="drums">
      <div className="rack-row drum-top">
        <div className={onHelp ? 'rack-plate static helped' : 'rack-plate static'}>
          <b>Drums</b>
          {handed.drums && <span className="handed-to" title={`The kit is sent to the guest ${handed.drums}, and heard through it`}>→ {handed.drums}</span>}
          {onHelp && <UnitHelp about="the drums" section={UNIT_HELP.drums} onHelp={onHelp} />}
          <select
            className="drum-kit-select"
            aria-label="Drum kit"
            value={selectedDrumKitId}
            disabled={drumKits.length === 0}
            onChange={(event) => { void selectKit(event.target.value as DrumKitId); }}
          >
            {drumKits.length === 0 && <option value={selectedDrumKitId}>No kits available</option>}
            {drumKits.map((kit) => <option key={kit.id} value={kit.id}>{kit.name}</option>)}
          </select>
          <div className="rack-plate-actions">
            <button
              className="rack-btn"
              disabled={drumKits.length === 0}
              onClick={() => { void selectKit(selectedDrumKitId); }}
              title="Put every instrument back to this kit's settings"
            >
              Apply Kit
            </button>
            <button className="rack-btn" onClick={studio.handleDrumReset} title="Clear the drum pattern and settings" aria-label="Reset drums">↺</button>
          </div>
        </div>

        <div
          className="drum-grid"
          ref={gridRef}
          role="group"
          aria-label="Drum steps"
          onKeyDown={(event) => {
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            const cell = (event.target as HTMLElement).closest<HTMLElement>('.drum-step-btn');
            const lanes = [...event.currentTarget.querySelectorAll<HTMLElement>('.drum-grid-row:not(.header) .drum-cells')].map(row => [...row.querySelectorAll<HTMLElement>('.drum-step-btn')]);
            const next = cell && gridKeyTarget(event.key, lanes, cell);
            if (!next) return;
            event.preventDefault();
            next.focus();
          }}
        >
          <div className="drum-grid-row header">
            <span />
            <span />
            <div className="drum-cells" style={cellsStyle}>
              {STEPS.map((column) => (
                <span key={column} className="drum-step-indicator" data-step={base + column}>{column + 1}</span>
              ))}
            </div>
          </div>
          {INSTRUMENTS.map((instrument) => {
            const row = drumState[instrument];
            const shown = shownName(instrument), sampled = Boolean(row.sampleId) && samples.some(entry => entry.id === row.sampleId);
            const playing = sampled ? `${LABELS[instrument]}, playing ${shown}` : LABELS[instrument];
            return (
              <div
                key={instrument}
                className={`drum-grid-row ${selected === instrument ? 'selected' : ''}`}
                data-drum={instrument}
              >
                <button
                  className="drum-name"
                  aria-label={`Select ${LABELS[instrument]}`}
                  aria-pressed={selected === instrument}
                  title={`${playing}${handed[`drum:${instrument}`] ? `: sent to the guest ${handed[`drum:${instrument}`]}, and heard through it. Click to hear it and edit its sound` : ': click to hear it and edit its sound'}`}
                  data-handed={handed[`drum:${instrument}`] ? 'true' : undefined}
                  onClick={() => { setSelected(instrument); preview(instrument); }}
                >
                  {sampled ? <span className="drum-name-sample">{shown}</span> : shown}
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
                <div className="drum-cells" style={cellsStyle}>
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
                        className={`drum-step-btn ${active ? 'active' : ''} ${active && chance < 1 ? 'chance' : ''} ${picked ? 'picked' : ''} ${onBeat(signature, column) ? 'beat' : ''}`}
                        data-step={step}
                        aria-label={`${LABELS[instrument]} step ${step + 1}`}
                        aria-pressed={active}
                        tabIndex={gridStop.instrument === instrument && gridStop.step === step ? 0 : -1}
                        onFocus={() => setGridCursor(now => (now && now.instrument === instrument && now.step === step ? now : { instrument, step }))}
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
            defaultValue={0}
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
            defaultValue={1}
            displayValue={percentText(drumMasterVolume)}
            parseInputValue={parsePercent}
            onChange={studio.handleDrumMasterVolumeChange}
            title="Level of the whole drum kit"
          />
        </div>
      </div>

      <div className="rack-row drum-strip" data-drum={selected}>
        <div className="drum-strip-name">
          <span className="drum-selected-dot" />
          <b>{shownName(selected)}</b>
          {selected === 'crash' && (
            <label className="drum-sound" title="Which cymbal this lane is. Each is a recording of a real one, the same in every kit">
              Cymbal
              <select
                aria-label="Cymbal type"
                value={track.settings.cymbalType ?? 'crash'}
                onChange={(event) => onSettings('crash', { cymbalType: event.target.value as CymbalType })}
              >
                {CYMBAL_TYPES.map(type => <option key={type} value={type}>{CYMBAL_NAMES[type]}</option>)}
              </select>
            </label>
          )}
        </div>
        {PERC_CHOICES[selected] && (
          <label className="drum-sound" title="Which drum or percussion instrument this lane plays. Each is a recording of a real one, the same in every kit">
            Voice
            <select
              aria-label={`${LABELS[selected]} voice`}
              value={track.settings.percType ?? 'default'}
              onChange={(event) => onSettings(selected, { percType: event.target.value as PercType })}
            >
              <option value="default">{LABELS[selected]}</option>
              {PERC_CHOICES[selected]!.map(type => <option key={type} value={type}>{PERC_NAMES[type]}</option>)}
            </select>
          </label>
        )}
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
        <button className="rack-btn" onClick={() => kitFileRef.current?.click()} title="Choose several sample files at once. Each is matched to a lane by its name, and you can change the matches before they are used">
          Import Kit
        </button>
        <input
          ref={kitFileRef}
          type="file"
          hidden
          multiple
          accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a"
          aria-label="Import drum kit files"
          onChange={(event) => {
            const audio = Array.from(event.currentTarget.files ?? []).filter(isAudioFile);
            event.currentTarget.value = '';
            if (audio.length === 0) { studio.setStorageError('None of those files are audio (WAV, MP3, OGG, FLAC, M4A), so there is no kit to import.'); return; }
            setKitFiles({ files: audio.slice(0, MAX_KIT_FILES), picked: audio.length });
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
                onClick={() => { setViewBar(bar); setFollow(false); setSelectedStep(bar * perBar + (selectedStep % perBar)); }}
              >
                {bar + 1}
              </button>
            ))}
            <button className={`rack-btn ${follow ? 'on' : ''}`} aria-pressed={follow} title="Show whichever bar is playing" onClick={() => setFollow(value => !value)}>Follow</button>
          </span>
        )}
        {bars > 1 && <CopyBar part="the drums" bar={shownBar} bars={bars} onCopy={to => studio.handleCopyDrumBar(shownBar, to)} />}
        <CopyToScene
          part={`the ${LABELS[selected]} row`}
          scenes={studio.scenes}
          currentSceneId={studio.currentSceneId}
          filled={scene => Boolean(scene.drums[selected]?.steps.some(Boolean))}
          onCopy={sceneId => studio.handleCopyPartToScene(sceneId, { drum: selected })}
        />
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
          <button className="rack-btn" title="Shift pattern right" aria-label="Shift right" onClick={() => rearrange((step) => (step + perBar - 1) % perBar)}>→ Shift</button>
          <button className="rack-btn" title="Reverse pattern" aria-label="Reverse" onClick={() => rearrange((step) => perBar - 1 - step)}>⇄ Reverse</button>
          <button className="rack-btn" title={`Duplicate first ${perBar / 2} steps to last ${perBar / 2}`} aria-label="Repeat first half" onClick={() => rearrange((step) => (step >= perBar / 2 ? step - perBar / 2 : step))}>⇈ Repeat Half</button>
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
            defaultValue={DRUM_SETTINGS_DEFAULT[selected].volume}
            displayValue={percentText(track.settings.volume)}
            parseInputValue={parsePercent}
            onChange={(value) => onSettings(selected, { volume: value })}
          />
          <DrumKnob
            key={`${selected}-tone`}
            label="Tone"
            ariaLabel={`${LABELS[selected]} tone`}
            value={track.settings.tone}
            defaultValue={DRUM_SETTINGS_DEFAULT[selected].tone}
            displayValue={track.settings.tone.toFixed(2)}
            parseInputValue={parseNumber}
            onChange={(value) => onSettings(selected, { tone: value })}
          />
          <DrumKnob
            key={`${selected}-tune`}
            label="Tune"
            ariaLabel={`${LABELS[selected]} tune`}
            value={track.settings.tune ?? 0}
            defaultValue={DRUM_SETTINGS_DEFAULT[selected].tune}
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
            defaultValue={DRUM_SETTINGS_DEFAULT[selected].extra}
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
                defaultValue={DRUM_SETTINGS_DEFAULT[selected].humanize}
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
                defaultValue={0}
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
          <button className={`rack-btn ${showSends ? 'on' : ''}`} aria-pressed={showSends} onClick={() => setShowSends((value) => !value)} title="Show this drum's and the kit's effect sends, and the mute controls">Sends</button>
        </div>
      </div>

      {kitFiles && (
        <KitImportDialog
          files={kitFiles.files}
          picked={kitFiles.picked}
          lanes={INSTRUMENTS.map(instrument => ({ id: instrument, label: LABELS[instrument] }))}
          onApply={(lane, sampleId) => studio.handleDrumSampleChange(lane, sampleId)}
          onClose={() => { setKitFiles(null); void refreshSamples(); }}
        />
      )}

      {showSends && (
        <div className="rack-row drum-sends" data-drum={selected}>
          <span className="drum-send-name">
            <span className="drum-selected-dot" />
            <b>{LABELS[selected]}'s share</b>
          </span>
          <div className="rack-knobs drum-own-sends" role="group" aria-label={`${LABELS[selected]}'s share of the kit's delay and reverb sends`}>
            {OWN_SENDS.map(({ key, label, effect, kitKnob }) => (
              <DrumKnob
                key={`${selected}-${key}`}
                label={label}
                ariaLabel={`${LABELS[selected]} to ${effect}`}
                value={track.settings[key] ?? 1}
                defaultValue={1}
                displayValue={percentText(track.settings[key] ?? 1)}
                parseInputValue={parsePercent}
                onChange={(value) => onSettings(selected, { [key]: value })}
                title={`How much of the ${LABELS[selected]} goes to the ${effect}: its share of what the kit sends there (${kitKnob}, beside this). At 100% it is sent like the rest of the kit; at 0% it is kept out of the ${effect}`}
              />
            ))}
          </div>
          <span className="step-tools-name">Kit sends</span>
          <div className="rack-knobs">
            {(['reverb', 'delay', 'drive', 'phaser', 'chorus', 'auxA', 'auxB'] as const).map((send) => {
              const label = { reverb: 'Rev Send', delay: 'Dly Send', drive: 'Drv Send', phaser: 'Phs Send', chorus: 'Cho Send', auxA: 'Aux A', auxB: 'Aux B' }[send];
              const master = send === 'reverb' || send === 'delay' ? '. Each drum then sends its own share of this' : '';
              return (
                <DrumKnob
                  key={send}
                  label={label}
                  value={drumFx.sends[send] ?? 0}
                  defaultValue={DRUM_FX_DEFAULT.sends[send] ?? 0}
                  displayValue={percentText(drumFx.sends[send] ?? 0)}
                  parseInputValue={parsePercent}
                  onChange={(value) => onFx({ sends: { [send]: value } })}
                  title={send.startsWith('aux') ? `Amount of the drum kit sent to aux bus ${send.slice(3)}` : `Amount of the drum kit sent to the ${send}${master}`}
                />
              );
            })}
            <DrumKnob
              label="FX Return"
              value={drumFx.returnLevel}
              defaultValue={DRUM_FX_DEFAULT.returnLevel}
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

export default tracked(DrumModule, 'drums');
