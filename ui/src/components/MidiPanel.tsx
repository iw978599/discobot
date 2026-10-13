import { useState } from 'react';
import { MidiDeviceInfo, MidiMode } from '../hooks/useMidiInput';
import type { MidiTie } from '../services/midiTies';
import { listTargets, targetLabel } from '../services/paramTargets';
import './MidiPanel.css';

interface MidiPanelProps {
  supported: boolean;
  connected: boolean;
  devices: MidiDeviceInfo[];
  allDevicesId: string;
  selectedDeviceId: string;
  onDeviceChange: (deviceId: string) => void;
  mode: MidiMode;
  onModeChange: (mode: MidiMode) => void;
  channel: number;
  onChannelChange: (channel: number) => void;
  // The channel pads are listened to on, for the drums; 0 is none.
  drumChannel: number;
  onDrumChannelChange: (channel: number) => void;
  // A controller's knobs tied to parameters, and the parameter waiting for a knob (Learn).
  ties: MidiTie[];
  learning: string | null;
  onLearn: (target: string | null) => void;
  onTieRemove: (target: string) => void;
  synthIds: number[];
  targetSynthId: number | null;
  onTargetSynthChange: (synthId: number) => void;
  lastMessage: string;
  error: string | null;
  outputs: MidiDeviceInfo[];
  selectedOutputId: string;
  onOutputChange: (deviceId: string) => void;
  sendNotes: boolean;
  onSendNotesChange: (send: boolean) => void;
  sendClock: boolean;
  onSendClockChange: (send: boolean) => void;
}

export default function MidiPanel({
  supported,
  connected,
  devices,
  allDevicesId,
  selectedDeviceId,
  onDeviceChange,
  mode,
  onModeChange,
  channel,
  onChannelChange,
  drumChannel,
  onDrumChannelChange,
  ties,
  learning,
  onLearn,
  onTieRemove,
  synthIds,
  targetSynthId,
  onTargetSynthChange,
  lastMessage,
  error,
  outputs,
  selectedOutputId,
  onOutputChange,
  sendNotes,
  onSendNotesChange,
  sendClock,
  onSendClockChange,
}: MidiPanelProps) {
  const [chosen, setChosen] = useState('lane:open:cutoff');
  if (!supported) return (
    <div className="midi-panel" role="status">
      MIDI input is not supported in this browser. Use Chrome or Edge over HTTPS, or import a MIDI file.
    </div>
  );

  return (
    <>
      {!connected && devices.length === 0 ? (
        <div className="midi-panel" role="status">
          {error || 'No MIDI input connected. Connect a controller and allow MIDI access; the keyboard remains available.'}
        </div>
      ) : (
        <div className="midi-panel">
          <span className={`midi-status-dot ${connected ? 'connected' : ''}`} />
          {!connected && <span role="status">Selected MIDI input is disconnected.</span>}
          <select aria-label="MIDI input device" value={selectedDeviceId} onChange={(e) => onDeviceChange(e.target.value)}>
            <option value={allDevicesId}>All</option>
            {devices.map((device) => (
              <option key={device.id} value={device.id}>{device.name}</option>
            ))}
          </select>
          <div className="midi-mode-buttons">
            {(['live', 'record', 'step'] as MidiMode[]).map((value) => (
              <button
                key={value}
                className={mode === value ? 'rack-btn on' : 'rack-btn'}
                aria-pressed={mode === value}
                onClick={() => onModeChange(value)}
              >
                {value}
              </button>
            ))}
          </div>
          <select aria-label="MIDI channel" value={channel} onChange={(e) => onChannelChange(Number(e.target.value))}>
            {Array.from({ length: 16 }, (_, i) => i + 1).map((value) => (
              <option key={value} value={value}>Ch{value}</option>
            ))}
          </select>
          <label className="midi-drum-channel" title="Notes on this channel play the drums: a pad controller's pads usually send on channel 10. In record mode a pad played while the song runs is written on the step being played. A keyboard on the other channel plays its lane at the same time">
            Pads
            <select aria-label="MIDI drum channel" value={drumChannel} onChange={(e) => onDrumChannelChange(Number(e.target.value))}>
              <option value={0}>Off</option>
              {Array.from({ length: 16 }, (_, i) => i + 1).map((value) => (
                <option key={value} value={value}>Ch{value}</option>
              ))}
            </select>
          </label>
          <select
            value={targetSynthId ?? synthIds[0] ?? 1}
            aria-label="MIDI target synth"
            onChange={(e) => onTargetSynthChange(Number(e.target.value))}
          >
            {synthIds.map((id) => (
              <option key={id} value={id}>Synth {id}</option>
            ))}
          </select>
          {(lastMessage || error) && (
            <span className="midi-last-message" title={error || lastMessage}>
              {error || lastMessage}
            </span>
          )}
        </div>
      )}

      {supported && (
        <>
          <h3>Controller knobs</h3>
          <div className="midi-panel midi-ties">
            <select aria-label="Parameter to tie to a knob" value={chosen} onChange={(e) => setChosen(e.target.value)} disabled={learning !== null}>
              {listTargets(synthIds).map(group => (
                <optgroup key={group.group} label={group.group}>
                  {group.targets.map(target => <option key={target.id} value={target.id}>{target.label}</option>)}
                </optgroup>
              ))}
            </select>
            {learning === null
              ? <button className="rack-btn" title="Then turn the knob on the controller that should move it" onClick={() => onLearn(chosen)}>Learn</button>
              : <button className="rack-btn on" aria-pressed="true" onClick={() => onLearn(null)}>Cancel</button>}
            <span className="midi-learn-status" role="status">{learning !== null ? `Turn a knob on the controller for ${targetLabel(learning)}.` : ''}</span>
          </div>
          {ties.length > 0 && (
            <ul className="midi-tie-list" aria-label="Knobs tied to parameters">
              {ties.map(tie => (
                <li key={tie.target}>
                  <span>Knob {tie.controller} on channel {tie.channel}</span>
                  <span className="midi-tie-arrow" aria-hidden="true">→</span>
                  <b>{targetLabel(tie.target)}</b>
                  <button className="rack-btn" aria-label={`Untie ${targetLabel(tie.target)}`} onClick={() => onTieRemove(tie.target)}>Untie</button>
                </li>
              ))}
            </ul>
          )}
          <p className="midi-note">
            Choose a parameter, press Learn and turn a knob on the controller: from then on that knob moves it, as the knob on screen would. "The open lane" follows whichever synth is open. The ties are kept in this browser for every project.
          </p>
        </>
      )}

      <h3>MIDI output</h3>
      {outputs.length === 0 ? (
        <div className="midi-panel" role="status">
          No MIDI output connected. Connect a synth, drum machine or interface to play it from the sequencer.
        </div>
      ) : (
        <>
          <div className="midi-panel">
            <span className={`midi-status-dot ${selectedOutputId ? 'connected' : ''}`} />
            <select aria-label="MIDI output device" value={selectedOutputId} onChange={(e) => onOutputChange(e.target.value)}>
              <option value="">Off</option>
              {outputs.map((device) => (
                <option key={device.id} value={device.id}>{device.name}</option>
              ))}
            </select>
            <label className="midi-check" title="Send each lane's notes: Synth 1 on channel 1, Synth 2 on 2, Synth 3 on 3, drums on channel 10">
              <input type="checkbox" aria-label="Send notes to MIDI output" checked={sendNotes} disabled={!selectedOutputId} onChange={(e) => onSendNotesChange(e.target.checked)} />
              Notes
            </label>
            <label className="midi-check" title="Send MIDI clock with start and stop, so the device's own sequencer or arpeggiator follows the tempo">
              <input type="checkbox" aria-label="Send clock to MIDI output" checked={sendClock} disabled={!selectedOutputId} onChange={(e) => onSendClockChange(e.target.checked)} />
              Clock
            </label>
          </div>
          <p className="midi-note">
            The sequencer plays the device while Discobot plays: Synth 1 to 3 on channels 1 to 3, drums on channel 10. Mute a lane here to hear only the hardware.
            This setting is not saved with the project.
          </p>
        </>
      )}
    </>
  );
}
