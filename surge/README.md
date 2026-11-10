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
