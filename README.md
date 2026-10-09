# Discobot

A browser-only music workstation: up to three synths, 16/32-step sequencing,
piano-roll editing, an eight-instrument drum machine, MIDI and shared effects.
Everything runs in your browser and no login is required.

An account is optional: a username and a password, by invitation, with no email
address or personal details. Signed in, projects are also kept in the account and follow it to other
browsers; imported samples are not. The accounts API is
in `server/` (see `server/README.md`).

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

The screen is one rack, read top to bottom: the transport, three synth lanes,
the drum grid, then the shared effects. Every lane's steps line up, so you can
see how the parts sit against each other.

1. Click a keyboard key or Play to unlock browser audio; start with low output volume.
2. Click a synth lane's name plate to open its editor. Select a step in its row
   and play a note onto it, or paint notes in the piano roll. Each lane has four
   knobs and a level on its face; the editor's tabs (Notes, Osc, Filter, Amp,
   LFO, Arp, Sends) hold the rest of the sound.
   The computer keyboard plays the selected synth: the A S D F G H J K L row is
   the white keys, W E T Y U O P the black keys, and Z / X shift the octave.
   Tap tempo is Shift+T.
3. Click cells in the drum grid to add hits, and select a kit. The strip under
   the grid edits the instrument and step you last touched.
   Each drum step has a velocity, a chance of playing, and a repeat count that
   packs up to four hits into the step.
4. Use Play All / Stop All, shared tempo and the mixer. Effects sends feed
   drive, phaser, delay and reverb; a send and its return must be audible.
5. Build a song from scenes. A scene is one bar of everything: all three
   lanes' notes and the drum grid. Add scenes with + Copy or + Empty, then add
   them to the song in order and set how many times each repeats. The Scene /
   Song switch chooses whether Play loops the open scene or plays the song from
   the marked block; in song mode the rack follows along. Sounds, tempo and
   effects are shared by every scene.
6. Your work saves itself. The Project menu starts a new project, keeps a
   copy, makes a share link, and holds project files and MIDI import; the
   Export menu holds the audio and MIDI exports. MIDI controller settings
   and imported samples are behind the MIDI button.

### Local data

You can keep any number of projects. Click the project's name in the top row to
see them all, and to open, rename, copy or delete one. The open project saves
itself as you work; **Save a Copy** keeps a version to go back to. Every project
is stored in **IndexedDB**, and the open one also has a working copy in
**localStorage** so nothing is lost when a tab closes. Imported sample bytes and
metadata are stored in IndexedDB, then decoded locally for playback.
Nothing is uploaded. Storage is specific to the browser profile and origin:
localhost ports and the deployed site do not share projects. Clearing site data,
private browsing or storage quotas can remove/prevent persistence. Storage errors
are reported in the UI; local storage is not a backup. Edits are saved a moment
after you stop changing things, and immediately when the tab is closed or hidden.
If the same project is changed in a second tab, the first tab stops saving and
asks which version to keep, so neither silently overwrites the other.

**Export Project** downloads the open project as one JSON file: lanes, drums,
scenes, song, effects and your synth presets. **Import Project** adds a file to
your projects as a new one and opens it; nothing is replaced.

**Share Link** makes a link with the whole song inside it. Whoever opens it gets
a page that plays the song and can keep their own copy to edit. Nothing is
uploaded and no account is involved, so a link cannot be taken back once sent,
and very large projects do not fit in one. Use the pair as a backup or to move
to another browser or device. Imported samples are not part of the file.

The site is installable and works offline. A service worker caches the built
app on first visit; after that it opens with no connection. It checks the
network first for the page itself, so a new release appears on the next visit
while online.

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
- **Download WAV:** render the current arrangement locally to a stereo audio file:
  one bar followed by its effect tail. The export runs the same synth and drum
  code as live playback, offline.
- **Song WAV / Song MIDI:** the whole song from start to finish. The MIDI file
  has a marker at the start of each section. Song audio is limited to 8 minutes.
- **Loop WAV:** exactly one bar that repeats seamlessly. The pattern is rendered
  for several bars and the last one is kept, so reverb and delay tails from the
  end of the bar are already present at its start.
- **Stems:** a zip with one WAV per synth lane that has notes (muted or not)
  and one for the drums. All stems are the same length and line up.
- Drum steps with a chance below 100% are decided by a fixed random sequence in
  WAV and MIDI export, so the same project always exports the same file.

### Audio implementation

- One synth voice core (`engine/src/synth/SynthCore.ts`) runs both in the
  AudioWorklet and in WAV export. Each of its eight voices has two band-limited
  oscillators plus sub and noise, a zero-delay-feedback state-variable filter
  with drive, separate exponential amp and filter envelopes, key tracking,
  velocity-to-filter accent, two LFOs (retriggered or free-running) and a
  four-operator FM mode. Mono mode glides between tied (slide) steps.
- Unison stacks up to five detuned copies of the oscillators on each note. The
  filter has a 12 dB and a steeper 24 dB per octave slope. Each synth lane has a
  Duck amount that pulls it down on every kick and lets it swell back
  (sidechain-style pumping); it is applied the same way in WAV export.
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
