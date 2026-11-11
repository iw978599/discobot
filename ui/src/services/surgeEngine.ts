import type { SurgeModule } from '@discobot/engine';
import { surgePatchUrl } from './surgePatches';

// Surge XT's engine and Discobot's patches for it, fetched from this site only when something
// needs them (docs/SURGE_XT_PLAN.md): a lane playing Surge live (useSynthAudio hands the compiled
// module to the worklet) or an export with a Surge lane (made here, on the page).

const base = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
export const SURGE_WORKLET_URL = `${base}surge/surge-worklet.js`;

const once = <T>(make: () => Promise<T>) => {
  let made: Promise<T> | null = null;
  return () => {
    made ??= make();
    made.catch(() => { made = null; });
    return made;
  };
};

const files = new Map<string, Promise<Uint8Array>>();
// A patch's .fxp file, fetched once for the page.
export function surgePatchBytes(id: string): Promise<Uint8Array> {
  let file = files.get(id);
  if (!file) {
    file = fetch(surgePatchUrl(base, id)).then(async response => {
      if (!response.ok) throw new Error(`Surge patch ${id}: ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    });
    file.catch(() => files.delete(id));
    files.set(id, file);
  }
  return file;
}

// Surge's compiled WebAssembly, for the worklet and for the page alike.
export const surgeWasm = once(async () => {
  const response = await fetch(`${base}surge/surge-engine.wasm`);
  if (!response.ok) throw new Error(`Surge engine: ${response.status}`);
  return WebAssembly.compile(await response.arrayBuffer());
});

type MakeSurge = (options: Record<string, unknown>) => Promise<SurgeModule>;

// Surge's module made on this page, for an export: the glue the worklet uses, loaded as a script.
export const surgeHere = once(async (): Promise<SurgeModule> => {
  const holder = globalThis as unknown as { createSurgeModule?: MakeSurge };
  if (!holder.createSurgeModule) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SURGE_WORKLET_URL;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Surge XT could not be loaded.'));
      document.head.appendChild(script);
    });
  }
  const module = await surgeWasm();
  return holder.createSurgeModule!({
    instantiateWasm(imports: WebAssembly.Imports, done: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void) {
      WebAssembly.instantiate(module, imports).then(instance => done(instance, module));
      return {};
    },
    print() {}, printErr() {},
  });
});

// What an export needs to play Surge lanes: the module and every patch it uses, by id.
export interface SurgeKit { module: SurgeModule; patches: Record<string, Uint8Array> }

export async function surgeKit(patchIds: string[]): Promise<SurgeKit> {
  const ids = [...new Set(patchIds)];
  const [module, ...bytes] = await Promise.all([surgeHere(), ...ids.map(surgePatchBytes)]);
  return { module, patches: Object.fromEntries(ids.map((id, at) => [id, bytes[at]])) };
}
