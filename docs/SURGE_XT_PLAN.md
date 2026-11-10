# Surge XT's engine in Discobot: findings and plan

Written 2026-11-10. The owner asked whether Surge XT could be added, and then
for option B (Surge's real engine, not a translation of its patches) to be
looked into thoroughly and planned. Nothing here is built. Stage 0 decides
whether the rest is worth doing.

## Short answer

It can be done, and it is a large job. Surge's sound engine has already been
compiled for browsers by another project, so the hard unknown is not "will it
compile" but "how heavy is it in a browser, and how much has to change round
it". The plan begins with a short trial build that answers that with numbers
before anything is added to the app.

Recommended shape: Surge as **a sound a synth lane can use** (the way a lane
can play a sample instead of the synth), running inside Discobot's own audio
worklet, playing Surge's factory patches with their eight macro knobs. Not a
guest page, and not Surge's own screen.

## What was found

From Surge's source (commit `d307b47`, 2026-11-10) and its issue tracker.

**The engine can be separated from the program.** Surge is two parts: the
sound engine (`surge-common`, plain C++) and the screen and plugin wrappers
(JUCE). The engine is used without a screen already: by Surge's Python
bindings, its test runner, and the VCV Rack modules.

**It has been built for browsers before.** On Surge's issue 8581
("Explore a full-featured WebAssembly port with a new web UI", opened
2026-09-18) a maintainer says Emscripten builds `surge-common` for the browser
now, and that Cardinal (the free modular synth, which has a browser version)
runs it there. Surge-rack's pull request 702 (2022) made one module run in the
browser by using a timer instead of a background thread. The maintainers also
said they will not do a browser port themselves ("pull requests welcome"), and
asked that people contact them with a short human note, not a long generated
document.

**What stands in the way, all found in the source:**

- **Lua.** The Formula modulator and scripted wavetables use LuaJIT, which
  cannot run in a browser. Surge already builds without it
  (`SURGE_SKIP_LUA`, `HAS_LUA=0`), as it does for Windows on ARM. Patches that
  use a formula would play with that modulator silent.
- **Background threads.** Changing patch while playing starts a thread from
  inside the audio loop (`SurgeSynthesizer::process`), and the patch browser's
  database and wavetable scripting run threads of their own. But
  `SurgeSynthesizer::loadRaw(data, size)` loads a patch straight from memory
  with no thread and no file, which is what a browser needs. We would never
  use the patch database.
- **32-bit.** The browser's WebAssembly is 32-bit, and Surge's build refuses
  32-bit targets other than Windows. Its build file says what to switch off
  to get round it (the spring reverb is the known trouble). Cardinal's build
  shows it is possible.
- **Processor features.** Surge is written for SSE4.1 through the SIMDe
  library; browsers have 128-bit SIMD, and Emscripten translates SSE to it.
  An alignment fault was found in an Emscripten build in 2026 (issue 8583,
  in the filter display, which we would not use).
- **Very small numbers.** Desktop audio programs tell the processor to treat
  near-zero numbers as zero, which keeps reverb and filter tails fast. A
  browser cannot. Some patches may cost more processor time as they fade.
  Only a measurement can say how much.
- **Repeatable exports.** Discobot's exports must come out the same every
  time. Surge seeds its randomness from the clock (`srand(time(nullptr))`) and
  from the system (`std::random_device`, in the tape and spring effects, the
  drawn-curve modulator and modulation sources). We would need a small change
  so all of it takes a seed we give. That is a patch we carry, and could
  offer upstream.
- **Blocks of 32.** Surge works 32 samples at a time; the browser asks for
  128, which is four of them. Notes would start on a 32-sample boundary
  (under a millisecond).

**Content and licences.** Surge's code is GPL-3, the same as Discobot's, so
using it is allowed if we publish our changes and say where the source is.
The content is a different matter:

| Content | Files | Size before compression |
|---|---|---|
| Factory patches | 641 | 24.1 MB (a typical patch 31 KB) |
| Factory wavetables | 202 | 6.5 MB |
| Factory impulse responses | 336 | 19.1 MB |
| Third-party patches | 2,922 | 245 MB |
| Third-party wavetables | 731 | 170 MB |
| Third-party impulse responses | 157 | 22.7 MB |

Some third-party content has its own terms: the Voxengo impulses, for
example, may only be passed on whole and unaltered. The repository does not
say in one place what licence the factory patches and wavetables are under.
By the project's rule nothing is bundled until that is checked, so the plan
starts with factory content only, after asking.

## Why a lane's sound, not a guest

A guest (a page in a frame, `GUEST_PROTOCOL.md`) is the usual way to bring in
another instrument, and it was the first idea. It fits Surge badly:

- **A guest is never sent notes.** It plays its own music in time with
  Discobot. Surge has no sequencer, so it would need a new part of the
  protocol before a lane could play it.
- **A guest must live on another site.** Discobot's site is
  `iw978599.github.io`, and every page on it is the same site, so a Surge page
  would need a separate free site somewhere else.
- **A guest can only be exported by playing it through in real time**, and
  only in the browser that has it.

Running the engine inside Discobot's own audio code avoids all three:

- **Notes:** the lane's notes, chords, arpeggiator, automation and MIDI play it
  as they play the built-in synth.
- **Export:** the same compiled engine runs in the export, faster than real
  time and repeatable once seeded, in stems, on the share page and in
  published songs.
- **Live sessions and offline:** it is part of the app, so everyone in a live
  session has it and it works offline.

The risk is that it is one heavy program inside our audio thread. If it
overruns, every lane stutters, not just its own. Stage 0 measures that.

## What a person would be able to do

- Choose **Surge XT** as a lane's sound, as a lane can choose Sample now.
- **Pick from Surge's 641 factory patches** in the preset menu, in their
  categories. A patch downloads (from Discobot's own site) the first time
  it is used.
- **Turn each patch's eight macros**, the knobs Surge's patch designers set up
  for exactly this, on the lane. Automate them, tie them to MIDI knobs, save
  them per scene.
- **Load their own Surge patch file** (`.fxp`). Like an imported sample, it
  is kept in this browser and travels in a saved project file.
- Everything else a lane has stays: level, pan, sends, mute, scenes, Transpose,
  the piano roll.

Not offered, at least at first:

- **Surge's own screen:** it is JUCE and does not run in a browser.
- **Editing a patch's insides:** oscillators, filters and modulation routing.
- **Formula modulation, MPE and tuning files.**
- **Third-party content.**

Surge's sound with its designers' macros is what this gives. Its sound
design is not.

## Stages

Each stage is a pull request, merged when green, as now.

### Stage 0: the trial build (decides go or no go)

Done outside the app, in a small separate folder, and built on GitHub (the
toolchain is free; nothing is installed on this machine beyond what the
workflow does).

1. Pin a Surge commit. Build `surge-common` with Emscripten: no Lua, no
   OddSound MTS, no JUCE, 32-bit guard bypassed, SIMD on.
2. A thin C layer of a dozen functions: make an engine at a sample rate,
   load a patch from bytes, note on and off, pitch bend, a controller, set a
   macro, render so many frames, seed, reset.
3. A Node script renders the init patch and twenty factory patches of
   different kinds (pads, leads, basses, FM, wavetable, plucks) to WAV files.
4. Measure:
   - the size of the WebAssembly file, raw and compressed;
   - the processor time for one voice, and for eight, per patch;
   - the time a patch takes to load;
   - whether two renders with the same seed are identical.
5. A test page (built on GitHub, opened by the owner, not run here) plays a
   patch from the computer keyboard in an audio worklet, to hear it and see
   whether it holds up beside the built-in lanes.

**Go if:**
- the download is a size the owner accepts;
- one Surge lane with eight voices fits comfortably beside the others on an
  ordinary laptop;
- seeded renders repeat.

Otherwise, stop here: the findings go in this file, and option A (translating
patches into Discobot's synth) is still there.

Also look at, in this stage: building Surge as a WCLAP (the plugin standard
CLAP compiled for the web), which a maintainer suggested. If that works it
might be less glue, but it would make Discobot a WCLAP host, which is a larger
decision.

### Stage 1: the build in the repository

- A `surge/` folder: Surge at the pinned commit (a submodule), our small
  patches (the seed, the 32-bit change), the C layer, and a build script with
  a pinned Emscripten version.
- A GitHub workflow, run by hand, that builds it and commits the result.
  Rebuilding is rare, so the built file is committed rather than built on
  every check. A file beside it records the Surge commit and compiler version.
- A licences page in the app (Help) naming Surge XT, its licence, its authors
  and where its exact source is, as GPL-3 asks.

### Stage 2: one lane plays Surge live

- `engine: 'surge'` beside the synth and sample engines, stored the usual way
  (the `add-project-field` skill: optional, absent means as before, checked,
  `SCHEMA` bumped). What is stored is which patch (a factory patch's name, or
  a file's fingerprint) and the eight macro values.
- A `surge-processor` in the worklet. The compiled module is fetched once
  from Discobot's own site and handed in; one engine per lane that uses it.
- Notes, release, pitch bend and the macros arrive as the synth's do, through
  typed worklet messages.
- **A watchdog:** the processor times its own work, and a lane that keeps
  overrunning is muted with a message instead of making every lane stutter.

### Stage 3: export

- The same compiled engine is driven by the export, seeded, block by block.
  WAV, Loop, stems, the share page and published songs all go through it.
- Tests: Surge lanes repeat sample for sample; a project without a Surge lane
  renders bit for bit as before.

### Stage 4: patches and controls

- **Factory patches:** packed and compressed into a few category files, each
  downloaded on first use and kept by the service worker. Shown as a "Surge XT"
  group in the preset menu.
- **The eight macros:** knobs on the lane, named as each patch names them, with
  automation, Auto, MIDI Learn and per-scene sounds.
- **Your own `.fxp`:** imported like a sample (stored by fingerprint, carried
  in project files, not synced). A project naming a file this browser does
  not have says so, and the lane stays silent rather than guessing.

### Stage 5: live sessions, phones and finishing

- Live sessions carry the patch and macros as any sound edit. A patch file
  only one person has plays only for them, as a sample does now.
- **Phones:** measured on GitHub's phone-width runs and by the owner by ear. A
  phone may only manage one Surge lane.
- **Docs:** AGENTS.md, a topic file under `docs/agents/`, the roadmap.

## Effort

Stage 0 is the only part that can be estimated with confidence now: a few
sessions. The rest depends on its numbers. As a guide, if the build behaves,
stages 1 to 3 are each about the size of the timeline's stages, and stage 4
about one and a half of them. Things that would make it larger:
- patches that sound wrong in the browser build;
- a processor cost that needs Surge's code trimmed;
- licences for the factory content that need asking about patch by patch.

## What it costs

Nothing:
- Emscripten and GitHub's checks are free for a public repository.
- The engine and patches are served from Discobot's own site, the way the
  app's own files are now.
- No new outside service gets any data. The app makes no new requests to
  other sites.

## Decisions for the owner

1. **Go ahead with stage 0?** It changes nothing in the app.
2. **Lane sound or guest:** the recommendation is a lane sound (above).
3. **Contacting the Surge team:** a short note from you, in your own words,
   would be welcomed more than a generated one. It's worth asking two things:
   what licence the factory patches and wavetables are under, and whether they
   would take the seeding change upstream.
4. **Download size:** what you would accept for the engine plus the first
   patches, once stage 0 has measured it. It is only downloaded when a lane
   first uses Surge.

## Sources

- Surge XT source: https://github.com/surge-synthesizer/surge (commit
  `d307b47`): `CMakeLists.txt`, `src/common/CMakeLists.txt`,
  `src/common/SurgeSynthesizer.cpp` and `SurgeSynthesizerIO.cpp`,
  `src/common/SurgeStorage.h`, `resources/data/`
- Issue 8581, WebAssembly port: https://github.com/surge-synthesizer/surge/issues/8581
- Issue 8583, an Emscripten alignment fault: https://github.com/surge-synthesizer/surge/issues/8583
- Surge-rack pull request 702: https://github.com/surge-synthesizer/surge-rack/pull/702
- Earlier plugin plan: `docs/INSTRUMENT_PLUGINS_PLAN.md`
