import SynthControls from './SynthControls';
import { SynthParameters, SynthModelId, SynthModelParams } from '../types';
import './SynthUnit.css';

interface SynthUnitProps {
  presets: Array<{ id: string; name: string; builtIn?: boolean }>;
  synthId: number;
  synthParams: SynthParameters | null;
  muted: boolean;
  solo: boolean;
  selected: boolean;
  showRemoveButton: boolean;
  onToggleMute: () => void;
  onToggleSolo: () => void;
  onParameterChange: (params: Partial<SynthParameters>) => void;
  onSavePreset: (name: string) => void;
  onLoadPreset: (presetId: string) => void;
  onDeletePreset: (presetId: string) => void;
  synthModelId: SynthModelId;
  synthModelParams: SynthModelParams;
  onSynthModelChange: (modelId: SynthModelId) => void;
  onSynthModelParamsChange: (params: Partial<SynthModelParams>) => void;
  onSelect: () => void;
  onRemove?: () => void;
}

export default function SynthUnit({
  presets,
  synthId,
  synthParams,
  muted,
  solo,
  selected,
  showRemoveButton,
  onToggleMute,
  onToggleSolo,
  onParameterChange,
  onSavePreset,
  onLoadPreset,
  onDeletePreset,
  synthModelId,
  synthModelParams,
  onSynthModelChange,
  onSynthModelParamsChange,
  onSelect,
  onRemove,
}: SynthUnitProps) {
  return (
    <div className={`synth-unit ${selected ? 'selected' : ''}`} onClick={onSelect}>
      <div className="synth-unit-header">
        <h2>Synth {synthId}</h2>
        <div className="synth-unit-header-actions">
          <button className={`synth-mix-btn ${muted ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); onToggleMute(); }}>
            Mute
          </button>
          <button className={`synth-mix-btn ${solo ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); onToggleSolo(); }}>
            Solo
          </button>
          {showRemoveButton && onRemove && (
            <button className="remove-synth-btn" onClick={(e) => { e.stopPropagation(); onRemove(); }}>
              × Remove
            </button>
          )}
        </div>
      </div>

      <div className="synth-unit-controls">
        {synthParams && (
          <SynthControls
            parameters={synthParams}
            onParameterChange={onParameterChange}
            presets={presets}
            onSavePreset={onSavePreset}
            onLoadPreset={onLoadPreset}
            onDeletePreset={onDeletePreset}
            synthModelId={synthModelId}
            synthModelParams={synthModelParams}
            onModelChange={onSynthModelChange}
            onModelParamsChange={onSynthModelParamsChange}
          />
        )}
      </div>
    </div>
  );
}
