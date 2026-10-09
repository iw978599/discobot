import type { DrumState, EffectsLoopState, FxSendLevels, Pattern, SavedPatternFull, Scene, Song, SynthParameters, SynthModelId, SynthModelParams } from '../types';
import { MAX_GUESTS, guestUrl, patchGuest, sanitizeGuests, type Guest } from './guests';
import { emptySteps } from './songPlayback';
import { createIndexedDbLibrary, createMemoryLibrary, hasIndexedDb, type ProjectInfo, type ProjectLibrary, type ProjectRecord } from './projectLibrary';
import { DRUM_INSTRUMENTS, DRUM_KITS } from './drumKits';
import { normalizeSynthModelId } from '../synthModels';
import { record, number, matchesShape, sanitizePattern, sanitizeSynthParams, sanitizeDrums, sanitizeEffects, sanitizeSends, sanitizeSaved, sanitizeModelParams, sanitizeKit, sanitizeScenes, sanitizeSong, MAX_SCENES } from './projectSanitization';

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
  version: 1; schema: typeof SCHEMA; synths: LocalSynth[]; tempo: number; selectedDrumKitId: string;
  drumMasterVolume: number; drumSwing: number; savedPatterns: SavedPatternFull[];
  // The lanes' patterns and the drum grid above are the scene being edited. Its entry in
  // `scenes` is only brought up to date when it is needed: see commitScene.
  scenes: Scene[]; currentSceneId: string; song: Song;
  // Which project in the library this is. The copy in localStorage is the working copy of
  // the open project; the library holds one record per project, this one included.
  projectId: string; name: string; revision: number; createdAt: number; updatedAt: number;
  // Other creators' instruments hosted in a frame. Optional so older projects need no migration.
  guests?: Guest[];
};
type ProjectResult = { ok: true; repaired?: boolean } | { ok: false; error: string };
const DEFAULT_PROJECT_NAME = 'Untitled';
const projectName = (value: unknown, fallback = DEFAULT_PROJECT_NAME) =>
  (typeof value === 'string' && value.trim() ? value.trim() : fallback).slice(0, 60);
export interface ProjectFile {
  format: typeof PROJECT_FILE_FORMAT;
  formatVersion: 1;
  exportedAt: string;
  project: State;
}
const PROJECT_FILE_FORMAT = 'discobot-project';
const ownOrigin = () => (typeof window !== 'undefined' && window.location ? window.location.origin : undefined);
const STORAGE_KEY = 'discobot_browser_project_v1';
// Bumped when synth parameters gain fields. An older project is upgraded with defaults,
// which is a migration and not damage worth warning about.
const SCHEMA = 5;
// Edits are written this long after the last one, so dragging a knob is one write, not hundreds.
const SAVE_DELAY_MS = 300;
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
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private unsaved = false;
  // Set when another tab has written the project: this tab stops saving until the user chooses a version.
  private paused = false;
  private library: ProjectLibrary = createMemoryLibrary();
  // False until a stored working copy was found, so a first run can adopt a library project instead.
  private hadWorkingCopy = false;
  private writeListeners = new Set<() => void>();

  initialize(defaults: Defaults) {
    if (this.state) return;
    this.defaults = clone(defaults);
    this.state = this.blankState();
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const { state, damaged } = this.restore(JSON.parse(stored));
        this.state = state;
        this.hadWorkingCopy = true;
        if (damaged) this.storageIssue = 'Some damaged browser project values were repaired. Please save a new copy of your arrangement.';
        this.restored = state.synths.length > 0;
      }
    } catch {
      this.storageIssue = 'Browser storage is unavailable or damaged. Edits work, but may not survive reload.';
    }
    if (!this.state.synths.some(s => s.synthId === 1)) this.state.synths.unshift(this.createSynth(1));
    this.ensureScenes();
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('pagehide', () => { this.flush(); });
      document.addEventListener('visibilitychange', () => { if (document.hidden) this.flush(); });
      // The storage event only fires in tabs other than the one that wrote.
      window.addEventListener('storage', (event) => {
        if (event.key !== STORAGE_KEY || this.paused) return;
        this.paused = true;
        this.emit('externalChange', {});
      });
    }
  }

  private blankState(name = DEFAULT_PROJECT_NAME): State {
    const now = Date.now();
    return {
      ...clone(this.defaults!), version: 1, schema: SCHEMA, synths: [], tempo: 120,
      selectedDrumKitId: 'clean-analog', drumMasterVolume: 1, drumSwing: 0, savedPatterns: [],
      scenes: [], currentSceneId: '', song: { entries: [], loop: false },
      projectId: crypto.randomUUID(), name, revision: 0, createdAt: now, updatedAt: now, guests: [],
    };
  }

  // Rebuilds a project from untrusted data: browser storage or an imported file.
  private restore(parsed: any): { state: State; damaged: boolean } {
    const defaults = this.defaults!;
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
      if ((parsed.schema === SCHEMA && !matchesShape(input.synthParams, defaults.synthParams))
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
    const state: State = {
      ...clone(defaults), version: 1, schema: SCHEMA, synths, savedPatterns, tempo,
      drumState: sanitizeDrums(parsed.drumState, defaults.drumState),
      effectsLoop: sanitizeEffects(parsed.effectsLoop, defaults.effectsLoop),
      drumFx: {
        sends: sanitizeSends(record(parsed.drumFx).sends, defaults.drumFx.sends),
        returnLevel: number(record(parsed.drumFx).returnLevel, defaults.drumFx.returnLevel, 0, 1),
      },
      selectedDrumKitId: sanitizeKit(parsed.selectedDrumKitId),
      drumMasterVolume: number(parsed.drumMasterVolume, 1, 0, 1), drumSwing: number(parsed.drumSwing, 0, 0, .75),
      scenes: [], currentSceneId: '', song: { entries: [], loop: false },
      projectId: typeof parsed.projectId === 'string' && parsed.projectId ? parsed.projectId.slice(0, 200) : crypto.randomUUID(),
      name: projectName(parsed.name), revision: Math.round(number(parsed.revision, 0, 0, 1e12)),
      createdAt: number(parsed.createdAt, Date.now(), 0, 1e15), updatedAt: number(parsed.updatedAt, Date.now(), 0, 1e15),
      guests: sanitizeGuests(parsed.guests, ownOrigin()),
    };
    // Projects from before scenes existed have none: ensureScenes makes one from the live pattern.
    const scenes = sanitizeScenes(parsed.scenes, defaults.drumState);
    if (scenes) {
      state.scenes = scenes;
      state.currentSceneId = scenes.some(scene => scene.id === parsed.currentSceneId) ? parsed.currentSceneId : scenes[0].id;
      state.song = sanitizeSong(parsed.song, scenes);
    }
    return { state, damaged };
  }

  // The live lanes and drum grid as a scene.
  private captureScene(id: string, name: string): Scene {
    const state = this.state!;
    return {
      id, name,
      lanes: Object.fromEntries(state.synths.map(synth => [synth.synthId, clone(synth.pattern.steps)])),
      drums: Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => {
        const { steps, stepVelocities, stepProbabilities, stepRatchets } = state.drumState[instrument];
        return [instrument, clone({
          steps, ...(stepVelocities ? { stepVelocities } : {}), ...(stepProbabilities ? { stepProbabilities } : {}),
          ...(stepRatchets ? { stepRatchets } : {}),
        })];
      })) as Scene['drums'],
    };
  }

  private ensureScenes() {
    const state = this.state!;
    if (state.scenes.length === 0) {
      const scene = this.captureScene(crypto.randomUUID(), 'Scene 1');
      state.scenes = [scene];
      state.currentSceneId = scene.id;
    }
    if (!state.scenes.some(scene => scene.id === state.currentSceneId)) state.currentSceneId = state.scenes[0].id;
    state.song = sanitizeSong(state.song, state.scenes);
  }

  // Copies the live pattern into the current scene's slot. Edits go to the live lanes and
  // drums, so this runs before anything reads `scenes`: saving, switching, exporting.
  private commitScene() {
    const state = this.state!;
    const index = state.scenes.findIndex(scene => scene.id === state.currentSceneId);
    if (index >= 0) state.scenes[index] = this.captureScene(state.currentSceneId, state.scenes[index].name);
  }

  // Makes a scene the live pattern.
  private applyScene(scene: Scene) {
    const state = this.state!;
    state.currentSceneId = scene.id;
    for (const synth of state.synths) synth.pattern.steps = clone(scene.lanes[synth.synthId] ?? emptySteps());
    for (const instrument of DRUM_INSTRUMENTS) {
      const track = state.drumState[instrument], pattern = scene.drums[instrument];
      track.steps = clone(pattern.steps);
      for (const key of ['stepVelocities', 'stepProbabilities', 'stepRatchets'] as const) {
        if (pattern[key]) track[key] = clone(pattern[key]);
        else delete track[key];
      }
    }
  }

  private sceneMessage() {
    const state = this.state!;
    this.commitScene();
    return {
      scenes: state.scenes, song: state.song, currentSceneId: state.currentSceneId,
      synths: state.synths.map(synth => ({ synthId: synth.synthId, pattern: synth.pattern })), drumState: state.drumState,
    };
  }

  // Everything in the project store as one portable object. Samples live in IndexedDB
  // and are not part of it.
  exportProject(): ProjectFile {
    this.commitScene();
    const project = clone(this.state!);
    project.synths.forEach(synth => { synth.isPlaying = false; });
    project.savedPatterns = [];
    return { format: PROJECT_FILE_FORMAT, formatVersion: 1, exportedAt: new Date().toISOString(), project };
  }

  private currentRecord(): ProjectRecord {
    this.commitScene();
    const { savedPatterns: _legacy, ...project } = clone(this.state!);
    project.synths.forEach(synth => { synth.isPlaying = false; });
    return {
      id: project.projectId, name: project.name, createdAt: project.createdAt, updatedAt: project.updatedAt,
      revision: project.revision, project: { ...project, savedPatterns: [] },
    };
  }

  // A saved arrangement from before the library existed, as a project of its own.
  private savedToRecord(saved: SavedPatternFull): ProjectRecord {
    const lanes = saved.synths?.length ? saved.synths : [{ id: 1, steps: saved.steps, synthParams: saved.synthParams, synthModelId: saved.synthModelId, synthModelParams: saved.synthModelParams }];
    const { state } = this.restore({
      version: 1, savedPatterns: [], tempo: saved.tempo, drumState: saved.drumState, effectsLoop: saved.effectsLoop,
      drumFx: saved.drumFx, selectedDrumKitId: saved.drumKitId, drumMasterVolume: saved.drumMasterVolume, drumSwing: saved.drumSwing,
      scenes: saved.scenes, song: saved.song, currentSceneId: saved.currentSceneId,
      synths: lanes.map(lane => {
        const pattern = { id: crypto.randomUUID(), name: `Synth ${lane.id}`, steps: lane.steps };
        return { ...lane, synthId: lane.id, pattern, patterns: [pattern] };
      }),
      projectId: saved.id, name: saved.name, createdAt: saved.createdAt, updatedAt: saved.updatedAt,
    });
    const keep = this.state!;
    // captureScene reads this.state, so borrow it to give the record its first scene.
    this.state = state;
    this.ensureScenes();
    const record = this.currentRecord();
    this.state = keep;
    return record;
  }

  // Connects the project library and brings it up to date with this browser's working copy.
  // The app is usable before this resolves; it only gates the library operations.
  async openLibrary(library?: ProjectLibrary): Promise<void> {
    try {
      this.library = library ?? (hasIndexedDb() ? createIndexedDbLibrary() : createMemoryLibrary());
      const state = this.state!;
      if (state.savedPatterns.length > 0) {
        // Saved arrangements become projects. They only leave the working copy once every one is safely stored.
        for (const saved of state.savedPatterns) await this.library.put(this.savedToRecord(saved));
        state.savedPatterns = [];
        this.write();
      }
      const projects = await this.library.list();
      if (!this.hadWorkingCopy && projects.length > 0) {
        // The working copy is gone (site data partly cleared) but the library survived: reopen the latest.
        const record = await this.library.get(projects[0].id);
        if (record) this.activate(this.restore(record.project).state, record);
      } else {
        await this.library.put(this.currentRecord());
      }
      this.hadWorkingCopy = true;
      await this.announceProjects();
    } catch {
      this.storageIssue = 'The project library is unavailable in this browser. The open project is still saved, but other projects cannot be listed.';
      this.emit('storageError', { message: this.storageIssue });
    }
  }

  private async announceProjects() {
    this.emit('projectsChanged', { projects: await this.library.list(), projectId: this.state!.projectId, name: this.state!.name });
  }

  // Puts the open project away in the library before another takes its place.
  private async stash() {
    this.write();
    await this.library.put(this.currentRecord());
  }

  // Makes a project the open one.
  private activate(state: State, identity?: Pick<ProjectRecord, 'id' | 'name'>) {
    this.state = state;
    if (identity) { state.projectId = identity.id; state.name = projectName(identity.name); }
    if (!state.synths.some(s => s.synthId === 1)) state.synths.unshift(this.createSynth(1));
    state.synths.sort((a, b) => a.synthId - b.synthId);
    this.ensureScenes();
    this.restored = true;
    this.paused = false;
    this.write();
    this.emit('init', this.snapshot());
  }

  listProjects(): Promise<ProjectInfo[]> { return this.library.list(); }

  // --- What project sync needs. Sync never reaches into the state itself.

  subscribeWrites(listener: () => void) {
    this.writeListeners.add(listener);
    return () => { this.writeListeners.delete(listener); };
  }

  // Every project as it stands now, or null while another tab's change is unresolved.
  async syncRecords(): Promise<ProjectRecord[] | null> {
    if (this.paused) return null;
    this.flush();
    await this.library.put(this.currentRecord());
    const records = await Promise.all((await this.library.list()).map(project => this.library.get(project.id)));
    return records.filter((entry): entry is ProjectRecord => entry !== undefined);
  }

  private recordFor(state: State): ProjectRecord {
    const keep = this.state!;
    // currentRecord and the scene helpers read this.state, so borrow it.
    this.state = state;
    if (!state.synths.some(s => s.synthId === 1)) state.synths.unshift(this.createSynth(1));
    this.ensureScenes();
    const made = this.currentRecord();
    this.state = keep;
    return made;
  }

  // Stores a project downloaded from the account under its own id, replacing this browser's
  // copy if there is one. Like a file, it is untrusted and goes through restore().
  async syncReceive(id: string, file: unknown): Promise<ProjectRecord | null> {
    const input = record(file);
    if (input.format !== PROJECT_FILE_FORMAT || this.paused) return null;
    try {
      const { state } = this.restore({ savedPatterns: [], ...record(input.project) });
      state.savedPatterns = [];
      state.projectId = id;
      state.name = await this.uniqueName(projectName(state.name), id);
      if (id === this.state!.projectId) {
        this.activate(state);
        await this.library.put(this.currentRecord());
      } else {
        await this.library.put(this.recordFor(state));
      }
      await this.announceProjects();
      return (await this.library.get(id)) ?? null;
    } catch { return null; }
  }

  // Gives a project a new identity, so the account's version can take the old one. Used when
  // the same project was changed in two places: both are kept.
  async syncFork(id: string, name: string): Promise<string | null> {
    try {
      const nextId = crypto.randomUUID(), nextName = await this.uniqueName(projectName(name));
      if (id === this.state!.projectId) {
        Object.assign(this.state!, { projectId: nextId, name: nextName });
        this.write();
        await this.library.put(this.currentRecord());
      } else {
        const found = await this.library.get(id);
        if (!found) return null;
        await this.library.put({ ...found, id: nextId, name: nextName, project: { ...(found.project as object), projectId: nextId, name: nextName } });
      }
      await this.library.remove(id);
      await this.announceProjects();
      return nextId;
    } catch { return null; }
  }

  // A project as this version of the app would store it. Opening a project fills in settings
  // that newer versions added, so two copies are compared in this form or an untouched
  // project would look edited.
  normalized(project: unknown): unknown {
    try {
      return this.recordFor(this.restore({ savedPatterns: [], ...record(project) }).state).project;
    } catch { return project; }
  }

  // The project file for any project in the library, for uploading.
  fileFor(found: ProjectRecord): ProjectFile {
    return { format: PROJECT_FILE_FORMAT, formatVersion: 1, exportedAt: new Date(found.updatedAt).toISOString(), project: found.project as State };
  }

  // Two projects may not share a name, or they could not be told apart in the list.
  private async uniqueName(base: string, ignoreId?: string): Promise<string> {
    const taken = new Set((await this.library.list()).filter(project => project.id !== ignoreId).map(project => project.name.toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    for (let n = 2; ; n++) {
      const candidate = `${base.slice(0, 56)} ${n}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  async newProject(name?: string): Promise<ProjectResult> {
    try {
      await this.stash();
      const state = this.blankState(await this.uniqueName(projectName(name)));
      this.state = state;
      state.synths = [1, 2, 3].map(id => this.createSynth(id));
      this.activate(state);
      await this.library.put(this.currentRecord());
      await this.announceProjects();
      return { ok: true };
    } catch { return { ok: false, error: 'A new project could not be created.' }; }
  }

  async openProject(id: string): Promise<ProjectResult> {
    if (id === this.state!.projectId) return { ok: true };
    try {
      const record = await this.library.get(id);
      if (!record) return { ok: false, error: 'That project is no longer in the library.' };
      const restored = this.restore(record.project);
      await this.stash();
      this.activate(restored.state, record);
      await this.announceProjects();
      return { ok: true, repaired: restored.damaged };
    } catch { return { ok: false, error: 'That project could not be opened.' }; }
  }

  // A copy of a project as it stands now, left in the library. The open project stays open,
  // so this is how to keep a version to go back to.
  async copyProject(id: string, name?: string): Promise<ProjectResult> {
    try {
      const source = id === this.state!.projectId ? (this.write(), this.currentRecord()) : await this.library.get(id);
      if (!source) return { ok: false, error: 'That project is no longer in the library.' };
      const now = Date.now(), copyId = crypto.randomUUID(), copyName = await this.uniqueName(projectName(name, `${source.name} copy`));
      await this.library.put({
        ...source, id: copyId, name: copyName, createdAt: now, updatedAt: now, revision: 0,
        project: { ...(source.project as object), projectId: copyId, name: copyName, revision: 0, createdAt: now, updatedAt: now },
      });
      await this.announceProjects();
      return { ok: true };
    } catch { return { ok: false, error: 'The copy could not be saved.' }; }
  }

  async renameProject(id: string, name: string): Promise<ProjectResult> {
    const wanted = projectName(name, '');
    if (!wanted) return { ok: false, error: 'A project needs a name.' };
    try {
      const next = await this.uniqueName(wanted, id);
      if (id === this.state!.projectId) {
        this.state!.name = next;
        await this.stash();
      } else {
        const record = await this.library.get(id);
        if (!record) return { ok: false, error: 'That project is no longer in the library.' };
        await this.library.put({ ...record, name: next, project: { ...(record.project as object), name: next } });
      }
      await this.announceProjects();
      return { ok: true };
    } catch { return { ok: false, error: 'The project could not be renamed.' }; }
  }

  async deleteProject(id: string): Promise<ProjectResult> {
    try {
      await this.library.remove(id);
      if (id === this.state!.projectId) {
        // The open project was deleted: open the most recent one left, or start a new one.
        const [next] = await this.library.list();
        const record = next && await this.library.get(next.id);
        if (record) this.activate(this.restore(record.project).state, record);
        else {
          const state = this.blankState();
          this.state = state;
          state.synths = [1, 2, 3].map(synthId => this.createSynth(synthId));
          this.activate(state);
          await this.library.put(this.currentRecord());
        }
      }
      await this.announceProjects();
      return { ok: true };
    } catch { return { ok: false, error: 'The project could not be deleted.' }; }
  }

  // Checks and repairs a project file without opening it, so a shared song can be shown first.
  readProjectFile(file: unknown): { ok: true; project: State } | { ok: false; error: string } {
    const input = record(file);
    if (input.format !== PROJECT_FILE_FORMAT) return { ok: false, error: 'This is not a Discobot song. The link may have been cut short.' };
    if (input.formatVersion !== 1) return { ok: false, error: 'This song was made by a newer version of Discobot.' };
    try {
      const { state } = this.restore({ savedPatterns: [], ...record(input.project) });
      const keep = this.state!;
      this.state = state;
      if (!state.synths.some(s => s.synthId === 1)) state.synths.unshift(this.createSynth(1));
      this.ensureScenes();
      this.state = keep;
      return { ok: true, project: state };
    } catch {
      return { ok: false, error: 'The song in this link is damaged and could not be read.' };
    }
  }

  // Adds the contents of an exported file to the library as a new project and opens it.
  // The project that was open stays in the library.
  async importProject(file: unknown): Promise<ProjectResult> {
    const input = record(file);
    if (input.format !== PROJECT_FILE_FORMAT) return { ok: false, error: 'This is not a Discobot project file.' };
    if (input.formatVersion !== 1) return { ok: false, error: 'This project file was made by a newer version of Discobot.' };
    let restored: { state: State; damaged: boolean };
    try {
      restored = this.restore({ savedPatterns: [], ...record(input.project) });
    } catch {
      return { ok: false, error: 'The project file is damaged and could not be read.' };
    }
    try {
      await this.stash();
      const legacy = restored.state.savedPatterns;
      restored.state.savedPatterns = [];
      // A file always arrives as a new project, so importing twice never overwrites anything.
      const now = Date.now();
      Object.assign(restored.state, {
        projectId: crypto.randomUUID(), revision: 0, createdAt: now, updatedAt: now, name: await this.uniqueName(restored.state.name),
      });
      const previous = this.state!;
      this.activate(restored.state);
      if (this.unsaved) {
        this.state = previous;
        this.write();
        this.emit('init', this.snapshot());
        return { ok: false, error: 'The project is too large for this browser\'s storage.' };
      }
      await this.library.put(this.currentRecord());
      // Files made before the library existed carry saved arrangements; they come along as projects.
      for (const saved of legacy) await this.library.put(this.savedToRecord({ ...saved, id: crypto.randomUUID() }));
      await this.announceProjects();
      return { ok: true, repaired: restored.damaged };
    } catch { return { ok: false, error: 'The project could not be added to the library.' }; }
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
    this.commitScene();
    return clone({ ...this.state, drumKits: DRUM_KITS, restored: this.restored });
  }

  private emit(type: string, data: any) {
    for (const listener of this.listeners) listener({ type, data: clone(data) });
  }

  // Marks the project as changed; the write follows once edits pause.
  private persist() {
    this.unsaved = true;
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { this.flush(); }, SAVE_DELAY_MS);
  }

  // Writes any pending edits now. Called when the page is hidden or closed, and by anything
  // that needs to know the write succeeded.
  flush(): boolean {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.unsaved || this.paused) return true;
    return this.write();
  }

  // Another tab changed the stored project. Keep this tab's version: save it over theirs and carry on.
  resumeSaving(): boolean {
    this.paused = false;
    return this.write();
  }

  get savingPaused() { return this.paused; }

  private write() {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const state = this.state!;
    try {
      this.commitScene();
      state.revision++;
      state.updatedAt = Date.now();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      this.unsaved = false;
      // Keep the library's record of this project in step. It is asynchronous and may not finish
      // if the tab is closing; the working copy just written is what a reload reads.
      this.library.put(this.currentRecord()).catch(() => {});
      this.writeListeners.forEach(listener => listener());
      return true;
    } catch {
      this.unsaved = true;
      this.storageIssue = 'Unable to save to browser storage. Free space or allow storage for this site.';
      this.emit('storageError', { message: this.storageIssue });
      return false;
    }
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
    if (path === '/scenes') {
      const { scenes, song, currentSceneId } = this.sceneMessage();
      return respond({ scenes, song, currentSceneId });
    }
    if (path === '/scenes/select') {
      const target = state.scenes.find(scene => scene.id === body.sceneId);
      if (!target) return respond({ error: 'Scene not found' }, 404);
      if (target.id !== state.currentSceneId) {
        this.commitScene();
        this.applyScene(target);
      }
      return update('sceneChanged', this.sceneMessage());
    }
    if (path === '/scenes/create') {
      if (state.scenes.length >= MAX_SCENES) return respond({ error: `A project can hold ${MAX_SCENES} scenes` }, 400);
      this.commitScene();
      const name = (typeof body.name === 'string' && body.name.trim() ? body.name.trim() : `Scene ${state.scenes.length + 1}`).slice(0, 40);
      const scene = this.captureScene(crypto.randomUUID(), name);
      if (body.empty === true) {
        for (const id of Object.keys(scene.lanes)) scene.lanes[Number(id)] = emptySteps(scene.lanes[Number(id)].length);
        for (const instrument of DRUM_INSTRUMENTS) scene.drums[instrument] = { steps: Array(16).fill(false) };
      }
      const index = state.scenes.findIndex(entry => entry.id === state.currentSceneId);
      state.scenes.splice(index + 1, 0, scene);
      this.applyScene(scene);
      return update('sceneChanged', this.sceneMessage());
    }
    if (path === '/scenes/rename') {
      const target = state.scenes.find(scene => scene.id === body.sceneId);
      const name = typeof body.name === 'string' ? body.name.trim().slice(0, 40) : '';
      if (!target || !name) return respond({ error: 'A scene needs a name' }, 400);
      target.name = name;
      return update('sceneChanged', this.sceneMessage());
    }
    if (path === '/scenes/delete') {
      const index = state.scenes.findIndex(scene => scene.id === body.sceneId);
      if (index < 0) return respond({ error: 'Scene not found' }, 404);
      if (state.scenes.length === 1) return respond({ error: 'A project needs at least one scene' }, 400);
      this.commitScene();
      state.scenes.splice(index, 1);
      if (body.sceneId === state.currentSceneId) this.applyScene(state.scenes[Math.max(0, index - 1)]);
      state.song = sanitizeSong({ ...state.song, entries: state.song.entries.filter(entry => entry.sceneId !== body.sceneId) }, state.scenes);
      return update('sceneChanged', this.sceneMessage());
    }
    if (path === '/scenes/replace') {
      // Used when a saved arrangement is loaded: the lanes and drums have already been set to
      // its current scene, so that scene is taken from the live pattern.
      const scenes = sanitizeScenes(body.scenes, this.defaults!.drumState);
      state.scenes = scenes ?? [];
      state.currentSceneId = scenes?.some(scene => scene.id === body.currentSceneId) ? body.currentSceneId : scenes?.[0].id ?? '';
      state.song = scenes ? sanitizeSong(body.song, scenes) : { entries: [], loop: false };
      this.ensureScenes();
      return update('sceneChanged', this.sceneMessage());
    }
    if (path === '/song') {
      state.song = sanitizeSong({ entries: body.entries ?? state.song.entries, loop: body.loop ?? state.song.loop }, state.scenes);
      return update('sceneChanged', this.sceneMessage());
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
    if (path === '/guests' && method === 'POST') {
      const guests = state.guests ?? [];
      const url = guestUrl(body.url, ownOrigin());
      if (!url) return respond({ error: 'That is not an address a guest instrument can be loaded from. It must start with https:// and be on another site.' }, 400);
      if (guests.length >= MAX_GUESTS) return respond({ error: `A project can hold ${MAX_GUESTS} guest instruments.` }, 409);
      const [guest] = sanitizeGuests([{ id: crypto.randomUUID(), url, name: body.name }], ownOrigin());
      state.guests = [...guests, guest];
      return update('guestsChanged', { guests: state.guests });
    }
    const guestMatch = /^\/guests\/([0-9a-f-]{36})$/.exec(path);
    if (guestMatch) {
      const guests = state.guests ?? [];
      if (!guests.some(guest => guest.id === guestMatch[1])) return respond({ error: 'Guest not found' }, 404);
      state.guests = method === 'DELETE'
        ? guests.filter(guest => guest.id !== guestMatch[1])
        : guests.map(guest => (guest.id === guestMatch[1] ? patchGuest(guest, body) : guest));
      return update('guestsChanged', { guests: state.guests });
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
      if ((path === '/drum/step' || path === '/drum/step-velocity' || path === '/drum/step-detail') && (!Number.isInteger(body.step) || body.step < 0 || body.step >= 16)) {
        return respond({ error: 'Invalid drum step' }, 400);
      }
      if (path === '/drum/step') track.steps[body.step] = Boolean(body.active);
      else if (path === '/drum/step-velocity') {
        track.stepVelocities ||= Array(16).fill(1);
        track.stepVelocities![body.step] = number(body.velocity, 1, 0, 1);
      } else if (path === '/drum/step-detail') {
        if (body.probability !== undefined) {
          track.stepProbabilities ||= Array(16).fill(1);
          track.stepProbabilities![body.step] = number(body.probability, 1, 0, 1);
        }
        if (body.ratchet !== undefined) {
          track.stepRatchets ||= Array(16).fill(1);
          track.stepRatchets![body.step] = number(body.ratchet, 1, 1, 4);
        }
      } else if (path === '/drum/settings') track.settings = merge(track.settings, record(body.settings));
      else if (path === '/drum/sample') {
        if (typeof body.sampleId === 'string') track.sampleId = body.sampleId; else delete track.sampleId;
      } else if (path === '/drum/mix') {
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
