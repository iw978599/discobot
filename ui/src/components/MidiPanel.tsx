import { MidiDeviceInfo, MidiMode } from '../hooks/useMidiInput';
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
                className={mode === value ? 'active' : ''}
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
