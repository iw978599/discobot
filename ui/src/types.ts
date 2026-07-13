/**
 * UI Type Definitions
 *
 * Re-exports all types from @discord-synth/engine for consistency.
 * The engine package is the single source of truth for all types.
 *
 * @deprecated Direct usage - import from '@discord-synth/engine' instead
 */

export type {
  // Audio synthesis types
  OscillatorType,
  SynthParameters,
  SequencerStep,
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
  DrumTrack,
  DrumState,
  FxSendLevels,
  EffectsLoopState,

  // Persistence types
  SavedPatternInfo,
  SavedPatternFull,

  // Sample types
  Sample,
  AudioExportOptions,
} from '@discord-synth/engine';
