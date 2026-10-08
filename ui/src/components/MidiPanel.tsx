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
}: MidiPanelProps) {
  if (!supported) return (
    <div className="midi-panel" role="status">
      MIDI input is not supported in this browser. Use Chrome or Edge over HTTPS, or import a MIDI file.
    </div>
  );
  if (!connected && devices.length === 0) return (
    <div className="midi-panel" role="status">
      {error || 'No MIDI input connected. Connect a controller and allow MIDI access; the keyboard remains available.'}
    </div>
  );

  return (
    <div className="midi-panel">
      <span className={`midi-status-dot ${connected ? 'connected' : ''}`} />
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
  );
}
