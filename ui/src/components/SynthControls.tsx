import { SynthParameters, OscillatorType } from '../types';
import './SynthControls.css';

interface SynthControlsProps {
  parameters: SynthParameters;
  onParameterChange: (params: Partial<SynthParameters>) => void;
}

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
    <div className="synth-controls">
      <h2>Synth Controls</h2>

      <section className="control-section">
        <h3>Oscillator</h3>
        <div className="control">
          <label>Type</label>
          <select
            value={parameters.oscillator.type}
            onChange={(e) =>
              updateOscillator({ type: e.target.value as OscillatorType })
            }
          >
            <option value="sine">Sine</option>
            <option value="square">Square</option>
            <option value="sawtooth">Sawtooth</option>
            <option value="triangle">Triangle</option>
          </select>
        </div>
        <div className="control">
          <label>Detune: {parameters.oscillator.detune}</label>
          <input
            type="range"
            min="-100"
            max="100"
            value={parameters.oscillator.detune}
            onChange={(e) => updateOscillator({ detune: Number(e.target.value) })}
          />
        </div>
      </section>

      <section className="control-section">
        <h3>Filter</h3>
        <div className="control">
          <label>Frequency: {parameters.filter.frequency}Hz</label>
          <input
            type="range"
            min="20"
            max="20000"
            value={parameters.filter.frequency}
            onChange={(e) => updateFilter({ frequency: Number(e.target.value) })}
          />
        </div>
        <div className="control">
          <label>Resonance: {parameters.filter.q.toFixed(2)}</label>
          <input
            type="range"
            min="0.1"
            max="20"
            step="0.1"
            value={parameters.filter.q}
            onChange={(e) => updateFilter({ q: Number(e.target.value) })}
          />
        </div>
      </section>

      <section className="control-section">
        <h3>Envelope</h3>
        <div className="control">
          <label>Attack: {parameters.envelope.attack.toFixed(3)}s</label>
          <input
            type="range"
            min="0.001"
            max="2"
            step="0.001"
            value={parameters.envelope.attack}
            onChange={(e) => updateEnvelope({ attack: Number(e.target.value) })}
          />
        </div>
        <div className="control">
          <label>Decay: {parameters.envelope.decay.toFixed(3)}s</label>
          <input
            type="range"
            min="0.001"
            max="2"
            step="0.001"
            value={parameters.envelope.decay}
            onChange={(e) => updateEnvelope({ decay: Number(e.target.value) })}
          />
        </div>
        <div className="control">
          <label>Sustain: {parameters.envelope.sustain.toFixed(2)}</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={parameters.envelope.sustain}
            onChange={(e) => updateEnvelope({ sustain: Number(e.target.value) })}
          />
        </div>
        <div className="control">
          <label>Release: {parameters.envelope.release.toFixed(3)}s</label>
          <input
            type="range"
            min="0.001"
            max="5"
            step="0.001"
            value={parameters.envelope.release}
            onChange={(e) => updateEnvelope({ release: Number(e.target.value) })}
          />
        </div>
      </section>

      <section className="control-section">
        <h3>Reverb</h3>
        <div className="control checkbox">
          <label>
            <input
              type="checkbox"
              checked={parameters.effects.reverb.enabled}
              onChange={(e) => updateReverb({ enabled: e.target.checked })}
            />
            Enabled
          </label>
        </div>
        <div className="control">
          <label>Wet: {parameters.effects.reverb.wet.toFixed(2)}</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={parameters.effects.reverb.wet}
            onChange={(e) => updateReverb({ wet: Number(e.target.value) })}
            disabled={!parameters.effects.reverb.enabled}
          />
        </div>
        <div className="control">
          <label>Decay: {parameters.effects.reverb.decay.toFixed(2)}s</label>
          <input
            type="range"
            min="0.1"
            max="10"
            step="0.1"
            value={parameters.effects.reverb.decay}
            onChange={(e) => updateReverb({ decay: Number(e.target.value) })}
            disabled={!parameters.effects.reverb.enabled}
          />
        </div>
      </section>

      <section className="control-section">
        <h3>Delay</h3>
        <div className="control checkbox">
          <label>
            <input
              type="checkbox"
              checked={parameters.effects.delay.enabled}
              onChange={(e) => updateDelay({ enabled: e.target.checked })}
            />
            Enabled
          </label>
        </div>
        <div className="control">
          <label>Wet: {parameters.effects.delay.wet.toFixed(2)}</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={parameters.effects.delay.wet}
            onChange={(e) => updateDelay({ wet: Number(e.target.value) })}
            disabled={!parameters.effects.delay.enabled}
          />
        </div>
        <div className="control">
          <label>Time: {parameters.effects.delay.time.toFixed(3)}s</label>
          <input
            type="range"
            min="0.001"
            max="2"
            step="0.001"
            value={parameters.effects.delay.time}
            onChange={(e) => updateDelay({ time: Number(e.target.value) })}
            disabled={!parameters.effects.delay.enabled}
          />
        </div>
        <div className="control">
          <label>Feedback: {parameters.effects.delay.feedback.toFixed(2)}</label>
          <input
            type="range"
            min="0"
            max="0.95"
            step="0.01"
            value={parameters.effects.delay.feedback}
            onChange={(e) => updateDelay({ feedback: Number(e.target.value) })}
            disabled={!parameters.effects.delay.enabled}
          />
        </div>
      </section>
    </div>
  );
}
