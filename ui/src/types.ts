/**
 * UI Type Definitions
 *
 * Re-exports all types from @discobot/engine for consistency.
 * The engine package is the single source of truth for all types.
 *
 * @deprecated Direct usage - import from '@discobot/engine' instead
 */

export type {
  RateSync,
  DriveKind,
  AuxBus,
  AuxKind,
  // Audio synthesis types
  OscillatorType,
  SynthParameters,
  SynthModelId,
  SynthModelParams,
  SequencerStep,
  DelaySync,
  MuteFlags,
  SceneMutes,
  Pattern,
  Automation,

  // Drum types
  DrumInstrument,
  DrumRow,
  ExtraDrum,
  DrumKitId,
  DrumKitModelVariant,
  DrumKitMetadata,
  DrumKitDefinition,
  DrumKitSelectionState,
  DrumInstrumentDefaults,
  DrumSettings,
  CymbalType,
  PercType,
  DrumTrack,
  DrumState,
  DrumLanePattern,
  Scene,
  TimeSignature,
  Song,
  FxSendLevels,
  EffectsLoopState,

  // Persistence types
  SavedPatternInfo,
  SavedPatternFull,
  SavedSynthData,

  // Sample types
  Sample,
  AudioExportOptions,
} from '@discobot/engine';
