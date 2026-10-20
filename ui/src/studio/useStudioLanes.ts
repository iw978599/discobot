// Editing a synth lane: its steps and chords, the piano roll, Transpose and Randomize, its sound
// and model, automation and Auto, bars and Copy bar, mix, swing, name and presets (and the drums'
// bars, which go with the lanes'). Split out of useStudio.tsx.
import { useCallback } from 'react';
import { Pattern, SynthParameters, SynthModelId, SynthModelParams } from '../types';
import { localService } from '../services/localService';
import { exportPreset, importPreset } from '../services/presetImport';
import { BAR_CHOICES, barSteps, barTargets, barTicks, clampLengths, copyBar, drumBars, laneBars, resizeBars, stepsPerBar } from '../services/patternLength';
import { playhead } from '../services/playhead';
import { stepNotes, withStepLength, withStepNotes } from '../services/noteScheduling';
import { transposeSteps } from '../services/transpose';
import { randomLine, type RandomChoice } from '../services/randomize';
import { canAutomate, copyAutomationBar, resizeAutomationBars, resizeAutomationEachBar, sentAutomation, splitAutomated, stepSends, stepVoiceParams, stepsThrough, withAutomationValues, withoutAutomation } from '../services/automation';
import { downloadFile } from '../services/wavExport';
import { enterSynthModel, mapSynthModelToEngineParams, normalizeSynthModelId, normalizeSynthModelParams } from '../synthModels';
import { DEFAULT_PARAMS, cloneSynthParams, cloneSynthModelParams } from './studioState';
import type { SynthPreset, SynthState } from './studioState';
import type { StudioCore } from './useStudioCore';

// What this part of the studio uses from the rest of it.
export interface StudioLanesNeeds {
  recordedStep: (synthId: number, strength?: number) => { step: number; offset: number; } | null;
}

export function useStudioLanes(core: StudioCore, needs: StudioLanesNeeds) {
  const { synthsRef, setSynths, signatureOfRef, currentSceneIdRef, autoPassRef, transportRef, endAutoPassesRef, autoRecordingRef, synthAudio, globalTempoRef, drumStateRef, setSynthPresets, synthPresets, setStorageError, synthPresetsRef, setPresetImportReport } = core;
  const { recordedStep } = needs;
  const handleStepChange = useCallback(async (synthId: number, stepIndex: number) => {
    const synth = synthsRef.current.find(s => s.id === synthId);
    const pattern = synth?.pattern;
    if (!synth || !pattern) return;

    const sameSelectedStep = synth.selectedStep === stepIndex;
    const step = pattern.steps[stepIndex];

    if (sameSelectedStep && step?.note) {
      const updatedPattern = {
        ...pattern,
        steps: pattern.steps.map((s, i) => (
          i === stepIndex ? withStepNotes(s, []) : s
        )),
      };

      setSynths(prev => prev.map(s => (
        s.id === synthId ? { ...s, selectedStep: null } : s
      )));
      localService.writePattern(synthId, pattern.id, updatedPattern);
      return;
    }

    setSynths(prev => prev.map(s => {
      if (s.id !== synthId) return s;
      return { ...s, selectedStep: s.selectedStep === stepIndex ? null : stepIndex };
    }));
  }, []);
  // Moves the selection without the toggle and clear behaviour a click on a step has.
  const handleStepSelect = useCallback((synthId: number, stepIndex: number) => {
    setSynths(prev => prev.map(s => (s.id === synthId ? { ...s, selectedStep: stepIndex } : s)));
  }, []);
  const handleKeyboardModeChange = useCallback((synthId: number, mode: 'keyboard' | 'piano-roll') => {
    localService.setSynthPrefs(synthId, { keyboardMode: mode });
    setSynths(prev => prev.map(s => (
      s.id === synthId ? { ...s, keyboardMode: mode } : s
    )));
  }, []);
  // Adds a note to a step's chord or takes it out.
  // One note, or the several notes of a chord put in with one press: they are one edit and one undo.
  const handlePianoRollNoteAssign = useCallback(async (synthId: number, stepIndex: number, note: string | string[], on: boolean, offset = 0) => {
    const changed = Array.isArray(note) ? note : [note];
    const synth = synthsRef.current.find(s => s.id === synthId);
    if (!synth?.pattern) return;

    const updatedPattern = {
      ...synth.pattern,
      steps: synth.pattern.steps.map((step, idx) => {
        if (idx !== stepIndex) return step;
        const current = stepNotes(step);
        // A late start is chosen when the step gets its first note; later notes join it there.
        const base = on && current.length === 0 && offset > 0 ? { ...step, offset } : step;
        return withStepNotes(base, on ? [...current, ...changed] : current.filter(entry => !changed.includes(entry)));
      }),
    };

    setSynths(prev => prev.map(s => (
      s.id === synthId ? { ...s, selectedStep: stepIndex } : s
    )));
    // Two cells painted in one frame must both land: the patternUpdated event has moved
    // synthsRef on by the time this returns, so the next call sees this one. Its undo entry
    // holds this one too, so each cell is undone by itself.
    localService.writePattern(synthId, synth.pattern.id, updatedPattern);
  }, []);
  const handleClearPatternNotes = useCallback(async (synthId: number) => {
    const synth = synthsRef.current.find(s => s.id === synthId);
    if (!synth?.pattern) return;
    const updatedPattern = {
      ...synth.pattern,
      steps: synth.pattern.steps.map((step) => withStepNotes(step, [])),
      // Clearing a pattern clears its automation with its notes.
      automation: sentAutomation(undefined),
    };
    setSynths(prev => prev.map(s => (
      s.id === synthId ? { ...s, selectedStep: null } : s
    )));
    localService.writePattern(synthId, synth.pattern.id, updatedPattern);
  }, []);
  // Moves every note of a lane's pattern, in the open scene, by so many semitones. Nothing moves
  // if any note could not, and then nothing is written and no undo step is made.
  const handleTransposeLane = useCallback((synthId: number, semitones: number) => {
    const synth = synthsRef.current.find(s => s.id === synthId);
    if (!synth?.pattern) return;
    const steps = transposeSteps(synth.pattern.steps, semitones);
    if (!steps) return;
    localService.writePattern(synthId, synth.pattern.id, { ...synth.pattern, steps });
  }, []);
  // Replaces a lane's notes, in the open scene, with a new random line in a key and scale. The
  // line starts in the lowest octave the lane's piano roll shows.
  const handleRandomizeLane = useCallback((synthId: number, choice: RandomChoice) => {
    const synth = synthsRef.current.find(s => s.id === synthId);
    if (!synth?.pattern) return;
    localService.writePattern(synthId, synth.pattern.id, randomLine(synth.pattern, choice, 3 + synth.octaveShift, Math.random, signatureOfRef.current(currentSceneIdRef.current)));
  }, []);
  // One parameter of a lane's pass written from the step it was last written at up to `step`:
  // the steps passed since then keep the value the knob was left at, and `step` takes `value`.
  const writePass = (lane: SynthState, pass: NonNullable<ReturnType<typeof autoPassRef.current.get>>, automation: Pattern['automation'], key: string, step: number, value: number) => {
    const pattern = lane.pattern!, length = pattern.steps.length, last = pass.step[key], now = transportRef.current?.scheduledTicks ?? 0;
    const signature = signatureOfRef.current(currentSceneIdRef.current);
    const patternTicks = length * barTicks(signature) / stepsPerBar(length, pattern.bars, signature);
    const passed = last === undefined ? [] : stepsThrough(last, step, length, now - pass.tick[key] >= patternTicks).filter(entry => entry !== step);
    const filled = passed.length > 0 ? withAutomationValues(automation, key, passed, pass.held[key], length) : automation;
    Object.assign(pass, { held: { ...pass.held, [key]: value }, step: { ...pass.step, [key]: step }, tick: { ...pass.tick, [key]: now } });
    return withAutomationValues(filled, key, [step], value, length);
  };
  // Ends every pass being recorded. With `write`, each knob that was turned is first written at
  // where it was left, up to the step being heard.
  endAutoPassesRef.current = (write) => {
    for (const [synthId, pass] of autoPassRef.current) {
      const lane = synthsRef.current.find(entry => entry.id === synthId), at = write ? recordedStep(synthId, 0) : null;
      if (!lane?.pattern || lane.pattern.id !== pass.patternId || !at) continue;
      const automation = Object.keys(pass.held).reduce((next, key) => writePass(lane, pass, next, key, at.step, pass.held[key]), lane.pattern.automation);
      localService.writePattern(synthId, lane.pattern.id, { automation: sentAutomation(automation) });
    }
    autoPassRef.current.clear();
    localService.holdUndo('auto', false);
  };
  // With Auto on and the lane playing, the automatable parameters a knob moves are written into
  // the pattern at the step being heard, and the lane's own sound keeps the value it had. What is
  // left of the change (anything that cannot be automated) is answered, to be made as it always
  // was; null when nothing is left. The whole pass is one undo step: the entry is made before its
  // first write. Nothing is recorded while the transport counts in.
  const recordAutomation = useCallback((synth: SynthState | undefined, patch: Partial<SynthParameters>): Partial<SynthParameters> | null => {
    if (!autoRecordingRef.current || !synth?.isPlaying || !synth.pattern || !synth.synthParams) return patch;
    const at = recordedStep(synth.id, 0);
    if (!at) return patch;
    const pattern = synth.pattern;
    const { moved, rest } = splitAutomated(patch, synth.synthParams, key => canAutomate(pattern.automation, key));
    if (Object.keys(moved).length === 0) return rest as Partial<SynthParameters> | null;
    let pass = autoPassRef.current.get(synth.id);
    if (!pass || pass.patternId !== pattern.id) {
      // The pass is one undo step, held open until the passes end.
      localService.holdUndo('auto', true);
      pass = { patternId: pattern.id, held: {}, step: {}, tick: {} };
      autoPassRef.current.set(synth.id, pass);
    }
    const recording = pass;
    const automation = Object.entries(moved).reduce((next, [key, value]) => writePass(synth, recording, next, key, at.step, value), pattern.automation);
    localService.writePattern(synth.id, pattern.id, { automation: sentAutomation(automation) });
    // Heard at once, not when the pattern next comes round to this step.
    synthAudio.automate(synth.id, synth.synthParams, globalTempoRef.current, stepVoiceParams(synth.synthParams, automation, at.step, globalTempoRef.current, recording.held),
      undefined, stepSends(synth.synthParams, automation, at.step, recording.held));
    return rest as Partial<SynthParameters> | null;
  }, [recordedStep, synthAudio]);
  // A change to a lane's own sound.
  const changeSound = useCallback(async (synthId: number, params: Partial<SynthParameters>) => {
    localService.setSynthParams(synthId, params);
  }, []);
  // What a knob calls, on screen or on a controller: recorded as automation where Auto says so,
  // and otherwise a change to the sound. A preset is always the sound, and calls `changeSound`.
  const handleParameterChange = useCallback(async (synthId: number, params: Partial<SynthParameters>) => {
    const kept = recordAutomation(synthsRef.current.find((entry) => entry.id === synthId), params);
    if (kept) await changeSound(synthId, kept);
  }, [changeSound, recordAutomation]);
  // One parameter's automation drawn on some steps of a lane's pattern, or rubbed out of them
  // with null. Steps drawn one after another without a pause are one undo step, as a knob's turn is.
  const handleAutomationDraw = useCallback((synthId: number, key: string, steps: number[], value: number | null) => {
    const synth = synthsRef.current.find(entry => entry.id === synthId);
    if (!synth?.pattern) return;
    const automation = withAutomationValues(synth.pattern.automation, key, steps, value, synth.pattern.steps.length);
    if (automation === synth.pattern.automation) return;
    localService.undoAs(`automation:${synthId}:${key}`);
    localService.writePattern(synthId, synth.pattern.id, { automation: sentAutomation(automation) });
  }, []);
  const handleAutomationClear = useCallback((synthId: number, key: string) => {
    const synth = synthsRef.current.find(entry => entry.id === synthId);
    if (!synth?.pattern?.automation?.[key]) return;
    localService.writePattern(synthId, synth.pattern.id, { automation: sentAutomation(withoutAutomation(synth.pattern.automation, key)) });
  }, []);
  const handleSynthModelChange = useCallback(async (
    synthId: number,
    modelId: SynthModelId,
    modelParams?: Partial<SynthModelParams>
  ) => {
    const synth = synthsRef.current.find((entry) => entry.id === synthId);
    if (!synth) return;
    const normalizedModelId = normalizeSynthModelId(modelId);
    const normalizedModelParams = normalizeSynthModelParams({
      ...synth.synthModelParams,
      ...modelParams,
    });
    // A macro turned while Auto records (the knob on screen, or a controller's knob tied to it) is
    // written as the parameters it sets, which is what automation plays: a macro is several of them
    // and is not automated itself. As for any knob, the sound is left alone.
    if (normalizedModelId === synth.synthModelId && autoRecordingRef.current && synth.isPlaying && synth.pattern && recordedStep(synthId, 0)) {
      const kept = recordAutomation(synth, mapSynthModelToEngineParams(normalizedModelId, normalizedModelParams));
      if (kept && Object.keys(kept).length > 0) localService.setSynthParams(synthId, kept);
      return;
    }
    localService.setSynthModel(synthId, { modelId: normalizedModelId, modelParams: normalizedModelParams });
    // The macros' parameters went a turn later when these were requests, after React had rendered
    // the model for a click. A preset load pushes its second undo entry after this returns, and
    // that entry holds what was rendered then: the new model with the sound from before it.
    await Promise.resolve();
    // A lane moving to another model also has put back what the model it leaves may have set.
    const mapped = normalizedModelId !== synth.synthModelId
      ? enterSynthModel(normalizedModelId, normalizedModelParams, synth.synthModelId)
      : mapSynthModelToEngineParams(normalizedModelId, normalizedModelParams);
    if (Object.keys(mapped).length > 0) localService.setSynthParams(synthId, mapped);
  }, [recordAutomation, recordedStep]);
  // How many steps a bar of the lane has: the bar's sixteenths, or twice that for finer steps.
  const handleStepCountChange = useCallback(async (synthId: number, stepCount: number) => {
    const synth = synthsRef.current.find(s => s.id === synthId);
    if (!synth?.pattern) return;
    const signature = signatureOfRef.current(currentSceneIdRef.current);
    if (stepCount !== barSteps(signature) && stepCount !== barSteps(signature) * 2) return;
    const bars = laneBars(synth.pattern.steps.length, synth.pattern.bars, signature), perBar = synth.pattern.steps.length / bars;
    if (perBar === stepCount) return;

    // Each bar keeps its steps from the start of the bar; a finer grid adds empty steps after them.
    const nextSteps = clampLengths(Array.from({ length: stepCount * bars }, (_, i) => {
      const inBar = i % stepCount, source = inBar < perBar ? synth.pattern!.steps[Math.floor(i / stepCount) * perBar + inBar] : undefined;
      return source ? { ...source } : { active: false, velocity: 0.7 as const };
    }));
    const nextPattern = { ...synth.pattern, steps: nextSteps, automation: sentAutomation(resizeAutomationEachBar(synth.pattern.automation, perBar, stepCount)) };
    stepCount = nextSteps.length;

    playhead.set(synthId, playhead.get(synthId) % stepCount);
    setSynths(prev => prev.map(s => {
      if (s.id !== synthId) return s;
      const nextSelectedStep = s.selectedStep !== null && s.selectedStep >= stepCount ? null : s.selectedStep;
      return {
        ...s,
        selectedStep: nextSelectedStep,
      };
    }));
    localService.writePattern(synthId, synth.pattern.id, nextPattern);
  }, []);
  const handleStepVelocityChange = useCallback(async (synthId: number, stepIndex: number, velocity: number) => {
    const synth = synthsRef.current.find((entry) => entry.id === synthId);
    if (!synth?.pattern || !synth.pattern.steps[stepIndex]) return;
    const normalizedVelocity = Math.max(0, Math.min(1, velocity));
    localService.undoAs(`step-velocity:${synthId}:${stepIndex}`);
    const nextPattern = {
      ...synth.pattern,
      steps: synth.pattern.steps.map((step, index) => (
        index === stepIndex ? { ...step, velocity: normalizedVelocity } : step
      )),
    };
    localService.writePattern(synthId, synth.pattern.id, nextPattern);
  }, []);
  const handleStepSlideChange = useCallback(async (synthId: number, stepIndex: number, slide: boolean) => {
    const synth = synthsRef.current.find((entry) => entry.id === synthId);
    if (!synth?.pattern || !synth.pattern.steps[stepIndex]) return;
    const nextPattern = {
      ...synth.pattern,
      steps: synth.pattern.steps.map((step, index) => (index === stepIndex ? { ...step, slide } : step)),
    };
    localService.writePattern(synthId, synth.pattern.id, nextPattern);
  }, []);
  // How long a step's notes last: all of them, or with `note` given, that one note of its chord.
  const handleStepLengthChange = useCallback(async (synthId: number, stepIndex: number, length: number, note?: string) => {
    const synth = synthsRef.current.find((entry) => entry.id === synthId);
    const current = synth?.pattern?.steps[stepIndex];
    if (!synth?.pattern || !current) return;
    const bounded = Math.max(1, Math.min(synth.pattern.steps.length - stepIndex, Math.round(length)));
    const changed = withStepLength(current, bounded, note);
    if ((changed.length ?? 1) === (current.length ?? 1) && JSON.stringify(changed.lengths ?? null) === JSON.stringify(current.lengths ?? null)) return;
    const nextPattern = {
      ...synth.pattern,
      steps: synth.pattern.steps.map((step, index) => (index === stepIndex ? changed : step)),
    };
    localService.writePattern(synthId, synth.pattern.id, nextPattern);
  }, []);
  // Chance and repeats for one step.
  const handleStepDetailChange = useCallback(async (synthId: number, stepIndex: number, detail: { probability?: number; ratchet?: number; offset?: number; strum?: number }) => {
    const synth = synthsRef.current.find((entry) => entry.id === synthId);
    if (!synth?.pattern || !synth.pattern.steps[stepIndex]) return;
    const nextPattern = {
      ...synth.pattern,
      steps: synth.pattern.steps.map((step, index) => {
        if (index !== stepIndex) return step;
        const { probability, ratchet, offset, strum, ...rest } = { ...step, ...detail };
        return {
          ...rest,
          ...(strum !== undefined && strum > 0 ? { strum: Math.min(0.5, strum) } : {}),
          ...(offset !== undefined && offset > 0 ? { offset: Math.min(0.95, offset) } : {}),
          ...(probability !== undefined && probability < 1 ? { probability: Math.max(0, probability) } : {}),
          ...(ratchet !== undefined && ratchet > 1 ? { ratchet: Math.min(4, Math.round(ratchet)) } : {}),
        };
      }),
    };
    localService.writePattern(synthId, synth.pattern.id, nextPattern);
  }, []);
  // How many bars a lane's pattern lasts. A longer one starts as the old one repeated.
  const handleLaneBarsChange = useCallback(async (synthId: number, bars: number) => {
    const synth = synthsRef.current.find(s => s.id === synthId);
    if (!synth?.pattern || !BAR_CHOICES.some(choice => choice === bars)) return;
    const current = laneBars(synth.pattern.steps.length, synth.pattern.bars, signatureOfRef.current(currentSceneIdRef.current));
    if (current === bars) return;
    const perBar = synth.pattern.steps.length / current;
    const steps = clampLengths(resizeBars(synth.pattern.steps, perBar, bars, () => ({ active: false, velocity: 0.7 })));
    const { bars: _bars, ...rest } = synth.pattern;
    const nextPattern: Pattern = { ...rest, steps, ...(bars > 1 ? { bars } : {}), automation: sentAutomation(resizeAutomationBars(rest.automation, perBar, bars)) };
    playhead.set(synthId, playhead.get(synthId) % steps.length);
    setSynths(prev => prev.map(s => (s.id === synthId
      ? { ...s, selectedStep: s.selectedStep !== null && s.selectedStep >= steps.length ? null : s.selectedStep }
      : s)));
    // The store keeps the bar count it has when none is sent, so one bar is sent as 1.
    localService.writePattern(synthId, synth.pattern.id, { ...nextPattern, bars });
  }, []);
  const handleDrumBarsChange = useCallback(async (bars: number) => {
    localService.setDrumBars(bars);
  }, []);
  // Lays one bar of the drum grid over others, as one undo step.
  const handleCopyDrumBar = useCallback((from: number, to: number[]) => {
    if (!barTargets(drumBars(drumStateRef.current, signatureOfRef.current(currentSceneIdRef.current)), from, to)) return;
    localService.copyDrumBar(from, to);
  }, []);
  // Lays one bar of a lane's pattern over others, as one undo step. A note that was held past the
  // end of its bar is held as long in its new place, and stopped at the end of the pattern.
  const handleCopyLaneBar = useCallback((synthId: number, from: number, to: number[]) => {
    const synth = synthsRef.current.find(s => s.id === synthId);
    if (!synth?.pattern) return;
    const { steps } = synth.pattern;
    const signature = signatureOfRef.current(currentSceneIdRef.current);
    const targets = barTargets(laneBars(steps.length, synth.pattern.bars, signature), from, to);
    if (!targets) return;
    const perBar = stepsPerBar(steps.length, synth.pattern.bars, signature);
    localService.writePattern(synthId, synth.pattern.id, { ...synth.pattern, steps: clampLengths(copyBar(steps, perBar, from, targets)), automation: sentAutomation(copyAutomationBar(synth.pattern.automation, perBar, from, targets)) });
  }, []);
  const handleSynthMixChange = useCallback(async (synthId: number, mix: { muted?: boolean; solo?: boolean }) => {
    localService.setSynthMix(synthId, mix);
  }, []);
  const handleSynthSwingChange = useCallback((synthId: number, swing: boolean) => {
    localService.setSynthSwing(synthId, swing);
  }, []);
  // An empty name gives the lane back its number.
  const handleSynthRename = useCallback((synthId: number, name: string) => {
    localService.setSynthName(synthId, name);
  }, []);
  const handleSaveSynthPreset = useCallback((synthId: number, name: string) => {
    const synth = synthsRef.current.find((entry) => entry.id === synthId);
    if (!synth?.synthParams) return;
    const presetName = name.trim();
    if (!presetName) return;
    const userPreset: SynthPreset = {
      id: `user-${Date.now()}`,
      name: presetName,
      params: cloneSynthParams(synth.synthParams) || cloneSynthParams(DEFAULT_PARAMS)!,
      modelId: synth.synthModelId,
      modelParams: cloneSynthModelParams(synth.synthModelParams),
    };
    setSynthPresets((prev) => [...prev, userPreset]);
  }, []);
  const handleLoadSynthPreset = useCallback(async (synthId: number, presetId: string) => {
    const preset = synthPresets.find((entry) => entry.id === presetId);
    if (!preset) return;
    await handleSynthModelChange(synthId, preset.modelId, preset.modelParams);
    await changeSound(synthId, cloneSynthParams(preset.params) || DEFAULT_PARAMS);
    // After the model, which forgets the last preset's name when it changes.
    localService.setSynthPreset(synthId, preset.name);
  }, [synthPresets, changeSound, handleSynthModelChange]);
  // Reads a preset made in Discobot or in another synth, keeps it with the user's presets and
  // puts it on the lane. Other synths' presets are translated; the report says what was lost.
  const handleImportSynthPreset = useCallback(async (synthId: number, file: File) => {
    let contents: unknown;
    try {
      if (file.size > 2_000_000) throw new Error('too large');
      contents = JSON.parse(await file.text());
    } catch {
      setStorageError('That file could not be read as a preset. Preset files are JSON.');
      return;
    }
    const result = importPreset(contents, DEFAULT_PARAMS, file.name.replace(/(\.preset)?(\.websynth)?\.json$/i, ''));
    if (!result.ok) { setStorageError(result.error); return; }
    const { preset } = result;
    const taken = new Set(synthPresetsRef.current.map(entry => entry.name.toLowerCase()));
    let name = preset.name;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${preset.name.slice(0, 56)} ${n}`;
    const stored: SynthPreset = { id: `user-${Date.now()}`, name, params: preset.params, modelId: normalizeSynthModelId(undefined), modelParams: cloneSynthModelParams(undefined) };
    setSynthPresets(prev => [...prev, stored]);
    await handleSynthModelChange(synthId, stored.modelId, stored.modelParams);
    await changeSound(synthId, cloneSynthParams(stored.params) || DEFAULT_PARAMS);
    setPresetImportReport({ name, source: preset.source, notes: preset.notes });
  }, [changeSound, handleSynthModelChange]);
  // The lane's sound as a file another Discobot can import.
  const handleExportSynthPreset = useCallback((synthId: number, name: string) => {
    const synth = synthsRef.current.find(entry => entry.id === synthId);
    if (!synth?.synthParams) return;
    const title = name.trim() || `Synth ${synthId}`;
    downloadFile(JSON.stringify(exportPreset(title, synth.synthParams), null, 2), 'application/json', `${title.replace(/[^\w -]+/g, '').trim() || 'preset'}.discobot-preset.json`);
  }, []);
  const handleDeleteSynthPreset = useCallback((presetId: string) => {
    setSynthPresets((prev) => prev.filter((preset) => preset.id !== presetId || preset.builtIn));
  }, []);
  return { handleStepChange, handleStepSelect, handleKeyboardModeChange, handlePianoRollNoteAssign, handleClearPatternNotes, handleTransposeLane, handleRandomizeLane, handleParameterChange, handleAutomationDraw, handleAutomationClear, handleSynthModelChange, handleStepCountChange, handleStepVelocityChange, handleStepSlideChange, handleStepLengthChange, handleStepDetailChange, handleLaneBarsChange, handleDrumBarsChange, handleCopyDrumBar, handleCopyLaneBar, handleSynthMixChange, handleSynthSwingChange, handleSynthRename, handleSaveSynthPreset, handleLoadSynthPreset, handleImportSynthPreset, handleExportSynthPreset, handleDeleteSynthPreset };
}
