import { memo } from 'react';
import { DelaySync, EffectsLoopState, RateSync } from '../types';
import { RATE_SYNCS, RATE_SYNC_LABELS } from '../services/rateSync';
import { DELAY_SYNCS, DELAY_SYNC_LABELS } from '../services/delayTime';
import { CHORUS_DEFAULT, EFFECTS_DEFAULT, EQ_DEFAULT, EQ_RANGE_DB, MAX_PRE_DELAY } from '../services/effectSettings';
import Knob from './Knob';
import UnitHelp, { UNIT_HELP } from '../rack/UnitHelp';
import './EffectsPanel.css';

interface EffectsPanelProps {
  effectsLoop: EffectsLoopState;
  onChange: (next: Partial<EffectsLoopState>) => void;
  // Opens Help at a section. The same function on every render, or the panel would render for it.
  onHelp?: (section: string) => void;
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

function EffectsPanel({ effectsLoop, onChange, onHelp }: EffectsPanelProps) {
  const synced = Boolean(effectsLoop.delay.sync && effectsLoop.delay.sync !== 'off');
  const chorusSynced = Boolean(effectsLoop.chorus?.sync && effectsLoop.chorus.sync !== 'off');
  const phaserSynced = Boolean(effectsLoop.phaser.sync && effectsLoop.phaser.sync !== 'off');
  const chorus = effectsLoop.chorus ?? CHORUS_DEFAULT, eq = effectsLoop.eq ?? EQ_DEFAULT;
  const decibels = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(1)}dB`;
  return (
    <section className="effects-panel">
      <div className="effects-panel-header">
        <h3>Effects</h3>
        {onHelp && <UnitHelp about="the effects" section={UNIT_HELP.effects} onHelp={onHelp} />}
        <label className="effects-toggle">
          <input type="checkbox" aria-label="Effects loop enabled" checked={effectsLoop.enabled} onChange={(event) => onChange({ enabled: event.target.checked })} />
          <span>Enabled</span>
        </label>
        <div className="effects-returns">
          <Knob
            label="Synth Return"
            ariaLabel="Synth return"
            size="small"
            value={effectsLoop.returns.synth}
            defaultValue={EFFECTS_DEFAULT.returns.synth}
            displayValue={`${Math.round(effectsLoop.returns.synth * 100)}%`}
            parseInputValue={parsePercent}
            onChange={(value) => onChange({ returns: { ...effectsLoop.returns, synth: value } })}
            tooltip="How much of the shared effects the synths get back"
          />
          <Knob
            label="Drum Return"
            ariaLabel="Drum return"
            size="small"
            value={effectsLoop.returns.drums}
            defaultValue={EFFECTS_DEFAULT.returns.drums}
            displayValue={`${Math.round(effectsLoop.returns.drums * 100)}%`}
            parseInputValue={parsePercent}
            onChange={(value) => onChange({ returns: { ...effectsLoop.returns, drums: value } })}
            tooltip="How much of the shared effects the drums get back"
          />
        </div>
      </div>

      <div className="effects-grid">
        <div className="effects-block">
          <h4>Drive</h4>
          <div className="effects-row-head">
            <label className="effects-toggle">
              <input
                type="checkbox"
                checked={effectsLoop.drive.enabled}
                aria-label="Drive enabled"
                onChange={(e) => onChange({ drive: { ...effectsLoop.drive, enabled: e.target.checked } })}
              />
              <span>On</span>
            </label>
          </div>
          <div className="effects-knobs">
            <Knob
              label="Amount"
              value={effectsLoop.drive.amount}
              defaultValue={EFFECTS_DEFAULT.drive.amount}
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
              defaultValue={EFFECTS_DEFAULT.drive.tone}
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
                aria-label="Phaser enabled"
                onChange={(e) => onChange({ phaser: { ...effectsLoop.phaser, enabled: e.target.checked } })}
              />
              <span>On</span>
            </label>
            <label className="effects-toggle" title="Set the sweep to a note value so it stays in time when the tempo changes">
              <span>Sync</span>
              <select
                aria-label="Phaser sync"
                value={effectsLoop.phaser.sync ?? 'off'}
                onChange={(e) => onChange({ phaser: { ...effectsLoop.phaser, sync: e.target.value as RateSync } })}
              >
                {RATE_SYNCS.map(value => <option key={value} value={value}>{RATE_SYNC_LABELS[value]}</option>)}
              </select>
            </label>
          </div>
          <div className="effects-knobs">
            <Knob
              label="Rate"
              ariaLabel="Phaser rate"
              value={effectsLoop.phaser.rate}
              defaultValue={EFFECTS_DEFAULT.phaser.rate}
              min={0.05}
              max={8}
              step={0.01}
              displayValue={phaserSynced ? RATE_SYNC_LABELS[effectsLoop.phaser.sync!] : `${effectsLoop.phaser.rate.toFixed(2)}Hz`}
              tooltip={phaserSynced ? 'Following the tempo. Turn the knob to set a free rate instead' : 'How fast the phaser sweeps'}
              onChange={(value) => onChange({ phaser: { ...effectsLoop.phaser, rate: value, sync: 'off' } })}
              color="#3b82f6"
            />
            <Knob
              label="Depth"
              value={effectsLoop.phaser.depth}
              defaultValue={EFFECTS_DEFAULT.phaser.depth}
              min={0}
              max={1}
              displayValue={`${Math.round(effectsLoop.phaser.depth * 100)}%`}
              parseInputValue={parsePercent}
              onChange={(value) => onChange({ phaser: { ...effectsLoop.phaser, depth: value } })}
              color="#3b82f6"
            />
            <Knob
              label="Feedback"
              value={effectsLoop.phaser.feedback}
              defaultValue={EFFECTS_DEFAULT.phaser.feedback}
              min={0}
              max={0.95}
              displayValue={`${Math.round(effectsLoop.phaser.feedback * 100)}%`}
              parseInputValue={parsePercent}
              onChange={(value) => onChange({ phaser: { ...effectsLoop.phaser, feedback: value } })}
              color="#3b82f6"
            />
            <Knob
              label="Mix"
              value={effectsLoop.phaser.mix}
              defaultValue={EFFECTS_DEFAULT.phaser.mix}
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
                aria-label="Delay enabled"
                onChange={(e) => onChange({ delay: { ...effectsLoop.delay, enabled: e.target.checked } })}
              />
              <span>On</span>
            </label>
            <label className="effects-toggle" title="Set the echo to a note value so it stays in time when the tempo changes">
              <span>Sync</span>
              <select
                aria-label="Delay sync"
                value={effectsLoop.delay.sync ?? 'off'}
                onChange={(e) => onChange({ delay: { ...effectsLoop.delay, sync: e.target.value as DelaySync } })}
              >
                {DELAY_SYNCS.map(value => <option key={value} value={value}>{DELAY_SYNC_LABELS[value]}</option>)}
              </select>
            </label>
          </div>
          <div className="effects-knobs">
            <Knob
              label="Time"
              value={effectsLoop.delay.time}
              defaultValue={EFFECTS_DEFAULT.delay.time}
              min={0.01}
              max={1.5}
              step={0.001}
              displayValue={synced ? effectsLoop.delay.sync! : `${Math.round(effectsLoop.delay.time * 1000)}ms`}
              parseInputValue={parseMs}
              tooltip={synced ? 'Following the tempo. Turn the knob to set a free time instead' : undefined}
              onChange={(value) => onChange({ delay: { ...effectsLoop.delay, time: value, sync: 'off' } })}
              color="#ec4899"
            />
            <Knob
              label="Feedback"
              value={effectsLoop.delay.feedback}
              defaultValue={EFFECTS_DEFAULT.delay.feedback}
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
              defaultValue={EFFECTS_DEFAULT.delay.mix}
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
          <h4>Chorus</h4>
          <div className="effects-row-head">
            <label className="effects-toggle">
              <input
                type="checkbox"
                checked={chorus.enabled}
                aria-label="Chorus enabled"
                onChange={(e) => onChange({ chorus: { ...chorus, enabled: e.target.checked } })}
              />
              <span>On</span>
            </label>
            <label className="effects-toggle" title="Set the sweep to a note value so it stays in time when the tempo changes">
              <span>Sync</span>
              <select
                aria-label="Chorus sync"
                value={chorus.sync ?? 'off'}
                onChange={(e) => onChange({ chorus: { ...chorus, sync: e.target.value as RateSync } })}
              >
                {RATE_SYNCS.map(value => <option key={value} value={value}>{RATE_SYNC_LABELS[value]}</option>)}
              </select>
            </label>
          </div>
          <div className="effects-knobs">
            <Knob
              label="Rate"
              ariaLabel="Chorus rate"
              value={chorus.rate}
              defaultValue={CHORUS_DEFAULT.rate}
              min={0.05}
              max={8}
              step={0.01}
              displayValue={chorusSynced ? RATE_SYNC_LABELS[chorus.sync!] : `${chorus.rate.toFixed(2)}Hz`}
              onChange={(value) => onChange({ chorus: { ...chorus, rate: value, sync: 'off' } })}
              tooltip={chorusSynced ? 'Following the tempo. Turn the knob to set a free rate instead' : 'How fast the chorus sweeps'}
              color="#14b8a6"
            />
            <Knob
              label="Depth"
              ariaLabel="Chorus depth"
              value={chorus.depth}
              defaultValue={CHORUS_DEFAULT.depth}
              min={0}
              max={1}
              displayValue={`${Math.round(chorus.depth * 100)}%`}
              parseInputValue={parsePercent}
              onChange={(value) => onChange({ chorus: { ...chorus, depth: value } })}
              tooltip="How far the chorus sweeps: thicker, then wobblier"
              color="#14b8a6"
            />
            <Knob
              label="Mix"
              ariaLabel="Chorus mix"
              value={chorus.mix}
              defaultValue={CHORUS_DEFAULT.mix}
              min={0}
              max={1}
              displayValue={`${Math.round(chorus.mix * 100)}%`}
              parseInputValue={parsePercent}
              onChange={(value) => onChange({ chorus: { ...chorus, mix: value } })}
              color="#14b8a6"
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
                aria-label="Reverb enabled"
                onChange={(e) => onChange({ reverb: { ...effectsLoop.reverb, enabled: e.target.checked } })}
              />
              <span>On</span>
            </label>
          </div>
          <div className="effects-knobs">
            <Knob
              label="Decay"
              value={effectsLoop.reverb.decay}
              defaultValue={EFFECTS_DEFAULT.reverb.decay}
              min={0.2}
              max={8}
              step={0.01}
              displayValue={`${effectsLoop.reverb.decay.toFixed(2)}s`}
              onChange={(value) => onChange({ reverb: { ...effectsLoop.reverb, decay: value } })}
              color="#8b5cf6"
            />
            <Knob
              label="Pre"
              ariaLabel="Reverb pre-delay"
              value={effectsLoop.reverb.preDelay ?? 0}
              defaultValue={0}
              min={0}
              max={MAX_PRE_DELAY}
              step={0.001}
              displayValue={`${Math.round((effectsLoop.reverb.preDelay ?? 0) * 1000)}ms`}
              parseInputValue={parseMs}
              onChange={(value) => onChange({ reverb: { ...effectsLoop.reverb, preDelay: value } })}
              tooltip="A gap before the reverb starts, so the dry sound stays clear in front of it"
              color="#8b5cf6"
            />
            <Knob
              label="Damp"
              ariaLabel="Reverb damping"
              value={effectsLoop.reverb.damping ?? 0}
              defaultValue={0}
              min={0}
              max={1}
              displayValue={`${Math.round((effectsLoop.reverb.damping ?? 0) * 100)}%`}
              parseInputValue={parsePercent}
              onChange={(value) => onChange({ reverb: { ...effectsLoop.reverb, damping: value } })}
              tooltip="How quickly the reverb loses its highs: darker and warmer as it rises"
              color="#8b5cf6"
            />
            <Knob
              label="Mix"
              value={effectsLoop.reverb.mix}
              defaultValue={EFFECTS_DEFAULT.reverb.mix}
              min={0}
              max={1}
              displayValue={`${Math.round(effectsLoop.reverb.mix * 100)}%`}
              parseInputValue={parsePercent}
              onChange={(value) => onChange({ reverb: { ...effectsLoop.reverb, mix: value } })}
              color="#8b5cf6"
            />
          </div>
        </div>

        <div className="effects-block">
          <h4>Master EQ</h4>
          <div className="effects-row-head">
            <label className="effects-toggle" title="Shapes the whole mix, including the dry sound. Works whether or not the effects are enabled">
              <input
                type="checkbox"
                checked={eq.enabled}
                aria-label="Master EQ enabled"
                onChange={(e) => onChange({ eq: { ...eq, enabled: e.target.checked } })}
              />
              <span>On</span>
            </label>
          </div>
          <div className="effects-knobs">
            {([['low', 'Low', 'Bass, below about 120 Hz'], ['mid', 'Mid', 'The middle, around 1 kHz'], ['high', 'High', 'Treble, above about 6 kHz']] as const).map(([band, label, tooltip]) => (
              <Knob
                key={band}
                label={label}
                ariaLabel={`EQ ${band}`}
                value={eq[band]}
                defaultValue={EQ_DEFAULT[band]}
                min={-EQ_RANGE_DB}
                max={EQ_RANGE_DB}
                step={0.5}
                displayValue={decibels(eq[band])}
                parseInputValue={parseNumber}
                onChange={(value) => onChange({ eq: { ...eq, [band]: value } })}
                tooltip={tooltip}
                color="#eab308"
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// Its two props only change when the effects do, so it sits out every other edit.
export default memo(EffectsPanel);
