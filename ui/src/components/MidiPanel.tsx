import { useState } from 'react';
import { MidiDeviceInfo, MidiMode } from '../hooks/useMidiInput';
import type { MidiTie } from '../services/midiTies';
import { PAD_DRUMS, padNoteLabel, padsAreDefault, type PadMap } from '../services/midiDrums';
import { MIDI_DESTINATIONS, destinationFor, type MidiDestination, type MidiDestinations } from '../services/midiDevices';
import { DRUM_NAMES, listTargets, targetLabel } from '../services/paramTargets';
import type { DrumInstrument } from '../types';
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
  // The note each drum's pad sends, and the drum waiting for a pad to be hit (Learn).
  pads: PadMap;
  padLearning: DrumInstrument | null;
  onPadLearn: (drum: DrumInstrument | null) => void;
  onPadsReset: () => void;
  // Where each device's notes go, by the device's name.
  destinations: MidiDestinations;
  onDestinationChange: (device: string, place: MidiDestination) => void;
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
  pads,
  padLearning,
  onPadLearn,
  onPadsReset,
  destinations,
  onDestinationChange,
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
  // A place is kept by name, so two devices with one name are one row.
  const deviceNames = [...new Set(devices.map(device => device.name))];
  const showDevices = deviceNames.length > 1 || deviceNames.some(name => destinationFor(destinations, name) !== 'default');
  const waiting = learning !== null || padLearning !== null;
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

      {supported && showDevices && (
        <>
          <h3>Devices</h3>
          <ul className="midi-device-list" aria-label="Where each MIDI device is sent">
            {deviceNames.map(name => (
              <li key={name}>
                <b>{name}</b>
                <span className="midi-tie-arrow" aria-hidden="true">→</span>
                <select aria-label={`Where ${name} is sent`} value={destinationFor(destinations, name)} onChange={(e) => onDestinationChange(name, e.target.value as MidiDestination)}>
                  {MIDI_DESTINATIONS.map(place => <option key={place.id} value={place.id}>{place.label}</option>)}
                </select>
              </li>
            ))}
          </ul>
          <p className="midi-note">
            Each device can be sent somewhere of its own. "As set above" is the channel, the Pads channel and the lane chosen above. A lane takes every note from the device, whatever its channel; "The open lane" follows whichever synth is open; Drums makes every note a pad; Off has the device ignored, knobs and all. A lane this project does not have plays nothing. Kept in this browser by the device's name.
          </p>
        </>
      )}

      {supported && (
        <>
          <h3>Pads</h3>
          <ul className="midi-pad-list" aria-label="The note each drum's pad sends">
            {PAD_DRUMS.map(drum => (
              <li key={drum}>
                <b>{DRUM_NAMES[drum]}</b>
                <span className={pads[drum] === null ? 'midi-pad-note none' : 'midi-pad-note'}>{padNoteLabel(pads[drum])}</span>
                {padLearning === drum
                  ? <button className="rack-btn on" aria-pressed="true" aria-label={`Cancel learning a pad for ${DRUM_NAMES[drum]}`} onClick={() => onPadLearn(null)}>Cancel</button>
                  : <button className="rack-btn" aria-label={`Learn a pad for ${DRUM_NAMES[drum]}`} title="Then hit the pad on the controller that should play it" disabled={waiting} onClick={() => onPadLearn(drum)}>Learn</button>}
              </li>
            ))}
          </ul>
          <div className="midi-panel midi-ties">
            <button className="rack-btn" title="Put every drum back on its General MIDI note" disabled={padsAreDefault(pads) && padLearning === null} onClick={onPadsReset}>Reset pads</button>
            <span className="midi-pad-status" role="status">{padLearning !== null ? `Hit a pad on the controller for ${DRUM_NAMES[padLearning]}.` : ''}</span>
          </div>
          <p className="midi-note">
            Press Learn beside a drum and hit a pad on the controller: from then on that pad plays that drum, and a drum that had the note is left with none. A drum still on its usual note also answers to the General MIDI notes near it. Reset pads puts every drum back on its General MIDI note. Pads are heard on the Pads channel above, or on every channel of a device sent to Drums. The notes are kept in this browser for every project, and a MIDI file is always exported with the General MIDI notes.
          </p>

          <h3>Controller knobs</h3>
          <div className="midi-panel midi-ties">
            <select aria-label="Parameter to tie to a knob" value={chosen} onChange={(e) => setChosen(e.target.value)} disabled={waiting}>
              {listTargets(synthIds).map(group => (
                <optgroup key={group.group} label={group.group}>
                  {group.targets.map(target => <option key={target.id} value={target.id}>{target.label}</option>)}
                </optgroup>
              ))}
            </select>
            {learning === null
              ? <button className="rack-btn" title="Then turn the knob on the controller that should move it" disabled={waiting} onClick={() => onLearn(chosen)}>Learn</button>
              : <button className="rack-btn on" aria-pressed="true" onClick={() => onLearn(null)}>Cancel</button>}
            <span className="midi-learn-status" role="status">{learning !== null ? `Turn a knob on the controller for ${targetLabel(learning)}.` : ''}</span>
          </div>
          <p className="midi-note">
            A controller's pitch bend bends the notes of the lane its keys play, up or down two semitones, and springs back when you let go, stop, or send the device elsewhere. Its mod wheel (CC 1) moves whatever a lane's route sends it to (choose Mod wheel as a route's source on the LFO tab), unless the wheel is tied to a knob here, in which case it moves that knob instead. Both are played live: they are not saved, not undone, not recorded into the pattern and not in an export.
          </p>
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
            The sequencer plays the device while Discobot plays: each synth lane on the channel of its number (Synth 1 on channel 1, up to Synth 5 on 5), drums on channel 10. Mute a lane here to hear only the hardware.
            This setting is not saved with the project.
          </p>
        </>
      )}
    </>
  );
}
