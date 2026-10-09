# Plugins and third-party instruments: feasibility and plan

Written 2026-10-09. The question: can Discobot import VST plugins, and can
other creators link their own instruments into it?

## Short answer

- **Importing VST plugins: not possible.** Not hard, not expensive: not
  possible, in any browser.
- **Letting creators link instruments: possible**, in several forms. For a
  creator who already has a web instrument of their own, option E (guest
  apps) is the one that fits.

## Why VSTs cannot be imported

A VST (also VST3, Audio Units, AAX, CLAP) is a program compiled for Windows,
macOS or Linux. A `.dll` or `.vst3` file contains machine code that expects to
be loaded into a desktop music program and to call the operating system
directly.

A web page cannot load or run that. Browsers have no way to do it and will not
get one, because running arbitrary native code from a web page is exactly what
browser security exists to stop. A desktop helper app that hosts VSTs and
streams audio to the page is technically possible, but it stops Discobot being
a web app: every user would install software, and it would not work on phones.
I do not recommend it.

The one route from a VST to the web belongs to the plugin's author, not to us:
they can rebuild their plugin from its source code for the web. The common
plugin toolkits (JUCE, iPlug2, DPF) support this. If an author does that, the
result is one of the web formats below, and we can load it.

## What can work

### A. Sound presets for Discobot's own synth (small)

A preset is already a small block of settings. Sharing one needs a "share this
sound" link or file, the same way a song is shared now.

- **Safe:** it is data, checked on the way in like a project file.
- **Limit:** it can only do what Discobot's synth can do.
- **Effort:** about a day.

### B. Sample instruments: SFZ and SoundFont (medium to large)

Most free instrument libraries (pianos, strings, drum kits, old samplers) are
distributed as recordings plus a text file saying which recording plays for
which key. The two common formats are SFZ and SoundFont (`.sf2`).

- **Needs:** a sampler voice in the engine. That is already on the roadmap as
  "samples on the drum grid and as a synth source", so this builds on work we
  want anyway.
- **Safe:** recordings and a text file. Nothing runs.
- **Limits:** files are large (a few megabytes to hundreds). They would live
  in the browser like imported samples do now and would not sync to accounts
  on the free Cloudflare plan. We would support the common subset of each
  format, not every feature.
- **Effort:** one to two weeks for a sampler with SoundFont and basic SFZ.

### C. Web Audio Modules (not recommended for open use)

Web Audio Modules (WAM) is an existing plugin standard for browsers. A plugin
is JavaScript, hosted at a web address, and a host page loads it by that
address. A catalogue of a few hundred exists, including web ports of known
synths. On paper this is exactly "creators link their instruments".

The problem is what a WAM is: **someone else's JavaScript running inside
Discobot's page**. It could read every project in the browser and the
signed-in session, and send them anywhere. The usual fix is to run it in a
sealed frame on another address, but audio from a sealed frame cannot be
passed through Discobot's effects or included in a WAV export.

It also breaks two rules the app keeps today: no requests to other sites, and
everything works offline.

It could be offered later as "load a module from an address you trust", with a
plain warning, for the user's own use. It should not be the way strangers'
instruments get into shared songs.

### D. A Discobot instrument format built on WebAssembly (large, recommended)

WebAssembly is compiled code that browsers run in a sealed box. A WebAssembly
file given no connections to the page **cannot read storage, cannot use the
network and cannot touch the screen**. It can only do arithmetic on the memory
it is handed. That is the property we need: creators get real freedom to write
their own sound code, and a hostile instrument can do nothing but make noise.

A Discobot instrument would be two things:

- **A small description file:** name, author, version, and a list of knobs
  (name, range, default).
- **One WebAssembly file** exposing a handful of fixed functions: start, note
  on, note off, set a knob, and "fill this buffer with the next block of
  sound".

How creators would make one:

- **Faust**, a language built for writing synths, compiles straight to
  WebAssembly. This is the easiest path and the one to document first.
- **Rust, C or C++**, for people porting existing sound code, including the
  inner sound code of an open-source VST (the code, not the VST file).

Why this fits Discobot specifically:

- The app already runs its synth as one core used by both live playback and
  WAV export. A WebAssembly instrument slots into the same place, so export
  works and matches what was heard.
- It is a single file, so it stores in the browser, works offline and can be
  identified by a fingerprint of its contents.

What it cannot do, at least at first: draw its own interface (it gets
Discobot's knobs), load its own samples, or act as an effect.

Risks and how they are handled:

- **A badly written instrument can use all the processor time** and make the
  whole app stutter. The app would measure each block, switch off an
  instrument that keeps overrunning, and say so.
- **Memory:** capped when the file is loaded.
- **Size:** capped (about 1 MB to start).
- **Effort:** about two weeks for a working prototype with one Faust example,
  then about as long again for knobs, presets, export and the safety limits.

### E. Guest apps: a creator's own web instrument, hosted in Discobot (medium, recommended first)

Added after looking at the example the owner gave:
[Choir](https://github.com/aaronvandorn/Choir), a generative choral
synthesizer by Aaron Van Dorn (MIT licence).

Choir is not a plugin in the sense of A to D. It is a complete web page: its
own sound engine built from the browser's audio building blocks, its own
melody and rhythm generator, and its own screen of controls. None of the
formats above can hold it. Samples cannot (it is generated live), and the
WebAssembly format cannot without the creator rewriting it and losing its
interface.

What fits is to **host the creator's page inside Discobot as a rack unit**,
in a frame, and connect the two with a small set of messages.

Why this is safe: a frame loaded from the creator's own address is kept apart
from Discobot by the browser. It cannot read projects or the signed-in
session. That is the protection option C lacks.

What Choir already has that makes this practical:

- **A sync protocol** ("Jam Link"): messages for tempo, start and stop, key
  and mode, and for saving and recalling its state as a "scene". It keeps
  time against the computer's clock, which a frame and its host share.
- **A tap on its own audio output**, used for its export feature.
- **Its page can be framed.** Its host sends nothing that forbids it.

What is missing, on the creator's side: Jam Link only talks to pages at the
same address. It needs one more way to send its messages, to the page that
frames it, and to pass its audio out the same way. That is a small addition
to code the creator already wrote, in a block shared by all three of their
apps, so one change would bring in all three.

What Discobot would build:

- **A guest unit in the rack**: paste an address, and the page appears as a
  module with its own controls.
- **Sync out**: tempo, play and stop, and key sent to the guest.
- **Audio in**: the guest's sound arrives in Discobot's mixer, so it gets a
  level, the shared effects, mute and solo.
- **State in the project**: each Discobot scene asks the guest for its state
  and stores it, and recalls it when the scene plays. This maps directly onto
  Jam Link's scenes.

Limits, which are real:

- **WAV export.** Discobot renders exports faster than real time, and a guest
  cannot do that. A guest lane would be **recorded in real time** into the
  project first ("freeze"), and the export uses the recording.
- **Generative guests do not repeat.** Choir changes its melody on each pass,
  so two playbacks differ. The frozen recording is the only fixed version.
- **Latency.** Audio crossing from the frame arrives a few tens of
  milliseconds late. The guest can be told to play that much early; Choir
  already has a setting for this.
- **It contacts the creator's site** every time the project opens, and does
  not work offline.
- **It depends on the creator.** If their page changes or disappears, the
  lane changes or goes silent. The frozen recording still plays.
- **Share links** carry the guest's address and state, not its sound. Someone
  opening the link would be asked before the guest is loaded.

Effort: about two weeks on Discobot's side for the unit, sync, audio and
freeze. On the creator's side, a day or less, and it needs their agreement.

**Progress (2026-10-09).** Discobot's side is built except for freeze:
Project → Add Guest Instrument, the rack unit, transport and tempo sync,
audio into the mixer with level and mute, settings saved in the project, and
asking before loading a guest that arrives with someone else's song. The
protocol is `GUEST_PROTOCOL.md`, a working example guest is
`guest-example.html`, and `GUEST_PROMPT_FOR_JAM_LINK_APPS.md` is a prompt the
creator of Choir can give to Claude to add the guest side. The creator of Choir has since added guest support to four instruments
(Choir, Logic Rhythm, Boolean Melody Machine, Tape Loop Deck), and with
permission they are offered by name in the Add Guest dialog. Download WAV and
Song WAV now record guests by playing through once. A guest's settings are kept per scene and follow a song from scene to scene.
Not built: guests in loops and stems, effect sends for a guest, and a way for
a guest to save audio of its own (Tape Loop Deck's loops) with the project.

## How creators would link an instrument

In two stages, the second only if the first gets used.

### Stage 1: by file or by address (no server work)

- A user drops in an instrument file, or pastes its address. The app fetches
  it once, checks it, and keeps it in the browser. After that it works
  offline. (The creator's host must allow other sites to fetch the file;
  GitHub Pages does.)
- A project records which instrument each lane uses: its name, author,
  fingerprint and where it came from.
- **Opening a shared song that uses an instrument you do not have:** the app
  says "This song uses *Name* by *Author*, from *address*. Load it?" If you
  say no, or it is gone, that lane plays on the built-in synth and says so.
  The fingerprint means that what loads is the exact file the song was made
  with, or nothing.

This is the only stage where the app would contact another site, and only
when the user says yes. The "no outside requests" rule would become "none
without being asked".

### Stage 2: a directory (needs the server)

- A signed-in creator publishes an instrument. It gets a page with its name,
  author and description, and an **Add to Discobot** button.
- You, as owner, can remove one.
- Storage: instrument files are small enough for the current free database up
  to a point, but a real directory wants Cloudflare's file storage, which
  needs a payment card on the account even though usage would be free.

## What we take on

- **Security review** of the loader. The sealed box is only sealed if we
  connect nothing to it; that needs to be right the first time.
- **Other people's rights.** Sample libraries and ported sound code have
  licences. A directory needs a "you have the right to share this" statement
  and a way to take things down.
- **Songs that depend on things we do not host.** If a creator deletes their
  file, songs using it fall back to the built-in synth. Stage 2 fixes that for
  instruments published to the directory.
- **Support.** "My instrument does not work" becomes a question people ask.

## Recommended order

1. **E: guest apps**, if instruments like Choir are the goal. It is the only
   option that brings in a creator's existing web instrument whole, and it
   needs the least from them. Start by agreeing the message format with one
   creator.
2. **A: preset sharing.** A day. Useful immediately and tests the "open a
   shared thing" flow.
3. **B: the sampler**, with drum-lane samples first, then SoundFont and SFZ.
   Already wanted, and it opens the largest library of existing instruments.
4. **D: WebAssembly instruments, stage 1.** Start with a prototype to confirm
   processor cost and export behaviour before committing to the format.
5. **D stage 2: the directory**, if people are making instruments.
6. **C: Web Audio Modules**, only as an opt-in for the user's own trusted
   modules, if anyone asks.

## Decisions for you

1. Which matters more: **existing instruments** people already have (points to
   B, the sampler) or **new instruments made for Discobot** (points to D)?
2. Is contacting another site, when the user says yes, acceptable? Stage 1
   linking depends on it.
3. Would you add a payment card to Cloudflare for file storage (free at this
   scale)? It decides whether samples and a directory can live on the server.
