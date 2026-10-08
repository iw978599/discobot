import type { DrumState, EffectsLoopState, FxSendLevels, Pattern, SavedPatternFull, SynthParameters, SynthModelId, SynthModelParams } from '../types';
import { DRUM_INSTRUMENTS, DRUM_KITS } from './drumKits';
import { normalizeSynthModelId } from '../synthModels';
import { record, number, matchesShape, sanitizePattern, sanitizeSynthParams, sanitizeDrums, sanitizeEffects, sanitizeSends, sanitizeSaved, sanitizeModelParams, sanitizeKit } from './projectSanitization';

type Message = { type: string; data: any };
type Listener = (message: Message) => void;
type Defaults = {
  synthParams: SynthParameters; drumState: DrumState; effectsLoop: EffectsLoopState;
  drumFx: { sends: FxSendLevels; returnLevel: number };
};
type LocalSynth = {
  synthId: number; pattern: Pattern; patterns: Pattern[]; synthParams: SynthParameters;
  synthModelId: SynthModelId; synthModelParams: SynthModelParams; muted: boolean; solo: boolean; isPlaying: boolean;
  octaveShift?: number; keyboardMode?: 'keyboard' | 'piano-roll';
};
type State = Defaults & {
  version: 1; synths: LocalSynth[]; tempo: number; selectedDrumKitId: string;
  drumMasterVolume: number; drumSwing: number; savedPatterns: SavedPatternFull[];
};
const STORAGE_KEY = 'discobot_browser_project_v1';
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

function merge<T>(base: T, patch: Partial<T>): T {
  const result: any = clone(base);
  for (const [key, value] of Object.entries(patch)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    result[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? merge(result[key] || {}, value) : value;
  }
  return result;
}

export class LocalProjectService {
  private state: State | null = null;
  private defaults: Defaults | null = null;
  private listeners = new Set<Listener>();
  private storageIssue: string | null = null;
  private restored = false;

  initialize(defaults: Defaults) {
    if (this.state) return;
    this.defaults = clone(defaults);
    this.state = {
      ...clone(defaults), version: 1, synths: [], tempo: 120,
      selectedDrumKitId: 'clean-analog', drumMasterVolume: 1, drumSwing: 0, savedPatterns: [],
    };
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.version !== 1 || !Array.isArray(parsed.synths) || !Array.isArray(parsed.savedPatterns)) {
          throw new Error('Invalid project data');
        }
        const tempo = number(parsed.tempo, 120, 20, 400);
        const seen = new Set<number>();
        let damaged = !matchesShape(parsed.drumState, defaults.drumState) || !matchesShape(parsed.effectsLoop, defaults.effectsLoop);
        const synths: LocalSynth[] = parsed.synths.flatMap((value: unknown) => {
          const input = record(value), pattern = sanitizePattern(input.pattern, tempo);
          if (!Number.isInteger(input.synthId) || input.synthId < 1 || input.synthId > 3 || seen.has(input.synthId) || !pattern) {
            damaged = true;
            return [];
          }
          seen.add(input.synthId);
          if (!matchesShape(input.synthParams, defaults.synthParams)
            || !input.pattern.steps.every((step: unknown) => matchesShape(step, { active: false, velocity: .7 }))) damaged = true;
          const patterns: Pattern[] = Array.isArray(input.patterns)
            ? input.patterns.map((value: unknown) => sanitizePattern(value, tempo)).filter((value: Pattern | null): value is Pattern => value !== null)
            : [];
          const unique = new Map(patterns.map(p => [p.id, p]));
          unique.set(pattern.id, pattern);
          return [{
            synthId: input.synthId, pattern, patterns: [...unique.values()],
            synthParams: sanitizeSynthParams(input.synthParams, defaults.synthParams),
            synthModelId: normalizeSynthModelId(input.synthModelId), synthModelParams: sanitizeModelParams(input.synthModelParams),
            isPlaying: false, muted: input.muted === true, solo: input.solo === true,
            octaveShift: Math.round(number(input.octaveShift, 0, -2, 2)), keyboardMode: input.keyboardMode === 'piano-roll' ? 'piano-roll' : 'keyboard',
          }];
        });
        const savedPatterns = parsed.savedPatterns.map((value: unknown) => sanitizeSaved(value, defaults))
          .filter((value: SavedPatternFull | null): value is SavedPatternFull => value !== null);
        if (savedPatterns.length !== parsed.savedPatterns.length) damaged = true;
        this.state = {
          ...clone(defaults), version: 1, synths, savedPatterns, tempo,
          drumState: sanitizeDrums(parsed.drumState, defaults.drumState),
          effectsLoop: sanitizeEffects(parsed.effectsLoop, defaults.effectsLoop),
          drumFx: {
            sends: sanitizeSends(record(parsed.drumFx).sends, defaults.drumFx.sends),
            returnLevel: number(record(parsed.drumFx).returnLevel, defaults.drumFx.returnLevel, 0, 1),
          },
          selectedDrumKitId: sanitizeKit(parsed.selectedDrumKitId),
          drumMasterVolume: number(parsed.drumMasterVolume, 1, 0, 1), drumSwing: number(parsed.drumSwing, 0, 0, .75),
        };
        if (damaged) this.storageIssue = 'Some damaged browser project values were repaired. Please save a new copy of your arrangement.';
        this.restored = synths.length > 0;
      }
    } catch {
      this.storageIssue = 'Browser storage is unavailable or damaged. Edits work, but may not survive reload.';
    }
    if (!this.state.synths.some(s => s.synthId === 1)) this.state.synths.unshift(this.createSynth(1));
  }

  private createSynth(synthId: number): LocalSynth {
    const pattern: Pattern = {
      id: crypto.randomUUID(), name: `Synth ${synthId}`, tempo: this.state!.tempo,
      steps: Array.from({ length: 16 }, () => ({ active: false, velocity: .7 })),
    };
    return {
      synthId, pattern, patterns: [pattern], synthParams: clone(this.defaults!.synthParams),
      synthModelId: 'generic', synthModelParams: { macro1: .5, macro2: .5, macro3: .5, macro4: .5 },
      muted: false, solo: false, isPlaying: false,
    };
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener({ type: 'init', data: this.snapshot() });
    if (this.storageIssue) listener({ type: 'storageError', data: { message: this.storageIssue } });
    return () => { this.listeners.delete(listener); };
  }

  snapshot() {
    return clone({ ...this.state, drumKits: DRUM_KITS, restored: this.restored });
  }

  private emit(type: string, data: any) {
    for (const listener of this.listeners) listener({ type, data: clone(data) });
  }

  private persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      return true;
    } catch {
      this.storageIssue = 'Unable to save to browser storage. Free space or allow storage for this site.';
      this.emit('storageError', { message: this.storageIssue });
      return false;
    }
  }

  private notifySaved() {
    this.emit('savedPatternsChanged', {
      patterns: this.state!.savedPatterns.map(({ id, name, updatedAt }) => ({ id, name, updatedAt })),
    });
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('discobot:saved-patterns'));
  }

  setPlaying(synthId: number, playing: boolean, patternId?: string) {
    const synth = this.state!.synths.find(s => s.synthId === synthId);
    if (!synth) return false;
    if (patternId) {
      const pattern = synth.patterns.find(p => p.id === patternId);
      if (pattern) synth.pattern = pattern;
    }
    synth.isPlaying = playing;
    this.emit(playing ? 'sequencerPlay' : 'sequencerStop', { synthId });
    return true;
  }

  async request(path: string, options: RequestInit = {}): Promise<Response> {
    if (!this.state) throw new Error('Local project has not been initialized');
    const state = this.state;
    const method = options.method || 'GET';
    const respond = (data: any, status = 200) => new Response(JSON.stringify(data), {
      status, headers: { 'Content-Type': 'application/json' },
    });
    let body: Record<string, any>;
    try {
      const parsed = typeof options.body === 'string' ? JSON.parse(options.body) : {};
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return respond({ error: 'Invalid local operation data' }, 400);
      body = parsed;
    } catch { return respond({ error: 'Invalid local operation data' }, 400); }
    const update = (type: string, data: any, response: any = data) => {
      this.persist();
      this.emit(type, data);
      return respond(response);
    };
    if (path === '/patterns/saved') return respond(state.savedPatterns.map(({ id, name, updatedAt }) => ({ id, name, updatedAt })));
    const savedMatch = path.match(/^\/patterns\/saved\/([^/]+)$/);
    if (savedMatch) {
      const saved = state.savedPatterns.find(p => p.id === savedMatch[1]);
      if (!saved) return respond({ error: 'Pattern not found' }, 404);
      if (method === 'DELETE') {
        const previous = state.savedPatterns;
        state.savedPatterns = state.savedPatterns.filter(p => p !== saved);
        if (!this.persist()) {
          state.savedPatterns = previous;
          return respond({ error: 'Storage unavailable' }, 507);
        }
        this.notifySaved();
      }
      return respond(saved);
    }
    if (path === '/patterns/save') {
      const name = String(body.name || '').trim();
      if (!name || !Array.isArray(body.steps)) return respond({ error: 'Name and steps required' }, 400);
      const existing = state.savedPatterns.find(p => p.name.toLowerCase() === name.toLowerCase());
      if (existing && body.overwriteId !== existing.id) return respond({ id: existing.id, name: existing.name }, 409);
      const now = Date.now();
      const saved = sanitizeSaved({ ...clone(body), id: existing?.id || crypto.randomUUID(), name, createdAt: existing?.createdAt || now, updatedAt: now }, this.defaults!)!;
      const previous = state.savedPatterns;
      state.savedPatterns = [...previous.filter(p => p.id !== saved.id), saved];
      if (!this.persist()) {
        state.savedPatterns = previous;
        return respond({ error: 'Storage unavailable' }, 507);
      }
      this.notifySaved();
      return respond(saved);
    }
    if (path === '/synth/create') {
      const id = body.synthId || [1, 2, 3].find(id => !state.synths.some(s => s.synthId === id));
      if (!Number.isInteger(id) || id < 1 || id > 3) return respond({ error: 'Three synths maximum' }, 400);
      let synth = state.synths.find(s => s.synthId === id);
      if (!synth) { synth = this.createSynth(id); state.synths.push(synth); }
      return update('synthCreated', synth);
    }
    const match = path.match(/^\/synth\/(\d+)(?:\/(.*))?$/);
    if (match) {
      const synthId = Number(match[1]);
      const synth = state.synths.find(s => s.synthId === synthId);
      if (!synth) return respond({ error: 'Synth not found' }, 404);
      const resource = match[2];
      if (!resource && method === 'DELETE') {
        if (synthId === 1) return respond({ error: 'Synth 1 cannot be removed' }, 400);
        state.synths = state.synths.filter(s => s !== synth);
        return update('synthRemoved', { synthId });
      }
      if (resource === 'parameters') {
        if (method === 'GET') return respond(synth.synthParams);
        synth.synthParams = sanitizeSynthParams(merge(synth.synthParams, body), this.defaults!.synthParams);
        return update('synthUpdate', { synthId, parameters: synth.synthParams }, synth.synthParams);
      }
      if (resource === 'model') {
        if (method === 'GET') return respond({ modelId: synth.synthModelId, modelParams: synth.synthModelParams });
        synth.synthModelId = normalizeSynthModelId(body.modelId || synth.synthModelId);
        synth.synthModelParams = sanitizeModelParams(merge(synth.synthModelParams, record(body.modelParams)));
        return update('synthModelUpdate', { synthId, modelId: synth.synthModelId, modelParams: synth.synthModelParams });
      }
      if (resource === 'mix') {
        if (typeof body.muted === 'boolean') synth.muted = body.muted;
        if (typeof body.solo === 'boolean') synth.solo = body.solo;
        return update('synthMix', { synthId, muted: synth.muted, solo: synth.solo });
      }
      if (resource === 'preferences') {
        synth.octaveShift = Math.round(number(body.octaveShift, synth.octaveShift ?? 0, -2, 2));
        synth.keyboardMode = body.keyboardMode === 'piano-roll' ? 'piano-roll' : body.keyboardMode === 'keyboard' ? 'keyboard' : synth.keyboardMode;
        this.persist();
        return respond(synth);
      }
      if (resource === 'patterns' && method === 'GET') return respond(synth.patterns);
      if (resource?.startsWith('patterns')) {
        const id = resource.split('/')[1] || body.id || crypto.randomUUID();
        const previous = synth.patterns.find(p => p.id === id);
        const pattern = sanitizePattern({ ...previous, ...body, id, steps: body.steps || previous?.steps || synth.pattern.steps }, state.tempo);
        if (!pattern) return respond({ error: 'Invalid sequence pattern' }, 400);
        synth.patterns = [...synth.patterns.filter(p => p.id !== id), pattern];
        synth.pattern = pattern;
        return update(previous ? 'patternUpdated' : 'patternCreated', { synthId, pattern }, pattern);
      }
    }
    if (path === '/tempo') {
      if (method === 'GET') return respond({ tempo: state.tempo });
      if (!Number.isFinite(body.tempo) || body.tempo < 20 || body.tempo > 400) return respond({ error: 'Invalid tempo' }, 400);
      state.tempo = body.tempo;
      state.synths.forEach(s => { s.pattern.tempo = body.tempo; s.patterns.forEach(p => { p.tempo = body.tempo; }); });
      return update('tempoChange', { tempo: state.tempo });
    }
    if (path === '/sequencer/play' || path === '/sequencer/stop') {
      return respond({ success: this.setPlaying(body.synthId || 1, path.endsWith('/play'), body.patternId) });
    }
    if (path === '/drum/kits') return respond({ kits: DRUM_KITS, defaultKitId: 'clean-analog' });
    if (path === '/drum/kit') {
      const kit = DRUM_KITS.find(k => k.id === body.kitId);
      if (!kit) return respond({ error: 'Unknown kit' }, 400);
      state.selectedDrumKitId = kit.id;
      if (body.applyDefaults !== false) {
        DRUM_INSTRUMENTS.forEach(instrument => { state.drumState[instrument].settings = { ...state.drumState[instrument].settings, ...kit.instrumentDefaults[instrument] }; });
      }
      return update('drumKitChanged', { selectedDrumKitId: kit.id, drumState: state.drumState });
    }
    if (path === '/drum/state') {
      if (method === 'GET') return respond(state.drumState);
      state.drumState = sanitizeDrums(body.state || body, this.defaults!.drumState);
      return update('drumFullState', { drumState: state.drumState });
    }
    if (path === '/drum/reset') {
      state.drumState = clone(this.defaults!.drumState);
      return update('drumFullState', { drumState: state.drumState });
    }
    if (path === '/drum/master-volume') {
      state.drumMasterVolume = number(body.volume, state.drumMasterVolume, 0, 1);
      return update('drumMasterVolume', { volume: state.drumMasterVolume });
    }
    if (path === '/drum/swing') {
      state.drumSwing = number(body.swing, state.drumSwing, 0, .75);
      return update('drumSwing', { swing: state.drumSwing });
    }
    if (path === '/drum/fx' || path === '/effects-loop') {
      const key = path === '/drum/fx' ? 'drumFx' : 'effectsLoop';
      if (method === 'GET') return respond(state[key]);
      if (key === 'effectsLoop') state.effectsLoop = sanitizeEffects(merge(state.effectsLoop, body), this.defaults!.effectsLoop);
      else {
        const fx = merge(state.drumFx, body);
        state.drumFx = { sends: sanitizeSends(fx.sends, this.defaults!.drumFx.sends), returnLevel: number(fx.returnLevel, state.drumFx.returnLevel, 0, 1) };
      }
      return update(key === 'drumFx' ? 'drumFxUpdate' : 'effectsLoopUpdate', { [key]: state[key] });
    }
    const track = state.drumState[body.instrument as keyof DrumState];
    if (track && path.startsWith('/drum/')) {
      if ((path === '/drum/step' || path === '/drum/step-velocity') && (!Number.isInteger(body.step) || body.step < 0 || body.step >= 16)) {
        return respond({ error: 'Invalid drum step' }, 400);
      }
      if (path === '/drum/step') track.steps[body.step] = Boolean(body.active);
      else if (path === '/drum/step-velocity') {
        track.stepVelocities ||= Array(16).fill(1);
        track.stepVelocities![body.step] = number(body.velocity, 1, 0, 1);
      } else if (path === '/drum/settings') track.settings = merge(track.settings, record(body.settings));
      else if (path === '/drum/mix') {
        if (typeof body.muted === 'boolean') track.muted = body.muted;
        if (typeof body.solo === 'boolean') track.solo = body.solo;
      } else return respond({ error: 'Unknown local operation' }, 404);
      state.drumState = sanitizeDrums(state.drumState, this.defaults!.drumState);
      return update('drumFullState', { drumState: state.drumState });
    }
    return respond({ error: 'Unknown local operation' }, 404);
  }
}

export const localService = new LocalProjectService();
export const localRequest = (path: string, options?: RequestInit) => localService.request(path, options);
