/**
 * UI Type Definitions
 *
 * Re-exports all types from @discobot/engine for consistency.
 * The engine package is the single source of truth for all types.
 *
 * @deprecated Direct usage - import from '@discobot/engine' instead
 */

export type {
  // Audio synthesis types
  OscillatorType,
  SynthParameters,
  SynthModelId,
  SynthModelParams,
  SequencerStep,
  DelaySync,
  Pattern,

  // Drum types
  DrumInstrument,
  DrumKitId,
  DrumKitModelVariant,
  DrumKitMetadata,
  DrumKitDefinition,
  DrumKitSelectionState,
  DrumInstrumentDefaults,
  DrumSettings,
  CymbalType,
  DrumTrack,
  DrumState,
  DrumLanePattern,
  Scene,
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
