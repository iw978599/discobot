import { EffectsLoopState } from '../types';
import Knob from './Knob';
import './EffectsPanel.css';

interface EffectsPanelProps {
  effectsLoop: EffectsLoopState;
  onChange: (next: Partial<EffectsLoopState>) => void;
}

const parseNumber = (input: string): number | null => {
  const n = Number.parseFloat(input.replace(/[^0-9+-.]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const parsePercent = (input: string): number | null => {
  const n = parseNumber(input);
  if (n === null) return null;
  return n / 100;
};

const parseMs = (input: string): number | null => {
  const n = parseNumber(input);
  return n === null ? null : n / 1000;
};

export default function EffectsPanel({ effectsLoop, onChange }: EffectsPanelProps) {
  return (
    <section className="effects-panel">
      <div className="effects-panel-header">
        <h3>Effects Loop</h3>
      </div>

      <div className="effects-grid">
        <div className="effects-block">
          <h4>Drive</h4>
          <div className="effects-row-head">
            <label className="effects-toggle">
              <input
                type="checkbox"
                checked={effectsLoop.drive.enabled}
                onChange={(e) => onChange({ drive: { ...effectsLoop.drive, enabled: e.target.checked } })}
              />
              <span>On</span>
            </label>
          </div>
          <div className="effects-knobs">
            <Knob
              label="Amount"
              value={effectsLoop.drive.amount}
              min={0}
              max={1}
              displayValue={`${Math.round(effectsLoop.drive.amount * 100)}%`}
              parseInputValue={parsePercent}
              onChange={(value) => onChange({ drive: { ...effectsLoop.drive, amount: value } })}
              color="#ef4444"
            />
            <Knob
              label="Tone"
              value={effectsLoop.drive.tone}
              min={0}
              max={1}
              displayValue={`${Math.round(effectsLoop.drive.tone * 100)}%`}
              parseInputValue={parsePercent}
              onChange={(value) => onChange({ drive: { ...effectsLoop.drive, tone: value } })}
              color="#ef4444"
            />
          </div>
        </div>

        <div className="effects-block">
          <h4>Phaser</h4>
          <div className="effects-row-head">
            <label className="effects-toggle">
              <input
                type="checkbox"
                checked={effectsLoop.phaser.enabled}
                onChange={(e) => onChange({ phaser: { ...effectsLoop.phaser, enabled: e.target.checked } })}
              />
              <span>On</span>
            </label>
          </div>
          <div className="effects-knobs">
            <Knob
              label="Rate"
              value={effectsLoop.phaser.rate}
              min={0.05}
              max={8}
              step={0.01}
              displayValue={`${effectsLoop.phaser.rate.toFixed(2)}Hz`}
              onChange={(value) => onChange({ phaser: { ...effectsLoop.phaser, rate: value } })}
              color="#3b82f6"
            />
            <Knob
              label="Depth"
              value={effectsLoop.phaser.depth}
              min={0}
              max={1}
              displayValue={`${Math.round(effectsLoop.phaser.depth * 100)}%`}
              parseInputValue={parsePercent}
              onChange={(value) => onChange({ phaser: { ...effectsLoop.phaser, depth: value } })}
              color="#3b82f6"
            />
            <Knob
              label="Mix"
              value={effectsLoop.phaser.mix}
              min={0}
              max={1}
              displayValue={`${Math.round(effectsLoop.phaser.mix * 100)}%`}
              parseInputValue={parsePercent}
              onChange={(value) => onChange({ phaser: { ...effectsLoop.phaser, mix: value } })}
              color="#3b82f6"
            />
          </div>
        </div>

        <div className="effects-block">
          <h4>Delay</h4>
          <div className="effects-row-head">
            <label className="effects-toggle">
              <input
                type="checkbox"
                checked={effectsLoop.delay.enabled}
                onChange={(e) => onChange({ delay: { ...effectsLoop.delay, enabled: e.target.checked } })}
              />
              <span>On</span>
            </label>
          </div>
          <div className="effects-knobs">
            <Knob
              label="Time"
              value={effectsLoop.delay.time}
              min={0.01}
              max={1.5}
              step={0.001}
              displayValue={`${Math.round(effectsLoop.delay.time * 1000)}ms`}
              parseInputValue={parseMs}
              onChange={(value) => onChange({ delay: { ...effectsLoop.delay, time: value } })}
              color="#ec4899"
            />
            <Knob
              label="Feedback"
              value={effectsLoop.delay.feedback}
              min={0}
              max={0.95}
              displayValue={`${Math.round(effectsLoop.delay.feedback * 100)}%`}
              parseInputValue={parsePercent}
              onChange={(value) => onChange({ delay: { ...effectsLoop.delay, feedback: value } })}
              color="#ec4899"
            />
            <Knob
              label="Mix"
              value={effectsLoop.delay.mix}
              min={0}
              max={1}
              displayValue={`${Math.round(effectsLoop.delay.mix * 100)}%`}
              parseInputValue={parsePercent}
              onChange={(value) => onChange({ delay: { ...effectsLoop.delay, mix: value } })}
              color="#ec4899"
            />
          </div>
        </div>

        <div className="effects-block">
          <h4>Reverb</h4>
          <div className="effects-row-head">
            <label className="effects-toggle">
              <input
                type="checkbox"
                checked={effectsLoop.reverb.enabled}
                onChange={(e) => onChange({ reverb: { ...effectsLoop.reverb, enabled: e.target.checked } })}
              />
              <span>On</span>
            </label>
          </div>
          <div className="effects-knobs">
            <Knob
              label="Decay"
              value={effectsLoop.reverb.decay}
              min={0.2}
              max={8}
              step={0.01}
              displayValue={`${effectsLoop.reverb.decay.toFixed(2)}s`}
              onChange={(value) => onChange({ reverb: { ...effectsLoop.reverb, decay: value } })}
              color="#8b5cf6"
            />
            <Knob
              label="Mix"
              value={effectsLoop.reverb.mix}
              min={0}
              max={1}
              displayValue={`${Math.round(effectsLoop.reverb.mix * 100)}%`}
              parseInputValue={parsePercent}
              onChange={(value) => onChange({ reverb: { ...effectsLoop.reverb, mix: value } })}
              color="#8b5cf6"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
