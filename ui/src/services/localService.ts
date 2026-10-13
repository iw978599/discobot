import type { DrumInstrument, DrumKitDefinition, DrumKitId, DrumSettings, DrumState, EffectsLoopState, FxSendLevels, Pattern, SavedPatternFull, Scene, Song, SynthParameters, SynthModelId, SynthModelParams } from '../types';
import { sanitizeGuests, type Guest } from './guests';
import { createIndexedDbLibrary, createMemoryLibrary, hasIndexedDb, type ProjectInfo, type ProjectLibrary, type ProjectRecord, type VersionInfo, type VersionReason } from './projectLibrary';
import { COPY_SUFFIX, EARLIER_SUFFIX } from './projectFamilies';
import { DRUM_KITS } from './drumKits';
import { barSteps } from './patternLength';
import { normalizeSynthModelId } from '../synthModels';
import { NEW_PROJECT_REVERB } from './effectSettings';
import { record, number, clone, matchesShape, sanitizePattern, sanitizeSynthParams, sanitizeDrums, sanitizeEffects, sanitizeSends, sanitizeSaved, sanitizeModelParams, sanitizeKit, sanitizeScenes, sanitizeSong } from './projectSanitization';
import type { Applied, DeepPartial, DrumFxState, GuestPatch, OpNotice, OpResult, Operation, Origin, Outcome } from './projectOps';
import { commitScene, ensureScenes, newLane, openSignature, reducers, sceneMessage, type ReducerContext } from './projectReducers';

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
export type { State as ProjectState, LocalSynth as ProjectLane, Defaults as ProjectDefaults };
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
const SCHEMA = 19;
// Edits are written this long after the last one, so dragging a knob is one write, not hundreds.
const SAVE_DELAY_MS = 300;
// A version is kept when a project is opened, before anything replaces it, and this often while it is edited.
const VERSION_INTERVAL_MS = 5 * 60_000;
export const MAX_VERSIONS = 20;

export class LocalProjectService {
  private state: State | null = null;
  private defaults: Defaults | null = null;
  private listeners = new Set<Listener>();
  private opListeners = new Set<(notice: OpNotice) => void>();
  private storageIssue: string | null = null;
  private restored = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private unsaved = false;
  // Set when another tab has written the project: this tab stops saving until the user chooses a version.
  private paused = false;
  // True after a write was refused (storage full or blocked); cleared by the next one that works.
  private writeFailed = false;
  private saveListeners = new Set<() => void>();
  private library: ProjectLibrary = createMemoryLibrary();
  // False until a stored working copy was found, so a first run can adopt a library project instead.
  private hadWorkingCopy = false;
  private writeListeners = new Set<() => void>();
  // When each project last had a version kept, and what that version looked like.
  private versionTimes = new Map<string, number>();
  private versionContents = new Map<string, string>();
  // How long edits go on before another version is kept. Public so tests need not wait.
  versionIntervalMs = VERSION_INTERVAL_MS;

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
        this.saveChanged();
        this.emit('externalChange', {});
      });
    }
  }

  private blankState(name = DEFAULT_PROJECT_NAME): State {
    const now = Date.now(), defaults = clone(this.defaults!);
    Object.assign(defaults.effectsLoop.reverb, NEW_PROJECT_REVERB);
    return {
      ...defaults, version: 1, schema: SCHEMA, synths: [], tempo: 120,
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
    // Projects from before scenes existed have none: ensureScenes makes one from the live pattern.
    // The scenes are read first: the open one's time signature says how long a bar of the live
    // lanes and drums is.
    const scenes = sanitizeScenes(parsed.scenes, defaults.drumState);
    const currentSceneId = scenes ? (scenes.some(scene => scene.id === parsed.currentSceneId) ? parsed.currentSceneId as string : scenes[0].id) : '';
    const signature = scenes?.find(scene => scene.id === currentSceneId)?.signature;
    // A bar shorter than one of 4/4 has fewer steps than the defaults' sixteen, which is not damage.
    const drumShape = Object.fromEntries(Object.entries(defaults.drumState).map(([instrument, track]) => [instrument, { ...track, steps: track.steps.slice(0, barSteps(signature)) }]));
    let damaged = !matchesShape(parsed.drumState, drumShape) || !matchesShape(parsed.effectsLoop, defaults.effectsLoop);
    const synths: LocalSynth[] = parsed.synths.flatMap((value: unknown) => {
      const input = record(value), pattern = sanitizePattern(input.pattern, tempo, signature);
      if (!Number.isInteger(input.synthId) || input.synthId < 1 || input.synthId > 3 || seen.has(input.synthId) || !pattern) {
        damaged = true;
        return [];
      }
      seen.add(input.synthId);
      if ((parsed.schema === SCHEMA && !matchesShape(input.synthParams, defaults.synthParams))
        || !input.pattern.steps.every((step: unknown) => matchesShape(step, { active: false, velocity: .7 }))) damaged = true;
      const patterns: Pattern[] = Array.isArray(input.patterns)
        ? input.patterns.map((value: unknown) => sanitizePattern(value, tempo, signature)).filter((value: Pattern | null): value is Pattern => value !== null)
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
      drumState: sanitizeDrums(parsed.drumState, defaults.drumState, signature),
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
    if (scenes) {
      state.scenes = scenes;
      state.currentSceneId = currentSceneId;
      state.song = sanitizeSong(parsed.song, scenes);
    }
    return { state, damaged };
  }

  // The scene functions work on the state they are handed, so the scene reducers can use them
  // (projectReducers.ts); these are the service's own, on its open project.
  private ensureScenes() { ensureScenes(this.state!); }
  private commitScene() { commitScene(this.state!); }
  private sceneMessage() { return sceneMessage(this.state!); }

  // Everything in the project store as one portable object. Samples live in IndexedDB
  // and are not part of it: links, publishing and sync all use this, and none may carry
  // audio. Only saving a project file adds them, beside the project (projectSamples.ts).
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
      await this.keepVersion(this.currentRecord(), 'opened').catch(() => {});
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
    // Opening a project keeps a version of it as it was found, once the library has stored it.
    queueMicrotask(() => { if (this.state === state && !this.versionTimes.has(state.projectId)) this.keepVersion(this.currentRecord(), 'opened').catch(() => {}); });
    this.state = state;
    if (identity) { state.projectId = identity.id; state.name = projectName(identity.name); }
    if (!state.synths.some(s => s.synthId === 1)) state.synths.unshift(this.createSynth(1));
    state.synths.sort((a, b) => a.synthId - b.synthId);
    this.ensureScenes();
    this.restored = true;
    this.paused = false;
    this.write();
    this.saveChanged();
    this.emit('init', this.snapshot());
  }

  listProjects(): Promise<ProjectInfo[]> { return this.library.list(); }

  // --- Versions: earlier states of a project, for mistakes undo cannot reach.

  // What a version is compared by: the project as this version of the app stores it, without
  // the fields every save changes. Without normalizing, a project would look edited after a reload.
  private versionContent(project: unknown): string {
    const { revision: _revision, updatedAt: _updatedAt, currentSceneId: _scene, ...content } = record(this.normalized(project));
    return JSON.stringify(content);
  }

  // Keeps a version of a project unless it is identical to the last one kept. Oldest go first
  // once there are more than MAX_VERSIONS.
  private async keepVersion(source: ProjectRecord, reason: VersionReason): Promise<void> {
    const content = this.versionContent(source.project);
    if (!this.versionContents.has(source.id)) {
      const [latest] = await this.library.listVersions(source.id);
      const stored = latest && await this.library.getVersion(latest.id);
      if (stored) this.versionContents.set(source.id, this.versionContent(stored.project));
    }
    this.versionTimes.set(source.id, Date.now());
    if (this.versionContents.get(source.id) === content) return;
    this.versionContents.set(source.id, content);
    await this.library.putVersion({ id: crypto.randomUUID(), projectId: source.id, at: Date.now(), name: source.name, reason, project: source.project });
    const all = await this.library.listVersions(source.id);
    for (const old of all.slice(MAX_VERSIONS)) await this.library.removeVersion(old.id);
  }

  listVersions(projectId = this.state!.projectId): Promise<VersionInfo[]> { return this.library.listVersions(projectId); }

  // Puts a project back to an earlier version. The state it had just before is kept as a
  // version too, so restoring can itself be taken back.
  async restoreVersion(versionId: string): Promise<ProjectResult> {
    try {
      const version = await this.library.getVersion(versionId);
      if (!version) return { ok: false, error: 'That version is no longer available.' };
      const restored = this.restore({ savedPatterns: [], ...record(version.project) });
      restored.state.savedPatterns = [];
      restored.state.projectId = version.projectId;
      if (version.projectId === this.state!.projectId) {
        this.flush();
        await this.keepVersion(this.currentRecord(), 'before-restore');
        restored.state.name = this.state!.name;
        // What is about to be opened is itself a version already; do not keep it again.
        this.versionContents.set(version.projectId, this.versionContent(this.recordFor(restored.state).project));
        this.activate(restored.state);
        await this.library.put(this.currentRecord());
      } else {
        const existing = await this.library.get(version.projectId);
        if (!existing) return { ok: false, error: 'That project is no longer in the library.' };
        await this.keepVersion(existing, 'before-restore');
        restored.state.name = existing.name;
        await this.library.put({ ...this.recordFor(restored.state), updatedAt: Date.now() });
      }
      await this.announceProjects();
      return { ok: true, repaired: restored.damaged };
    } catch { return { ok: false, error: 'That version could not be restored.' }; }
  }

  // An earlier version as a project of its own, leaving the current one alone.
  async copyVersion(versionId: string): Promise<ProjectResult> {
    try {
      const version = await this.library.getVersion(versionId);
      if (!version) return { ok: false, error: 'That version is no longer available.' };
      const { state } = this.restore({ savedPatterns: [], ...record(version.project) });
      const now = Date.now();
      Object.assign(state, { savedPatterns: [], projectId: crypto.randomUUID(), revision: 0, createdAt: now, updatedAt: now, name: await this.uniqueName(projectName(`${version.name}${EARLIER_SUFFIX}`)) });
      await this.library.put(this.recordFor(state));
      await this.announceProjects();
      return { ok: true };
    } catch { return { ok: false, error: 'The copy could not be saved.' }; }
  }

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
      // Whatever is about to be replaced is kept: sync must never be the reason work is lost.
      const replaced = id === this.state!.projectId ? (this.flush(), this.currentRecord()) : await this.library.get(id);
      if (replaced) await this.keepVersion(replaced, 'before-sync');
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
      const now = Date.now(), copyId = crypto.randomUUID(), copyName = await this.uniqueName(projectName(name, `${source.name}${COPY_SUFFIX}`));
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
      for (const version of await this.library.listVersions(id)) await this.library.removeVersion(version.id);
      this.versionTimes.delete(id);
      this.versionContents.delete(id);
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
    return newLane(synthId, this.state!.tempo, this.defaults!, openSignature(this.state!));
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
    this.saveChanged();
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
    const ok = this.write();
    this.saveChanged();
    return ok;
  }

  get savingPaused() { return this.paused; }

  // Where the open project's work is, as far as this browser knows: another tab has it and this
  // one has stopped saving, the last write was refused, edits are waiting for the short delay
  // before they are written, or everything is written.
  saveState(): 'paused' | 'failed' | 'saving' | 'saved' {
    return this.paused ? 'paused' : this.writeFailed ? 'failed' : this.unsaved ? 'saving' : 'saved';
  }

  subscribeSaveState(listener: () => void) {
    this.saveListeners.add(listener);
    return () => { this.saveListeners.delete(listener); };
  }

  private saveChanged() {
    this.saveListeners.forEach(listener => listener());
  }

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
      this.writeFailed = false;
      this.saveChanged();
      // Keep the library's record of this project in step. It is asynchronous and may not finish
      // if the tab is closing; the working copy just written is what a reload reads.
      const saved = this.currentRecord();
      this.library.put(saved).catch(() => {});
      // The first save of a session keeps a version of the project as it was opened; after that, one every few minutes of editing.
      const kept = this.versionTimes.get(saved.id);
      if (kept !== undefined && Date.now() - kept >= this.versionIntervalMs) this.keepVersion(saved, 'auto').catch(() => {});
      this.writeListeners.forEach(listener => listener());
      return true;
    } catch {
      this.unsaved = true;
      this.writeFailed = true;
      this.saveChanged();
      this.storageIssue = 'Unable to save to browser storage. Free space or allow storage for this site.';
      this.emit('storageError', { message: this.storageIssue });
      return false;
    }
  }

  private ready(): State {
    if (!this.state) throw new Error('Local project has not been initialized');
    return this.state;
  }

  private ctx(): ReducerContext {
    return { state: this.ready(), defaults: this.defaults!, origin: ownOrigin() };
  }

  // The one way an edit reaches the project. It is synchronous and must stay so: the event
  // has been delivered, and the listeners have run, before it returns, which song playback
  // relies on when it opens a scene. A refused operation is answered, not thrown, and has
  // changed nothing. The answer is a copy, as the events are.
  apply<T extends Operation>(op: T, origin: Origin = 'local'): Applied<OpResult<T['type']>> {
    const ctx = this.ctx();
    const reduce = reducers[op.type] as (ctx: ReducerContext, op: Operation) => Outcome<unknown>;
    const out = reduce(ctx, op);
    if (!out.ok) return { ok: false, status: out.status, error: out.error };
    // Every route answered with something, and the copy below cannot be made of nothing.
    if (out.value === undefined) throw new Error(`The reducer for ${op.type} answered with nothing`);
    if (out.save) this.persist();
    if (out.event) this.emit(out.event.type, out.event.data);
    const notice: OpNotice = { op, origin, saved: !!out.save };
    this.opListeners.forEach(listener => listener(notice));
    return { ok: true, value: clone(out.value) as OpResult<T['type']> };
  }

  // Several operations one after another, each delivered before the next begins. One that is
  // refused does not stop the rest.
  applyAll(ops: Operation[], origin: Origin = 'local'): Applied<unknown>[] {
    return ops.map(op => this.apply(op, origin));
  }

  // Told of every accepted operation, after its event. The operation is the caller's own
  // object, not a copy: read it, do not change it.
  subscribeOps(listener: (notice: OpNotice) => void) {
    this.opListeners.add(listener);
    return () => { this.opListeners.delete(listener); };
  }

  setDrumSwing(swing: number) { return this.apply({ type: 'drum.swing', swing }); }
  setDrumMasterVolume(volume: number) { return this.apply({ type: 'drum.masterVolume', volume }); }
  setDrumKit(kitId: string, applyDefaults?: boolean) { return this.apply({ type: 'drum.kit', kitId, applyDefaults }); }
  setDrumState(state: DrumState) { return this.apply({ type: 'drum.state', state }); }
  resetDrums() { return this.apply({ type: 'drum.reset' }); }
  setDrumBars(bars: number) { return this.apply({ type: 'drum.bars', bars }); }
  copyDrumBar(from: number, to: number[]) { return this.apply({ type: 'drum.copyBar', from, to }); }
  setDrumStep(instrument: DrumInstrument, step: number, active: boolean) { return this.apply({ type: 'drum.step', instrument, step, active }); }
  setDrumStepVelocity(instrument: DrumInstrument, step: number, velocity: number) { return this.apply({ type: 'drum.stepVelocity', instrument, step, velocity }); }
  setDrumStepDetail(instrument: DrumInstrument, step: number, detail: { probability?: number; ratchet?: number }) { return this.apply({ type: 'drum.stepDetail', instrument, step, probability: detail.probability, ratchet: detail.ratchet }); }
  setDrumSettings(instrument: DrumInstrument, settings: Partial<DrumSettings>) { return this.apply({ type: 'drum.settings', instrument, settings }); }
  setDrumSample(instrument: DrumInstrument, sampleId?: string) { return this.apply({ type: 'drum.sample', instrument, sampleId }); }
  setDrumMix(instrument: DrumInstrument, mix: { muted?: boolean; solo?: boolean }) { return this.apply({ type: 'drum.mix', instrument, muted: mix.muted, solo: mix.solo }); }
  setDrumFx(patch: DeepPartial<DrumFxState>) { return this.apply({ type: 'drum.fx', patch }); }
  setEffectsLoop(patch: DeepPartial<EffectsLoopState>) { return this.apply({ type: 'effects.set', patch }); }
  setTempo(tempo: number) { return this.apply({ type: 'tempo.set', tempo }); }
  setSynthParams(synthId: number, patch: DeepPartial<SynthParameters>) { return this.apply({ type: 'synth.params', synthId, patch }); }
  setSynthModel(synthId: number, model: { modelId?: SynthModelId; modelParams?: Partial<SynthModelParams> }) { return this.apply({ type: 'synth.model', synthId, modelId: model.modelId, modelParams: model.modelParams }); }
  setSynthMix(synthId: number, mix: { muted?: boolean; solo?: boolean }) { return this.apply({ type: 'synth.mix', synthId, muted: mix.muted, solo: mix.solo }); }
  setSynthPrefs(synthId: number, prefs: { octaveShift?: number; keyboardMode?: 'keyboard' | 'piano-roll' }) { return this.apply({ type: 'synth.prefs', synthId, octaveShift: prefs.octaveShift, keyboardMode: prefs.keyboardMode }); }
  writePattern(synthId: number, patternId: string, patch: Partial<Pattern>) { return this.apply({ type: 'pattern.write', synthId, patternId, patch }); }
  createLane(synthId?: number) { return this.apply({ type: 'synth.create', synthId }); }
  removeLane(synthId: number) { return this.apply({ type: 'synth.remove', synthId }); }
  playLane(synthId: number, patternId?: string) { return this.apply({ type: 'transport.play', synthId, patternId }); }
  stopLane(synthId: number) { return this.apply({ type: 'transport.stop', synthId }); }
  addGuest(url: string, name?: string) { return this.apply({ type: 'guest.add', guestId: crypto.randomUUID(), url, name }); }
  changeGuest(guestId: string, patch: GuestPatch) { return this.apply({ type: 'guest.patch', guestId, patch }); }
  removeGuest(guestId: string) { return this.apply({ type: 'guest.remove', guestId }); }
  // Synchronous end to end: the sceneChanged event has been delivered, and the listeners have
  // written what they keep, before this returns. Song playback opens the playing scene with it
  // and reads the lanes on the next line.
  selectScene(sceneId: string) { return this.apply({ type: 'scene.select', sceneId }); }
  createScene(options: { name?: string; empty?: boolean } = {}) { return this.apply({ type: 'scene.create', sceneId: crypto.randomUUID(), name: options.name, empty: options.empty }); }
  renameScene(sceneId: string, name: string) { return this.apply({ type: 'scene.rename', sceneId, name }); }
  setSceneColor(sceneId: string, color?: string) { return this.apply({ type: 'scene.color', sceneId, color }); }
  setSceneSignature(signature: string) { return this.apply({ type: 'scene.signature', signature }); }
  copyPartToScene(toSceneId: string, part: { synthId?: number; drum?: DrumInstrument }) { return this.apply({ type: 'scene.copyPart', toSceneId, ...part }); }
  deleteScene(sceneId: string) { return this.apply({ type: 'scene.delete', sceneId }); }
  replaceScenes(replacement: { scenes?: unknown; currentSceneId?: string; song?: unknown } = {}) { return this.apply({ type: 'scene.replace', scenes: replacement.scenes, currentSceneId: replacement.currentSceneId, song: replacement.song }); }
  setSong(song: { entries?: unknown; loop?: boolean }) { return this.apply({ type: 'song.set', entries: song.entries, loop: song.loop }); }

  getDrumKits(): { kits: DrumKitDefinition[]; defaultKitId: DrumKitId } {
    return clone({ kits: DRUM_KITS, defaultKitId: 'clean-analog' });
  }

  getTempo() { return { tempo: this.ready().tempo }; }

  getScenes(): { scenes: Scene[]; song: Song; currentSceneId: string } {
    this.ready();
    const { scenes, song, currentSceneId } = this.sceneMessage();
    return clone({ scenes, song, currentSceneId });
  }
}

export const localService = new LocalProjectService();
