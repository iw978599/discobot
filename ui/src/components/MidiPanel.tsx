import { useEffect, useRef, useState } from 'react';
import { MidiDeviceInfo, MidiMode } from '../hooks/useMidiInput';
import type { MidiTie } from '../services/midiTies';
import { PAD_DRUMS, padNoteLabel, padsAreDefault, type PadMap } from '../services/midiDrums';
import { MIDI_DESTINATIONS, destinationFor, outputFlagsFor, type MidiDestination, type MidiDestinations, type MidiOutputSettings } from '../services/midiDevices';
import { inChannelOf, midiHeardAt, type MidiInChannels, type MidiPart } from '../services/midiChannels';
import { midiSentAt, outChannel, type MidiOutChannels, type MidiOutFlags } from '../services/midiOutput';
import { listTargets, targetLabel } from '../services/paramTargets';
import type { DrumRow } from '../types';
import { DRUM_ROW_NAMES } from '../services/drumKits';
import './MidiPanel.css';
import Toggle from './Toggle';

interface MidiPanelProps {
  supported: boolean;
  connected: boolean;
  devices: MidiDeviceInfo[];
  mode: MidiMode;
  onModeChange: (mode: MidiMode) => void;
  // The channel each part hears (one part a channel) and the channel each part sends on.
  inChannels: MidiInChannels;
  onInChannelChange: (part: MidiPart, channel: number) => void;
  outChannels: MidiOutChannels;
  onOutChannelsChange: (channels: MidiOutChannels) => void;
  // A controller's knobs tied to parameters, and the parameter waiting for a knob (Learn).
  ties: MidiTie[];
  learning: string | null;
  onLearn: (target: string | null) => void;
  onTieRemove: (target: string) => void;
  // The note each drum's pad sends, and the drum waiting for a pad to be hit (Learn).
  pads: PadMap;
  padLearning: DrumRow | null;
  onPadLearn: (drum: DrumRow | null) => void;
  // The rows that have a pad to learn: the eight, and the rows this project has added after them.
  drumRows?: readonly DrumRow[];
  onPadsReset: () => void;
  // Where each device's notes go, by the device's name.
  destinations: MidiDestinations;
  onDestinationChange: (device: string, place: MidiDestination) => void;
  synthIds: number[];
  lastMessage: string;
  error: string | null;
  outputs: MidiDeviceInfo[];
  outputSettings: MidiOutputSettings;
  onOutputFlagsChange: (name: string, patch: Partial<MidiOutFlags>) => void;
  followClock: boolean;
  onFollowClockChange: (follow: boolean) => void;
  // The tempo the followed clock gives, once it has been heard.
  clockTempo: number | null;
  onPanic: () => void;
}

const CHANNELS = Array.from({ length: 16 }, (_, i) => i + 1);
const LAMP_MS = 150;

// Lights a channel's lamp while messages come in on it, and an output's while it is sent them. The
// times are kept outside React; this switches the class on the lamps themselves a few times a
// second, so a busy controller never renders the panel. `lit` must not be in a lamp's className.
function useActivityLamps() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = setInterval(() => {
      const root = ref.current;
      if (!root) return;
      const now = performance.now();
      root.querySelectorAll<HTMLElement>('[data-heard]').forEach(lamp => {
        lamp.classList.toggle('lit', now - (midiHeardAt.get(Number(lamp.dataset.heard)) ?? -Infinity) < LAMP_MS);
      });
      root.querySelectorAll<HTMLElement>('[data-sent]').forEach(lamp => {
        lamp.classList.toggle('lit', now - (midiSentAt.get(lamp.dataset.sent!) ?? -Infinity) < LAMP_MS);
      });
    }, 50);
    return () => clearInterval(timer);
  }, []);
  return ref;
}

export default function MidiPanel({
  supported,
  connected,
  devices,
  mode,
  onModeChange,
  inChannels,
  onInChannelChange,
  outChannels,
  onOutChannelsChange,
  ties,
  learning,
  onLearn,
  onTieRemove,
  pads,
  padLearning,
  drumRows,
  onPadLearn,
  onPadsReset,
  destinations,
  onDestinationChange,
  synthIds,
  lastMessage,
  error,
  outputs,
  outputSettings,
  onOutputFlagsChange,
  followClock,
  onFollowClockChange,
  clockTempo,
  onPanic,
}: MidiPanelProps) {
  const [chosen, setChosen] = useState('lane:open:cutoff');
  const lamps = useActivityLamps();
  // A place is kept by name, so two devices with one name are one row.
  const deviceNames = [...new Set(devices.map(device => device.name))];
  const outputNames = [...new Map(outputs.map(output => [output.name, output.id])).entries()];
  const waiting = learning !== null || padLearning !== null;
  const parts: Array<{ part: MidiPart; name: string }> = [
    { part: 'open', name: 'Open lane' },
    ...synthIds.map(id => ({ part: id as MidiPart, name: `Synth ${id}` })),
    { part: 'drums', name: 'Drums' },
  ];
  if (!supported) return (
    <div className="midi-panel" role="status">
      MIDI input is not supported in this browser. Use Chrome or Edge over HTTPS, or import a MIDI file.
    </div>
  );

  return (
    <div className="midi-router" ref={lamps}>
      <div className="midi-panel">
        <span className={`midi-status-dot ${connected ? 'connected' : ''}`} />
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
        <Toggle className="midi-check" label="Follow MIDI clock" title="Start and stop with another device's MIDI clock, and play at its tempo. Its tempo is not saved: the project's own comes back when this is off" checked={followClock} onChange={(on) => onFollowClockChange(on)}>Follow clock{followClock && clockTempo !== null ? ` (${clockTempo} BPM)` : ''}</Toggle>
        <button className="rack-btn danger" aria-label="MIDI panic: all notes off" title="Stop every note: here, and on every MIDI output on all 16 channels" onClick={onPanic}>Panic</button>
        {lastMessage && (
          <span className="midi-last-message" title={lastMessage}>
            {lastMessage}
          </span>
        )}
      </div>

      <h3>Inputs</h3>
      {deviceNames.length === 0 ? (
        <div className="midi-panel" role="status">
          {error || 'No MIDI input connected. Connect a controller and allow MIDI access; the keyboard remains available.'}
        </div>
      ) : (
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
      )}

      <h3>Channels</h3>
      <div className="midi-panel midi-heard" role="group" aria-label="Channels heard">
        <span className="midi-heard-label">Heard</span>
        {CHANNELS.map(channel => <span key={channel} className="midi-channel-lamp" data-heard={channel} aria-hidden="true">{channel}</span>)}
      </div>
      <table className="midi-channel-table">
        <thead>
          <tr><th scope="col">Part</th><th scope="col">Plays from</th><th scope="col">Sends on</th></tr>
        </thead>
        <tbody>
          {parts.map(({ part, name }) => (
            <tr key={String(part)}>
              <th scope="row">{name}</th>
              <td>
                <select aria-label={`${name} MIDI input channel`} value={inChannelOf(inChannels, part)} onChange={(e) => onInChannelChange(part, Number(e.target.value))}>
                  <option value={0}>Off</option>
                  {CHANNELS.map(value => <option key={value} value={value}>Ch {value}</option>)}
                </select>
              </td>
              <td>
                {part === 'open' ? <span className="midi-none" aria-hidden="true">—</span> : (
                  <select aria-label={`${name} MIDI output channel`} value={outChannel(outChannels, part)}
                    onChange={(e) => onOutChannelsChange({ ...outChannels, [String(part)]: Number(e.target.value) })}>
                    {CHANNELS.map(value => <option key={value} value={value}>Ch {value}</option>)}
                  </select>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="midi-note">
        Switch your controller's channel to choose what it plays. Each channel plays one part: giving a part a channel takes it from the part that had it. A channel no part plays goes straight to every output with Thru on, so it can play hardware instead. "Sends on" is the channel each part goes out on. A device set to anything other than "By channel" above ignores this table. Kept in this browser.
      </p>

      <h3>Outputs</h3>
      {outputNames.length === 0 ? (
        <div className="midi-panel" role="status">
          No MIDI output connected. Connect a synth, drum machine or interface to play it from Discobot.
        </div>
      ) : (
        <ul className="midi-device-list midi-output-list" aria-label="MIDI outputs">
          {outputNames.map(([name, id]) => {
            const flags = outputFlagsFor(outputSettings, name);
            return (
              <li key={name}>
                <span className="midi-status-dot" data-sent={id} aria-hidden="true" />
                <b>{name}</b>
                <span className="midi-output-flags">
                  <Toggle label={`Send notes to ${name}`} title="The sequencer's notes: each part on its Sends on channel" checked={flags.notes} onChange={(on) => onOutputFlagsChange(name, { notes: on })}>Notes</Toggle>
                  <Toggle label={`Send clock to ${name}`} title="MIDI clock (24 a beat) with start and stop, so the device's own sequencer follows Discobot" checked={flags.clock} onChange={(on) => onOutputFlagsChange(name, { clock: on })}>Clock</Toggle>
                  <Toggle label={`Send played notes to ${name}`} title="Notes played by hand that Discobot plays (the keys on screen, the computer keyboard, a controller's keys and pads), each on its part's Sends on channel" checked={flags.played} onChange={(on) => onOutputFlagsChange(name, { played: on })}>Played</Toggle>
                  <Toggle label={`Pass controller through to ${name}`} title="A controller's notes, knobs and bend on channels no part plays, passed on unchanged" checked={flags.thru} onChange={(on) => onOutputFlagsChange(name, { thru: on })}>Thru</Toggle>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="midi-note">
        Turn on what each output is sent. Notes and Clock come from the sequencer while Discobot plays; Played is what you play into Discobot; Thru is what your controller plays on channels Discobot leaves alone. An output with the same name as the controller is never sent its own notes back. Kept in this browser.
      </p>

      <h3>Pads</h3>
      <ul className="midi-pad-list" aria-label="The note each drum's pad sends">
        {(drumRows ?? PAD_DRUMS).map(drum => (
          <li key={drum}>
            <b>{DRUM_ROW_NAMES[drum]}</b>
            <span className={(pads[drum] ?? null) === null ? 'midi-pad-note none' : 'midi-pad-note'}>{padNoteLabel(pads[drum] ?? null)}</span>
            {padLearning === drum
              ? <button className="rack-btn on" aria-pressed="true" aria-label={`Cancel learning a pad for ${DRUM_ROW_NAMES[drum]}`} onClick={() => onPadLearn(null)}>Cancel</button>
              : <button className="rack-btn" aria-label={`Learn a pad for ${DRUM_ROW_NAMES[drum]}`} title="Then hit the pad on the controller that should play it" disabled={waiting} onClick={() => onPadLearn(drum)}>Learn</button>}
          </li>
        ))}
      </ul>
      <div className="midi-panel midi-ties">
        <button className="rack-btn" title="Put every drum back on its General MIDI note" disabled={padsAreDefault(pads) && padLearning === null} onClick={onPadsReset}>Reset pads</button>
        <span className="midi-pad-status" role="status">{padLearning !== null ? `Hit a pad on the controller for ${DRUM_ROW_NAMES[padLearning]}.` : ''}</span>
      </div>
      <p className="midi-note">
        Press Learn beside a drum and hit a pad on the controller: from then on that pad plays that drum, and a drum that had the note is left with none. A drum still on its usual note also answers to the General MIDI notes near it. Reset pads puts every drum back on its General MIDI note. Pads are heard on the Drums channel above, or on every channel of a device sent to Drums. The notes are kept in this browser for every project, and a MIDI file is always exported with the General MIDI notes.
      </p>

      <h3>Controller knobs</h3>
      <div className="midi-panel midi-ties">
        <select aria-label="Parameter to tie to a knob" value={chosen} onChange={(e) => setChosen(e.target.value)} disabled={waiting}>
          {listTargets(synthIds, drumRows).map(group => (
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
        A controller's pitch bend bends the notes of the lane its keys play, up or down two semitones, and springs back when you let go, stop, or send the device elsewhere. Its mod wheel (CC 1) moves whatever a lane's route sends it to (choose Mod wheel as a route's source on the LFO tab), unless the wheel is tied to a knob here, in which case it moves that knob instead. Its sustain pedal (CC 64) keeps the notes you let go sounding until the pedal comes up, and with the arpeggiator on keeps it running. All three are played live: they are not saved, not undone, not recorded into the pattern and not in an export.
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
    </div>
  );
}
