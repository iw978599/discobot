import { SynthParameters, OscillatorType } from '../types';
import './SynthControls.css';

interface SynthControlsProps {
  parameters: SynthParameters;
  onParameterChange: (params: Partial<SynthParameters>) => void;
}

const TOOLTIPS: Record<string, string> = {
  'osc-type': 'The waveform shape of the oscillator. Sine = smooth, Square = harsh, Sawtooth = bright, Triangle = soft.',
  'osc-detune': 'Fine pitch adjustment in cents (±100 = ±1 semitone). Positive = sharper, negative = flatter.',
  'filter-freq': 'Cutoff frequency of the low-pass filter. Higher = brighter, lower = muffled.',
  'filter-res': 'Filter resonance (emphasis at cutoff frequency). High values create a whistling/ringing effect.',
  'env-attack': 'Time for the note to reach full volume after pressing a key (0.001s–2s).',
  'env-decay': 'Time for the volume to drop from peak to the sustain level after the attack phase.',
  'env-sustain': 'Volume level held while a key is pressed (0 = silent, 1 = full volume).',
  'env-release': 'Time for the note to fade out after releasing a key (0.001s–5s).',
  'reverb-enabled': 'Enable or disable the reverb effect.',
  'reverb-wet': 'Mix level of the reverb effect (0 = dry, 1 = fully wet).',
  'reverb-decay': 'How long the reverb tail lasts in seconds (0.1s–10s).',
  'delay-enabled': 'Enable or disable the delay (echo) effect.',
  'delay-wet': 'Mix level of the delay effect (0 = dry, 1 = fully wet).',
  'delay-time': 'Time between each echo repeat (0.001s–2s).',
  'delay-feedback': 'How much of the delayed signal feeds back into the delay (0 = single echo, 0.95 = many repeats).',
};

function InfoTip({ id }: { id: string }) {
  const text = TOOLTIPS[id];
  if (!text) return null;
  return (
    <span className="info-tip-wrapper">
      <span className="info-tip-icon">&#9432;</span>
      <span className="info-tip-popup">{text}</span>
    </span>
  );
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
          <label>Type <InfoTip id="osc-type" /></label>
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
          <label>Detune: {parameters.oscillator.detune} <InfoTip id="osc-detune" /></label>
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
          <label>Frequency: {parameters.filter.frequency}Hz <InfoTip id="filter-freq" /></label>
          <input
            type="range"
            min="20"
            max="20000"
            value={parameters.filter.frequency}
            onChange={(e) => updateFilter({ frequency: Number(e.target.value) })}
          />
        </div>
        <div className="control">
          <label>Resonance: {parameters.filter.q.toFixed(2)} <InfoTip id="filter-res" /></label>
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
          <label>Attack: {parameters.envelope.attack.toFixed(3)}s <InfoTip id="env-attack" /></label>
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
          <label>Decay: {parameters.envelope.decay.toFixed(3)}s <InfoTip id="env-decay" /></label>
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
          <label>Sustain: {parameters.envelope.sustain.toFixed(2)} <InfoTip id="env-sustain" /></label>
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
          <label>Release: {parameters.envelope.release.toFixed(3)}s <InfoTip id="env-release" /></label>
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
            Enabled <InfoTip id="reverb-enabled" />
          </label>
        </div>
        <div className="control">
          <label>Wet: {parameters.effects.reverb.wet.toFixed(2)} <InfoTip id="reverb-wet" /></label>
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
          <label>Decay: {parameters.effects.reverb.decay.toFixed(2)}s <InfoTip id="reverb-decay" /></label>
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
            Enabled <InfoTip id="delay-enabled" />
          </label>
        </div>
        <div className="control">
          <label>Wet: {parameters.effects.delay.wet.toFixed(2)} <InfoTip id="delay-wet" /></label>
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
          <label>Time: {parameters.effects.delay.time.toFixed(3)}s <InfoTip id="delay-time" /></label>
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
          <label>Feedback: {parameters.effects.delay.feedback.toFixed(2)} <InfoTip id="delay-feedback" /></label>
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