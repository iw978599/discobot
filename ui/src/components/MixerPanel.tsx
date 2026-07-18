import { SynthParameters, EffectsLoopState, DrumInstrument, DrumState } from '../types';
import './MixerPanel.css';

interface MixerPanelProps {
  synths: Array<{
    id: number;
    synthParams: SynthParameters | null;
    muted: boolean;
    solo: boolean;
  }>;
  drumState: DrumState;
  drumMasterVolume: number;
  effectsLoop: EffectsLoopState;
  onSynthGainChange: (synthId: number, gain: number) => void;
  onSynthPanChange: (synthId: number, pan: number) => void;
  onSynthFxReturnChange: (synthId: number, fxReturn: number) => void;
  onSynthMuteChange: (synthId: number, mix: { muted?: boolean; solo?: boolean }) => void;
  onSynthSoloChange: (synthId: number, solo: boolean) => void;
  onDrumMasterVolumeChange: (volume: number) => void;
  onDrumFxReturnChange: (returnLevel: number) => void;
  onEffectsReturnChange: (which: 'synth' | 'drums', value: number) => void;
}

const DRUM_INSTRUMENTS: DrumInstrument[] = ['kick', 'snare', 'openHH', 'closedHH', 'ride', 'crash', 'snare2', 'clap'];
const DRUM_LABELS: Record<DrumInstrument, string> = {
  kick: 'K', snare: 'S', openHH: 'OH', closedHH: 'CH', ride: 'R', crash: 'CR', snare2: 'S2', clap: 'CL',
};

export default function MixerPanel({
  synths,
  drumState,
  drumMasterVolume,
  effectsLoop,
  onSynthGainChange,
  onSynthPanChange,
  onSynthFxReturnChange,
  onSynthMuteChange,
  onSynthSoloChange,
  onDrumMasterVolumeChange,
  onDrumFxReturnChange,
  onEffectsReturnChange,
}: MixerPanelProps) {
  return (
    <section className="mixer-panel">
      <div className="mixer-header">
        <h3>Mixer</h3>
      </div>

      <div className="mixer-channels">
        {synths.map((synth) => {
          const params = synth.synthParams;
          if (!params) return null;
          return (
          <div key={synth.id} className="mixer-channel synth-channel">
            <div className="mixer-channel-label">Synth {synth.id}</div>
            <div className="mixer-fader-row">
              <input
                type="range"
                className="mixer-fader"
                min={0}
                max={2}
                step={0.01}
                value={params.gain}
                onChange={(e) => onSynthGainChange(synth.id, parseFloat(e.target.value))}
                title={`Volume: ${Math.round(params.gain * 100)}%`}
              />
              <span className="mixer-fader-value">{Math.round(params.gain * 100)}</span>
            </div>
            <div className="mixer-knobs-row">
              <div className="mixer-mini-control">
                <label>Pan</label>
                <input
                  type="range"
                  className="mixer-pan-slider"
                  min={-1}
                  max={1}
                  step={0.01}
                  value={params.pan ?? 0}
                  onChange={(e) => onSynthPanChange(synth.id, parseFloat(e.target.value))}
                  title={`Pan: ${(params.pan ?? 0) > 0 ? 'R' : (params.pan ?? 0) < 0 ? 'L' : 'C'}${Math.abs(Math.round((params.pan ?? 0) * 100))}`}
                />
              </div>
              <div className="mixer-mini-control">
                <label>FX</label>
                <input
                  type="range"
                  className="mixer-pan-slider"
                  min={0}
                  max={1}
                  step={0.01}
                  value={params.fxReturn ?? 0.85}
                  onChange={(e) => onSynthFxReturnChange(synth.id, parseFloat(e.target.value))}
                  title={`FX Return: ${Math.round((params.fxReturn ?? 0.85) * 100)}%`}
                />
              </div>
            </div>
            <div className="mixer-mute-solo">
              <button
                className={`mixer-btn mute-btn ${synth.muted ? 'active' : ''}`}
                onClick={() => onSynthMuteChange(synth.id, { muted: !synth.muted })}
                title={synth.muted ? 'Unmute' : 'Mute'}
              >
                M
              </button>
              <button
                className={`mixer-btn solo-btn ${synth.solo ? 'active' : ''}`}
                onClick={() => onSynthSoloChange(synth.id, !synth.solo)}
                title={synth.solo ? 'Unsolo' : 'Solo'}
              >
                S
              </button>
            </div>
          </div>
          );
        })}

        <div className="mixer-channel drum-channel">
          <div className="mixer-channel-label">Drums</div>
          <div className="mixer-fader-row">
            <input
              type="range"
              className="mixer-fader"
              min={0}
              max={1}
              step={0.01}
              value={drumMasterVolume}
              onChange={(e) => onDrumMasterVolumeChange(parseFloat(e.target.value))}
              title={`Volume: ${Math.round(drumMasterVolume * 100)}%`}
            />
            <span className="mixer-fader-value">{Math.round(drumMasterVolume * 100)}</span>
          </div>
          <div className="mixer-knobs-row">
            <div className="mixer-mini-control">
              <label>FX</label>
              <input
                type="range"
                className="mixer-pan-slider"
                min={0}
                max={1}
                step={0.01}
                value={effectsLoop.returns.drums}
                onChange={(e) => onDrumFxReturnChange(parseFloat(e.target.value))}
                title={`FX Return: ${Math.round(effectsLoop.returns.drums * 100)}%`}
              />
            </div>
          </div>
          <div className="mixer-drum-indicators">
            {DRUM_INSTRUMENTS.map((inst) => (
              <div
                key={inst}
                className={`mixer-drum-dot ${drumState[inst].muted ? 'muted' : ''} ${drumState[inst].solo ? 'solo' : ''}`}
                title={`${inst} ${drumState[inst].muted ? '(muted)' : ''} ${drumState[inst].solo ? '(solo)' : ''}`}
              >
                {DRUM_LABELS[inst]}
              </div>
            ))}
          </div>
        </div>

        <div className="mixer-channel returns-channel">
          <div className="mixer-channel-label">Returns</div>
          <div className="mixer-knobs-row">
            <div className="mixer-mini-control">
              <label>Synth</label>
              <input
                type="range"
                className="mixer-pan-slider"
                min={0}
                max={1}
                step={0.01}
                value={effectsLoop.returns.synth}
                onChange={(e) => onEffectsReturnChange('synth', parseFloat(e.target.value))}
                title={`Synth Return: ${Math.round(effectsLoop.returns.synth * 100)}%`}
              />
              <span className="mixer-mini-value">{Math.round(effectsLoop.returns.synth * 100)}%</span>
            </div>
            <div className="mixer-mini-control">
              <label>Drums</label>
              <input
                type="range"
                className="mixer-pan-slider"
                min={0}
                max={1}
                step={0.01}
                value={effectsLoop.returns.drums}
                onChange={(e) => onEffectsReturnChange('drums', parseFloat(e.target.value))}
                title={`Drums Return: ${Math.round(effectsLoop.returns.drums * 100)}%`}
              />
              <span className="mixer-mini-value">{Math.round(effectsLoop.returns.drums * 100)}%</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
