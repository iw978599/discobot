# Discobot

A browser-only music workstation: up to three synths, 16/32-step sequencing,
piano-roll editing, an eight-instrument drum machine, MIDI and shared effects.
No Discord account, backend, API keys or login is required.

## Architecture

```
discobot/
├── engine/    # Browser-compatible TypeScript DSP and shared types
└── ui/        # React + Vite, Web Audio, local project/sample services
```

Two npm workspaces build to a static site in `ui/dist/`. Project operations and
events run in-process; there is no REST server or WebSocket connection. Sound is
generated locally and played through the browser's Web Audio API.

## Run locally

Use **Node.js 22+** and npm from the repository root:
```bash
npm ci
npm run dev
```

Open **http://localhost:3000/discobot/**. To preview the production build:

```bash
npm run build
npm start
```

Open **http://localhost:4173/discobot/**. `npm start` is Vite's static preview,
not an application backend. The build's asset base is `/discobot/`.

## Make music

1. Click a keyboard key or Play to unlock browser audio; start with low output volume.
2. Select a synth step and assign a note, or paint notes in the piano roll.
   Adjust velocity, oscillator, filter, ADSR, LFOs and arpeggiator controls.
3. Add drum steps, select a kit, and adjust track settings, swing, mute/solo and mix.
4. Use Play All / Stop All, shared tempo and the mixer. Effects sends feed
   drive, phaser, delay and reverb; a send and its return must be audible.
5. Save a named pattern; load or delete it through the pattern manager.

### Local data

Project state and named patterns are stored in **localStorage**. Imported sample
bytes and metadata are stored in **IndexedDB**, then decoded locally for playback.
Nothing is uploaded. Storage is specific to the browser profile and origin:
localhost ports and the deployed site do not share projects. Clearing site data,
private browsing or storage quotas can remove/prevent persistence. Storage errors
are reported in the UI; local storage is not a backup.

### MIDI and audio files

- **MIDI input:** select a device, channel, target synth and live/record/step mode.
  Hardware input requires Web MIDI support, a secure context (HTTPS or localhost)
  and permission. Unsupported browsers show an explanation instead of unusable
  device controls; use the on-screen keyboard or import a file instead.
- **Import MIDI:** choose a `.mid` file and a track; imported notes and detected
  tempo are mapped to the sequencer. MIDI file import/export does not require
  Web MIDI or a connected controller.
- **Export MIDI:** download a Standard MIDI File containing synth lanes, tempo
  and drums on channel 10. MIDI stores note events, not synthesized audio.
- **Export WAV:** render the current arrangement locally to a stereo audio file.
  The export runs the same synth and drum code as live playback, offline.

### Audio implementation

- One synth voice core (`engine/src/synth/SynthCore.ts`) runs both in the
  AudioWorklet and in WAV export. Each of its eight voices has two band-limited
  oscillators plus sub and noise, a zero-delay-feedback state-variable filter
  with drive, separate exponential amp and filter envelopes, key tracking,
  velocity-to-filter accent, two LFOs (retriggered or free-running) and a
  four-operator FM mode. Mono mode glides between tied (slide) steps.
- One drum core (`engine/src/drums/DrumCore.ts`) runs in the worklet and in
  export. Voices are mixed linearly with no per-hit or bus saturation, so drums
  that land on the same step keep the level their volume and velocity ask for.
  The 808-style kits use six detuned square oscillators for hats and cymbals;
  LinnDrum, DMX and TR-707 kits approximate those sample-based machines by
  reducing the voices to their converter's bit depth and sample rate.
- Noise is seeded, so the same arrangement always exports the same audio.
- Audio-clock look-ahead sequencing rather than network-delivered audio.
- Parallel effects sends preserve the dry signal when effects are bypassed;
  the phaser mixes a dry tap with its all-pass stages.
- The master bus has a peak limiter and a soft ceiling that only act near full
  scale; below that the mix passes through unchanged. Sample previews use the
  same output with short boundary fades.

These are implemented DSP safeguards, not a claim of listening-verified quality
or exact emulation of vintage hardware.

## Validation

Existing checks: `npm run typecheck`, `npm test`, and `npm run test:browser`.
See [the control audit](docs/CONTROL_AUDIT.md) for coverage and remaining limits.
Automated browser/DSP checks do not verify subjective sound quality, real MIDI
hardware or every browser/device; those require listening and hands-on testing.

## GitHub Pages publication

**Publication is not confirmed.** Repository metadata reported `has_pages: false`,
the expected site's DNS lookup failed, and browser-only PR #58 was still unmerged
when checked. No Pages-settings write API is available in this task.

Remaining maintainer steps:
1. Merge the approved browser-only PR into `main`.
2. In **Settings → Pages → Build and deployment → Source**, select **GitHub Actions**.
3. Run **Publish GitHub Pages** on `main` and confirm its deployment succeeds.

Expected URL: **https://iw978599.github.io/discobot/** — this is not a claim that
the site is already published.
