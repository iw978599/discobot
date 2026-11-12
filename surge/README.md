# Surge XT's engine, built for Discobot

[Surge XT](https://github.com/surge-synthesizer/surge) is a free and open-source synthesizer by
the Surge Synth Team, under the GNU General Public Licence v3 or later. This folder builds its
sound engine for the browser, so a Discobot lane can play it. The plan, the findings and the
stages are in [`docs/SURGE_XT_PLAN.md`](../docs/SURGE_XT_PLAN.md).

- `SURGE_COMMIT`: the commit of Surge XT that is built. The exact source is that commit of
  https://github.com/surge-synthesizer/surge, with the changes below.
- `bridge/`: a few plain C functions over Surge's engine (make one, load a patch, play notes,
  render), and the build target that exports them.
- `shim/`: two headers the build adds. `execinfo.h` stands in for crash backtraces, which a
  browser lacks; `discobot_seed.h` declares what Surge's random number generators are seeded
  with in place of the clock.
- `build.sh`: fetches the source, makes Discobot's changes (each one checked), and builds with
  Emscripten. The changes are:
  1. a Linux-only linker option is removed;
  2. where Surge asks which file it is running from, it is given a fixed path;
  3. Surge's random number generators are seeded from the bridge, not the clock, so a render
     can be repeated;
  4. `shim/execinfo.h`;
  5. the bridge answers `getentropy` from the same seed.
- `dist/`: the built engine (`surge-engine.wasm`, `surge-engine.js`), `BUILD.json` (the Surge
  commit, the compiler, and each file's SHA-256) and `licences/` (the licence of Surge and of
  each library in its source tree).

## Building

The workflow `.github/workflows/surge-build.yml` builds on any branch that changes this folder,
tests the result (`ui/test/surgeEngine.test.ts`), and fails if `dist/` is not what the source
builds. To change the engine:
1. Change the source here.
2. Push, and let the workflow build it.
3. Download the run's `surge-engine` artifact.
4. Copy its `surge-engine.wasm`, `surge-engine.js`, `BUILD.json` and `licences/` into `dist/`,
   and push again.

To build by hand on Linux, with Emscripten 4.0.10 active:
`bash surge/build.sh /tmp/surge-work /tmp/surge-built`.

Nothing here is part of the app yet: stage 2 of the plan brings the engine into it.

## Discobot's own patches

Surge's factory patches do not ship: their licence has not been settled. The patches Discobot
offers are its own, written in `patches/` as Surge's blank patch plus a list of parameters by
their saved names and the values Surge shows for them, and each macro's name and what it moves.
`node surge/patches/make.mjs` makes each into `ui/public/surge/patches/<name>.fxp` with the
built engine, reading every value back and stopping on any Surge did not take as written. A
type (an oscillator's, a filter's) is set first and takes effect on the next block, then the rest.
`ui/test/surgePatches.test.ts` fails unless each file is exactly what its definition makes.
After changing a definition, or the engine, run the script and commit the files.

There are nine (2026-11-11): Punk Bass and Clipped Stab, made for Edge of the Room, then Sine Sub,
Acid Line, Sync Lead, Supersaw, Wide Pad, Plucked String and FM Bell, one for each kind of part a
song needs. Each names two macros. What to know when writing one:
- A macro is the only modulation a definition can route (the bridge has no LFO or envelope
  routing), so a patch moves only through its macros and their automation.
- Surge cannot read a time between 0 and its shortest step (an attack of 1 ms): write 0 or 4 ms.
- Levels were set by measuring, not by ear: a three-note chord and single low and high notes, with
  the macros down and up, against Punk Bass. `surgePatches.test.ts` holds every patch between 0.05
  and 0.9 for a chord at full velocity, macros down and up.
- `ui/src/services/surgePatches.ts` lists what the app offers, and the test fails unless that list
  is exactly these definitions, with their names and their macros' names.
