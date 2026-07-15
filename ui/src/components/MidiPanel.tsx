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
  if (!supported) {
    return <div className="midi-panel unsupported">MIDI not supported in this browser</div>;
  }

  return (
    <div className="midi-panel">
      <div className="midi-row">
        <label>MIDI</label>
        <select value={selectedDeviceId} onChange={(e) => onDeviceChange(e.target.value)}>
          <option value={allDevicesId}>All devices</option>
          {devices.map((device) => (
            <option key={device.id} value={device.id}>{device.name}</option>
          ))}
        </select>
        <span className={`midi-status ${connected ? 'connected' : 'disconnected'}`}>
          {connected ? 'Connected' : 'Disconnected'}
        </span>
      </div>

      <div className="midi-row">
        <label>Mode</label>
        <div className="midi-mode-buttons">
          {(['live', 'record', 'step'] as MidiMode[]).map((value) => (
            <button
              key={value}
              className={mode === value ? 'active' : ''}
              onClick={() => onModeChange(value)}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      <div className="midi-row">
        <label>Channel</label>
        <select value={channel} onChange={(e) => onChannelChange(Number(e.target.value))}>
          {Array.from({ length: 16 }, (_, i) => i + 1).map((value) => (
            <option key={value} value={value}>Ch {value}</option>
          ))}
        </select>

        <label>Synth</label>
        <select
          value={targetSynthId ?? synthIds[0] ?? 1}
          onChange={(e) => onTargetSynthChange(Number(e.target.value))}
        >
          {synthIds.map((id) => (
            <option key={id} value={id}>Synth {id}</option>
          ))}
        </select>
      </div>

      {(lastMessage || error) && (
        <div className="midi-last-message">
          {error ? error : lastMessage}
        </div>
      )}
    </div>
  );
}
