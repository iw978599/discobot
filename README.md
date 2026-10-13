# Discobot

A music workstation that runs in the browser: three synth lanes, a step
sequencer with a piano roll, an eight-instrument drum machine, scenes and a
song, shared effects, MIDI, and audio export. Sound is made on your own device.
No login is needed.

**Use it at https://iw978599.github.io/discobot/**

It installs as an app and works offline once it has been opened. On a phone,
and on Kindle and Fire tablets, it shows one part of the rack at a time with
controls sized for a finger.

## What is in it

**Three synth lanes.** Each plays one of twenty synth models: a plain engine
with every control on show, and nineteen set up in the manner of a well-known
instrument, each with four knobs of its own.

| Mono | Poly | Digital |
|---|---|---|
| Minimoog Model D, TB-303, SH-101, Pro-One, Mono/Poly, MS-20, Odyssey | Juno-106, Prophet-5, Jupiter-8, OB-Xa, Polysix, CS-80 | DX7, JP-8000, Virus, M1, D-50, Wavestation |

A model is this synth's own voice set up to behave like the instrument it is
named for. It is not that instrument's circuit and uses none of its samples.
The M1, D-50 and Wavestation, and the drums' cymbals, play recordings and waves from two free
libraries, VSCO 2 Community Edition (Versilian Studios, with an upright piano
sampled by Simon Dalzell of Ivy Audio) and Adventure Kid Waveforms (Kristoffer
Ekstrand), both in the public domain; `docs/BUNDLED_AUDIO.md` has the details.

**Seventy-six presets** in six kinds: bass, lead, pad, keys, pluck and effects.
They are level-matched, so choosing another does not mean reaching for the
volume. You can save, export and import your own, including presets from some
other synths.

**A drum machine** with eight lanes and eight kits (Clean, Punchy, Lo-Fi,
TR-808, TR-909, LinnDrum, DMX, TR-707). The drums are synthesized, except the
cymbal lane, which plays a recording of a real crash, ride, bell or splash.
Any lane can play a sample of your own instead of its built-in voice, and a
whole kit can be imported at once.

**Scenes and a song.** A scene is every lane's pattern plus the drum grid,
one, two, four or eight bars long. A song is scenes in order, each repeated as many times as
you like. Scenes can be given a colour so a song's shape reads at a glance.

**Effects** shared by the whole rack: drive, phaser, delay (free or in time
with the tempo), chorus, reverb and a three-band master EQ. Each lane and the
drums have their own sends.

**Guest instruments.** A project can host another creator's web instrument in
a frame, following the tempo and playing through the mixer. See
`docs/GUEST_PROTOCOL.md` to make one.

**Kids mode.** Big pads, a beat grid of pictures and one play button, for a
small child. It keeps its own tune and is reached from the Project menu.

## Make music

The screen is one rack, read top to bottom: the transport, the scenes and
song, three synth lanes, the drums, then the effects. Every lane's steps line
up, so you can see how the parts sit against each other.

1. **Start.** A new project offers three beats to start from (House Beat, Slow
   Groove, Electro), or build from nothing. Press Play, or the space bar.
   Browser audio starts on your first click or key; begin with the volume low.
2. **Play a synth.** Click a lane's name to open its editor. Pick a model and a
   preset. Select a step in the lane's row and play a note onto it, or switch
   from Keys to Roll and paint notes in the piano roll.
   - A step can hold a chord of up to six notes and last several steps.
   - Each step has a velocity, a chance of playing, a repeat count, and can sit
     a little late, between steps.
   - The computer keyboard plays the selected lane: the A S D F G H J K L row
     is the white keys, W E T Y U O P the black keys, Z and X shift the octave.
     Tap tempo is Shift+T.
3. **Shape the sound.** Each lane has four knobs and a level on its face. The
   editor's tabs (Notes, Osc, Filter, Amp, LFO, Arp, Sends) hold the rest. Turn
   a knob by dragging, with the scroll wheel, or by typing its value. A click
   of the middle mouse button puts a knob back at its default.
4. **Add drums.** Click cells in the drum grid and choose a kit. The strip
   under the grid edits the drum and step you last touched: velocity, chance,
   and up to four hits packed into one step.
5. **Build a song.** Add scenes with + Copy or + Empty, add them to the song
   in order, and set how many times each repeats. The Scene / Song switch
   chooses whether Play loops the open scene or plays the song through.
   Sounds, tempo and effects are shared by every scene; notes, drum hits and
   mutes belong to each scene.
6. **Undo** and **Redo** cover notes, drums, sounds, tempo and effects.

The **?** button has a fuller guide and a walkthrough of the rack.

## The synth voice

One voice implementation (`engine/src/synth/SynthCore.ts`) plays live and
renders exports, so both sound the same. Each of its eight notes has:

- two band-limited oscillators, a sub and noise, each with its own level; the
  second can be hard-synced to the first, and the two can be ring modulated;
- rates that can follow the tempo: both LFOs, and in the effects the delay,
  the phaser and the chorus;
- up to seven detuned copies stacked on a note (unison), with a level for the
  copies either side of the middle one;
- an optional second layer: the note played again on another voice, tuned,
  filtered, faded in and placed differently, which halves the notes that can
  sound at once to four;
- a four-operator FM mode;
- a sample mode: an imported sample, or one of the sounds that come with the
  app (a piano, a marimba, an organ, a voice, four recorded attacks and four
  sequences of waves), played up and down the keyboard in place of the
  oscillators;
- a high-pass, then a filter that can be a clean 12 or 24 dB state-variable
  filter, a four-pole ladder whose resonance thins the bass and rings by
  itself, or a two-pole in the manner of an MS-20 whose resonance distorts as
  it is pushed;
- separate envelopes for level and filter, key tracking, and velocity to level
  and filter;
- two LFOs, free or in time with the tempo;
- four modulation routes: an LFO, an envelope, velocity, key or a stepped
  random value, sent to pitch, the second oscillator's pitch, the filter, the
  level, pulse width, pan or FM amount;
- mono mode with glide between tied steps, and an arpeggiator, which runs a
  chord through its own notes and a single note through its octaves.

Each lane has a Duck amount that pulls it down on every kick and lets it swell
back; it is applied the same way in an export.

One drum implementation (`engine/src/drums/DrumCore.ts`) likewise plays live
and renders exports. Voices are mixed with no saturation, so drums that land
together keep their levels. The LinnDrum, DMX and TR-707 kits are synthesized
approximations of those sample-based machines.

Noise and every random choice in an export are seeded, so the same project
always exports the same audio.

**None of this is a claim of exact emulation of vintage hardware.** The models
and presets were designed from each instrument's documented architecture and
checked by measurement; the owner has listened to most of them, and the most
recent additions have not been heard by anyone yet (`docs/HANDOFF.md` says
which).

## Projects and your data

You can keep any number of projects. Click the project's name in the top row
to see them all. A project and the copies the app names after it ("copy",
"2", "this browser's version") share one row, with a chooser for which one to
open, rename, copy or delete.

- **It saves itself** a moment after you stop changing things, and at once
  when the tab is closed or hidden. A word beside the project's name says
  where the work is.
- **Version History** keeps up to twenty earlier versions of each project, in
  this browser only.
- **Export Project** downloads the open project as one file: lanes, drums,
  scenes, song, effects, your presets and the samples its lanes use.
  **Import Project** adds a file as a new project; nothing is replaced.
- Projects live in the browser's own storage (IndexedDB, with a working copy
  in localStorage). That storage belongs to this browser on this device:
  clearing site data or private browsing removes it, and it is not a backup.
  Export the projects you care about.
- If the same project is changed in a second tab, the first stops saving and
  asks which version to keep.

### Sharing

- **Share Link** makes a link with the whole song inside it. Whoever opens it
  gets a page that plays the song and can keep a copy to edit. Nothing is
  uploaded and no account is involved, so such a link cannot be taken back,
  and a very large project does not fit in one.
- Signed in, a song can instead be **published** behind a short link, which
  can be unpublished again, and each person has a page listing the songs they
  have published.

### Accounts (optional)

An account is a username and a password, by invitation, with no email address
or personal details. Everything works without one.

Signed in, the projects you make, and any earlier ones you add, are also kept
in the account and follow it to other browsers. Nothing is merged: a project changed in two places is kept
twice. A project can be shared with another account by username, to work on in
turns. Imported samples are not synced. The accounts service is in `server/`
(see `server/README.md`).

## MIDI and audio files

- **MIDI in.** Play a lane from a controller: choose the device, channel,
  lane, and whether notes play live, record, or step in. This needs a browser
  with Web MIDI (Chrome or Edge), HTTPS or localhost, and permission. Where it
  is not available the panel says so, and everything else still works.
- **MIDI out.** The sequencer can play a hardware synth and send it clock:
  lanes on channels 1 to 3, drums on channel 10.
- **Import MIDI.** Bring notes and tempo in from a `.mid` file.
- **Scene WAV / Scene MIDI.** The open scene as audio (with its effect tail)
  or as a Standard MIDI File.
- **Song WAV / Song MIDI.** The whole song, start to finish. Song audio is
  limited to eight minutes; the MIDI file has a marker at each section.
- **Loop WAV.** One pass of the scene that repeats seamlessly, with reverb and
  delay tails from its end already present at its start.
- **Stems.** A zip with one WAV for each synth lane, the drums, and each guest
  instrument, all the same length.

A guest instrument cannot be rendered offline, so an export that includes one
first plays the arrangement through and records it.

## For developers

```
discobot/
├── engine/    # The synth and drum DSP, and the shared types
├── ui/        # React + Vite: the rack, Web Audio, projects and samples
└── server/    # The optional accounts service: a Cloudflare Worker with a D1 database
```

Three npm workspaces. The app builds to a static site in `ui/dist/` and never
depends on the server: signed out, it makes no request to it at all.

Use **Node.js 22+** from the repository root:

```bash
npm ci
npm run dev            # the app, at http://localhost:3000/discobot/
npm run build          # build the engine and the app
npm start              # preview the built app, at http://localhost:4173/discobot/
npm run dev:api        # the accounts service, in memory, at http://127.0.0.1:8787
```

Checks:

```bash
npm run typecheck
npm test               # unit tests: the engine, the app's services, the server
npm run test:browser   # Playwright, against the built app and a local accounts service
```

The same checks run on GitHub for every pull request, with the browser tests
at desktop and phone widths. A merge to `main` publishes the site once they
pass.

Automated checks cannot judge how something sounds, and nobody has tested the
app against every browser, device or piece of MIDI hardware. The unit tests do
measure what can be measured: that presets of a kind are about as loud as each
other, that filters have the slopes they claim, that an older project plays
sample for sample as it did.

Further reading:

- `AGENTS.md`: how the code is organised and the rules a change must keep.
- `docs/ROADMAP.md`: what is done and what is planned.
- `docs/SYNTH_MODELS_PLAN.md`: the synth models, and where each differs from
  its namesake.
- `docs/GUEST_PROTOCOL.md`: how to make a guest instrument.
- `docs/CONTROL_AUDIT.md`: what the tests cover.
