/**
 * Synthesizer Controls with hardware-style knob layout
 * Organized like a classic analog synthesizer panel
 */

import { SynthParameters, OscillatorType } from '../types';
import Knob from './Knob';
import './SynthControls.css';

interface SynthControlsProps {
  parameters: SynthParameters;
  onParameterChange: (params: Partial<SynthParameters>) => void;
}

const TOOLTIPS = {
  gain: 'Master output volume',
  oscType: 'Waveform shape: Sine (smooth), Square (harsh), Sawtooth (bright), Triangle (soft)',
  detune: 'Fine pitch adjustment in cents (±100 = ±1 semitone)',
  filterFreq: 'Cutoff frequency - Higher = brighter, lower = darker',
  filterQ: 'Resonance - emphasis at cutoff frequency',
  attack: 'Time to reach full volume after key press',
  decay: 'Time to drop from peak to sustain level',
  sustain: 'Volume level held while key is pressed',
  release: 'Time to fade out after key release',
  reverbWet: 'Reverb mix level (0 = dry, 1 = wet)',
  reverbDecay: 'Reverb tail length in seconds',
  delayWet: 'Delay mix level (0 = dry, 1 = wet)',
  delayTime: 'Time between echo repeats',
  delayFeedback: 'Echo repeats (0 = single, 0.95 = many)',
};

export default function SynthControls({
  parameters,
  onParameterChange,
}: SynthControlsProps) {
  const updateOscillator = (updates: Partial<SynthParameters['oscillator']>) => {
    onParameterChange({
      oscillator: { ...parameters.oscillator, ...updates },
    });
  };

  const updateFilter = (updates: Partial<SynthParameters['filter']>) => {
    onParameterChange({
      filter: { ...parameters.filter, ...updates },
    });
  };

  const updateEnvelope = (updates: Partial<SynthParameters['envelope']>) => {
    onParameterChange({
      envelope: { ...parameters.envelope, ...updates },
    });
  };

  const updateReverb = (updates: Partial<SynthParameters['effects']['reverb']>) => {
    onParameterChange({
      effects: {
        ...parameters.effects,
        reverb: { ...parameters.effects.reverb, ...updates },
      },
    });
  };

  const updateDelay = (updates: Partial<SynthParameters['effects']['delay']>) => {
    onParameterChange({
      effects: {
        ...parameters.effects,
        delay: { ...parameters.effects.delay, ...updates },
      },
    });
  };

  return (
    <div className="synth-controls-panel">
      <div className="synth-header">
        <h2>SYNTHESIZER</h2>
      </div>

      <div className="synth-sections">
        {/* Row 1: Oscillator & Filter */}
        <div className="synth-row">
          <div className="synth-section">
            <h3>OSCILLATOR</h3>
            <div className="synth-knobs">
              <div className="synth-waveform-selector">
                <label>WAVE</label>
                <select
                  value={parameters.oscillator.type}
                  onChange={(e) =>
                    updateOscillator({ type: e.target.value as OscillatorType })
                  }
                  className="synth-select"
                >
                  <option value="sine">~</option>
                  <option value="square">⎍</option>
                  <option value="sawtooth">/|</option>
                  <option value="triangle">/\</option>
                </select>
              </div>
              <Knob
                label="Detune"
                value={parameters.oscillator.detune}
                min={-100}
                max={100}
                step={1}
                displayValue={`${parameters.oscillator.detune > 0 ? '+' : ''}${parameters.oscillator.detune}`}
                onChange={(v) => updateOscillator({ detune: v })}
                color="#3b82f6"
                tooltip={TOOLTIPS.detune}
              />
            </div>
          </div>

          <div className="synth-section">
            <h3>FILTER</h3>
            <div className="synth-knobs">
              <Knob
                label="Cutoff"
                value={parameters.filter.frequency}
                min={20}
                max={20000}
                step={10}
                displayValue={parameters.filter.frequency >= 1000
                  ? `${(parameters.filter.frequency / 1000).toFixed(1)}k`
                  : `${parameters.filter.frequency}`
                }
                onChange={(v) => updateFilter({ frequency: v })}
                size="large"
                color="#10b981"
                tooltip={TOOLTIPS.filterFreq}
              />
              <Knob
                label="Resonance"
                value={parameters.filter.q}
                min={0.1}
                max={20}
                step={0.1}
                onChange={(v) => updateFilter({ q: v })}
                size="large"
                color="#10b981"
                tooltip={TOOLTIPS.filterQ}
              />
            </div>
          </div>
        </div>

        {/* Row 2: Envelope */}
        <div className="synth-row">
          <div className="synth-section synth-section-wide">
            <h3>ENVELOPE (ADSR)</h3>
            <div className="synth-knobs">
              <Knob
                label="Attack"
                value={parameters.envelope.attack}
                min={0.001}
                max={2}
                step={0.001}
                displayValue={`${(parameters.envelope.attack * 1000).toFixed(0)}ms`}
                onChange={(v) => updateEnvelope({ attack: v })}
                color="#f59e0b"
                tooltip={TOOLTIPS.attack}
              />
              <Knob
                label="Decay"
                value={parameters.envelope.decay}
                min={0.001}
                max={2}
                step={0.001}
                displayValue={`${(parameters.envelope.decay * 1000).toFixed(0)}ms`}
                onChange={(v) => updateEnvelope({ decay: v })}
                color="#f59e0b"
                tooltip={TOOLTIPS.decay}
              />
              <Knob
                label="Sustain"
                value={parameters.envelope.sustain}
                min={0}
                max={1}
                step={0.01}
                displayValue={`${(parameters.envelope.sustain * 100).toFixed(0)}%`}
                onChange={(v) => updateEnvelope({ sustain: v })}
                color="#f59e0b"
                tooltip={TOOLTIPS.sustain}
              />
              <Knob
                label="Release"
                value={parameters.envelope.release}
                min={0.001}
                max={5}
                step={0.001}
                displayValue={`${(parameters.envelope.release * 1000).toFixed(0)}ms`}
                onChange={(v) => updateEnvelope({ release: v })}
                color="#f59e0b"
                tooltip={TOOLTIPS.release}
              />
            </div>
          </div>
        </div>

        {/* Row 3: Effects */}
        <div className="synth-row">
          <div className="synth-section">
            <div className="synth-section-header">
              <h3>REVERB</h3>
              <label className="synth-toggle">
                <input
                  type="checkbox"
                  checked={parameters.effects.reverb.enabled}
                  onChange={(e) => updateReverb({ enabled: e.target.checked })}
                />
                <span className="synth-toggle-slider" />
              </label>
            </div>
            <div className="synth-knobs">
              <Knob
                label="Mix"
                value={parameters.effects.reverb.wet}
                min={0}
                max={1}
                step={0.01}
                displayValue={`${(parameters.effects.reverb.wet * 100).toFixed(0)}%`}
                onChange={(v) => updateReverb({ wet: v })}
                disabled={!parameters.effects.reverb.enabled}
                color="#8b5cf6"
                tooltip={TOOLTIPS.reverbWet}
              />
              <Knob
                label="Decay"
                value={parameters.effects.reverb.decay}
                min={0.1}
                max={10}
                step={0.1}
                displayValue={`${parameters.effects.reverb.decay.toFixed(1)}s`}
                onChange={(v) => updateReverb({ decay: v })}
                disabled={!parameters.effects.reverb.enabled}
                color="#8b5cf6"
                tooltip={TOOLTIPS.reverbDecay}
              />
            </div>
          </div>

          <div className="synth-section">
            <div className="synth-section-header">
              <h3>DELAY</h3>
              <label className="synth-toggle">
                <input
                  type="checkbox"
                  checked={parameters.effects.delay.enabled}
                  onChange={(e) => updateDelay({ enabled: e.target.checked })}
                />
                <span className="synth-toggle-slider" />
              </label>
            </div>
            <div className="synth-knobs">
              <Knob
                label="Mix"
                value={parameters.effects.delay.wet}
                min={0}
                max={1}
                step={0.01}
                displayValue={`${(parameters.effects.delay.wet * 100).toFixed(0)}%`}
                onChange={(v) => updateDelay({ wet: v })}
                disabled={!parameters.effects.delay.enabled}
                color="#ec4899"
                tooltip={TOOLTIPS.delayWet}
              />
              <Knob
                label="Time"
                value={parameters.effects.delay.time}
                min={0.001}
                max={2}
                step={0.001}
                displayValue={`${(parameters.effects.delay.time * 1000).toFixed(0)}ms`}
                onChange={(v) => updateDelay({ time: v })}
                disabled={!parameters.effects.delay.enabled}
                color="#ec4899"
                tooltip={TOOLTIPS.delayTime}
              />
              <Knob
                label="Feedback"
                value={parameters.effects.delay.feedback}
                min={0}
                max={0.95}
                step={0.01}
                displayValue={`${(parameters.effects.delay.feedback * 100).toFixed(0)}%`}
                onChange={(v) => updateDelay({ feedback: v })}
                disabled={!parameters.effects.delay.enabled}
                color="#ec4899"
                tooltip={TOOLTIPS.delayFeedback}
              />
            </div>
          </div>
        </div>

        {/* Row 4: Master */}
        <div className="synth-row">
          <div className="synth-section synth-section-center">
            <h3>MASTER</h3>
            <div className="synth-knobs">
              <Knob
                label="Gain"
                value={parameters.gain}
                min={0}
                max={2}
                step={0.01}
                displayValue={`${(parameters.gain * 100).toFixed(0)}%`}
                onChange={(v) => onParameterChange({ gain: v })}
                size="large"
                color="#ef4444"
                tooltip={TOOLTIPS.gain}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
