# Discobot guest instruments: protocol, version 1

A guest instrument is a web page, on its creator's own site, that Discobot
shows in a frame as a unit in its rack. The page keeps its own sound engine
and its own controls. Discobot tells it the tempo and when to play, takes its
sound into the mixer, and saves its settings with the project.

A complete working guest in one file is in
[`guest-example.html`](guest-example.html). It is about 150 lines of script
and is the best place to start.

## What a guest has to do

1. Say it is ready.
2. Follow the host's transport: start, stop and tempo, on the host's beats.
3. Hand over its settings when asked, and take them back.
4. Send its sound to the host instead of to the speakers.

A page that does only step 1 still appears in the rack. Each further step is
independent, and a guest lists the ones it supports.

## Messages

Everything is sent with `window.postMessage`. Every message is a plain object
with `discobotGuest: 1` and a `type`. Ignore anything else.

### Rules for the guest

- Only act when framed: `window.parent !== window`. On its own, the page
  behaves exactly as it always has.
- Only accept messages whose `event.source` is `window.parent`.
- Remember `event.origin` from the first valid message and use it as the
  target of every later `postMessage`. The first `ready` is sent to `'*'`
  because the host's address is not known yet; it carries nothing private.
- Treat every field as untrusted: check types and ranges.

### Guest to host

| `type` | Fields | When |
|---|---|---|
| `ready` | `name` (string), `features` (array of `'transport'`, `'state'`, `'audio'`, and optionally `'input'` and `'files'`) | Once, when the page has loaded. |
| `state` | `id` (echoed), `state` (any JSON, up to 100,000 characters) | In answer to `getState`. |
| `stateChanged` | none | Optional. After the user changes a setting, so the host asks sooner. Do not send it for every step of a drag. |
| `audio` | `wall` (number), `sampleRate` (number), `left`, `right` (`Float32Array`, same length, at most 16,384 frames) | Continuously, while audio is on. Pass both buffers in the transfer list. |

### Host to guest

| `type` | Fields | Meaning |
|---|---|---|
| `hello` | `host` (`'discobot'`), `latencyMs` (number) | Answer to `ready`. The guest is hosted from now on. May arrive more than once. |
| `transport` | `playing: true`, `bpm`, `anchorWall`, `anchorBeat` | Play. Beat `anchorBeat` falls at time `anchorWall`; beats follow at `bpm`. |
| `transport` | `playing: false` | Stop. |
| `getState` | `id` (string) | Reply with `state` and the same `id`. |
| `setState` | `state` | Load these settings. They are whatever this guest last sent, possibly from an older version of it. |
| `audio` | `on` (boolean) | Start or stop sending sound. While on, the guest must be silent on its own speakers. |

## Time

A frame and its host have separate audio clocks, so beats are described on
the one clock they share, the computer's:

```js
const wallNow = () => performance.timeOrigin + performance.now(); // milliseconds
```

A `transport` message with `playing: true` means:

```
time of beat b = anchorWall + (b - anchorBeat) * 60000 / bpm
```

- **Start.** `anchorBeat` is 0 and `anchorWall` is a little in the future
  (about a third of a second), so there is time to schedule beat 0.
- **Tempo change.** While playing, another `transport` message arrives with
  the new `bpm`. Its `anchorBeat` is how many beats have passed, counted from
  the start, and `anchorWall` is when that beat falls. From then on use the new
  mapping. The beat count carries on; it does not restart.
- **Tempo range.** 20 to 400 BPM. Follow it exactly: a guest that limits the
  tempo to its own range will drift.
- Beats are quarter notes, and beats are all a guest is told. A bar of
  Discobot is four of them unless the scene that is playing has another time
  signature (3/4, 6/8, 5/4, 7/8 or 12/8), and a song can change it from one
  scene to the next. The host does not say which, so do not work out bar
  lines from the beat count: only in a project that is all in 4/4 is a bar
  line every beat that divides by four. In 7/8 a bar is three and a half
  beats, so a bar line can fall between two of them.

To turn a time on the shared clock into a time on the guest's own audio
clock, and back, use the context's output timestamp, which accounts for the
delay between scheduling a sound and hearing it:

```js
function ctxAtWall(ctx, wall) {
  const s = ctx.getOutputTimestamp();
  if (s.performanceTime && s.contextTime) return s.contextTime + (wall - (performance.timeOrigin + s.performanceTime)) / 1000;
  return ctx.currentTime + (wall - wallNow()) / 1000;
}
function wallAtCtx(ctx, time) {
  const s = ctx.getOutputTimestamp();
  if (s.performanceTime && s.contextTime) return performance.timeOrigin + s.performanceTime + (time - s.contextTime) * 1000;
  return wallNow() + (time - ctx.currentTime) * 1000;
}
```

### Playing early

Sound takes time to cross from the frame to the host. So the guest plays
everything **`latencyMs` early**, and the host holds the audio back by the
same amount. The two cancel and the guest lands on the beat.

```js
const when = ctxAtWall(ctx, wallOfBeat(b) - latencyMs);
```

`latencyMs` comes from `hello`. It starts at 120 and **can change**: if the
guest's audio reaches the host too late to play on time, the host sends `hello`
again with a larger value, possibly while playing. Use the new value from the
next beat you schedule. Apply the latency only while hosted and only while
audio is on.

## Sound

When the host sends `audio` with `on: true`:

1. **Stop playing through the page's own speakers.** Put a gain node last
   before `ctx.destination` and set it to 0. Otherwise the sound is heard
   twice, once directly and once through the host.
2. **Tap the signal before that gain** and send it in blocks. An
   `AudioWorkletProcessor` that collects 128-frame blocks into 1,024 frames
   and posts them works well. Keep the tap running by connecting its (silent)
   output to the destination.
3. **Stamp each block** with `wall`: the time its first sample would have been
   heard on the guest's own output, `wallAtCtx(ctx, firstFrame / ctx.sampleRate)`.

Send stereo `Float32Array`s in the range -1 to 1, at the context's own sample
rate; the host resamples if it has to. Send continuously, silence included,
so tails and reverb come through.

`audio` with `on: false` undoes all of this.

## Input (optional): one of Discobot's voices, handed to the guest

A guest that lists `'input'` in `ready.features` can take one of Discobot's own voices (a synth
lane, the whole drum kit or one drum) and play it back through its own processing. Discobot then
takes that voice out of its mix, streams it into the guest, and hears it again in the guest's
ordinary `audio`. A guest that does not list `input` sees none of this.

**Host to guest**

| `type` | Fields | When |
|---|---|---|
| `sources` | `sources`: array of `{ id, name, kind }` | After `hello`, and again whenever the list changes (a lane added or removed, its model changed). |
| `inputSelected` | `source`: an id or `null` | In answer to every `selectInput`, and unasked whenever the guest no longer has its voice (the voice was deleted, the guest reloaded). |
| `input` | `source`, `wall`, `sampleRate`, `left`, `right` (`Float32Array`, same length, at most 16,384 frames, transferred) | Continuously while the guest has a voice, silence included. |

**Guest to host**

| `type` | Fields | Meaning |
|---|---|---|
| `selectInput` | `source`: an id from the latest `sources`, or `null` | Hand this voice over, or give it back. Anything not in the list is `null`. |
| `inputLate` | `ms` (number) | `input` blocks are arriving too late to play on time, by about this much. |

**Ids** stay the same across reloads and devices, so a guest can keep its choice in its own
`state` (which is per scene) and ask for it again when it is given that state:
`synth:<lane>` (`kind: 'synth'`, named like `Synth 2 · Juno-60`), `drums` for the whole kit
(`kind: 'drums'`), and `drum:<instrument>` for each drum (`kind: 'drum'`, named as the drum grid
names it): `drum:kick`, `drum:snare`, `drum:clap`, `drum:closedHH`, `drum:openHH`, `drum:snare2`
(Low Tom), `drum:ride` (High Tom), `drum:crash` (Cymbal). Other guests and the whole mix are
never offered. A voice goes to one guest at a time: a guest that asks for one another guest has
is answered with the voice it had before, or `null`.

**Routing.** A handed voice is taken after its level, mute and solo, so muting it in Discobot
still silences it, and before its sends: it leaves the mix and every effect send, and what comes
back through the guest (with the guest's level and sends) takes its place. Each switch is a
10 ms crossfade. Discobot marks the voice's unit and mixer strip with "→ <guest>".

**Timing.** The guest plays everything `latencyMs` early, the input included: place each block
at `ctxAtWall(wall - latencyMs)`, and stamp what you send back as usual. **`wall` on an `input`
block is when that audio would have been heard in Discobot's mix.** Discobot plays the voice
early enough for that: by a lead that starts at `latencyMs + 120` ms, grows by `ms + 20` each
time the guest sends `inputLate` (up to 1,000), and grows with `latencyMs`. Notes played live
on Discobot (a keyboard, a MIDI controller) cannot be early, so they come back late by about
the lead.

**Export.** An audio export plays the music through and records the guest, voice included, and
leaves the handed voice out of Discobot's own render, so it is heard once. In a song, a voice is
left out in the bars it was handed over.

## Files (optional): recordings kept with the project

A guest that lists `'files'` in `ready.features` can hand Discobot files to keep with the project:
recordings, loaded samples, anything too large for its settings. Discobot keeps each one in the
user's browser and gives back an id. The guest puts that id in its `state`, and when it is given
that state again (after a reload, on another scene, from a project file) it asks for the file by
its id. A guest that does not list `files` sees none of this.

**Guest to host**

| `type` | Fields | Meaning |
|---|---|---|
| `putFile` | `id` (string, echoed), `mime` (string, such as `'audio/wav'`), `data` (`ArrayBuffer`, 1 byte to 8 MB, transferred) | Keep this file. |
| `getFile` | `id` (string, echoed), `file` (a file id) | Send this file back. |

**Host to guest**

| `type` | Fields | When |
|---|---|---|
| `fileStored` | `id`, and `file` (the file id) or `error` (`'too-large'`, `'full'` or `'unavailable'`) | In answer to `putFile`. |
| `file` | `id`, `file`, and `mime` and `data` (`ArrayBuffer`, transferred) or `error` (`'missing'`) | In answer to `getFile`. |

**The id** is `'discobot-file:'` and the file's SHA-256 in hex. The same bytes always get the same
id and are kept once. Put it in `state` as a whole string value, anywhere (`{ tapes: [{ name,
file: 'discobot-file:…' }] }`): Discobot finds the files a project uses by looking for whole
strings of that form in its guests' settings, every scene's included. A file is kept for as long
as some project or kept version in the browser names it; one that nothing names is cleared away a
week after it was stored. So send `stateChanged` once you have the id, and keep naming it for as
long as the file is wanted.

**A guest may only have back** a file its own settings in the open project name, or one it stored
since it last loaded. Anything else is answered `missing`, as is a file this browser does not
have. **Always handle `missing`**: a file is not in a project shared by link, published, synced to
another device or opened in a live session, because those carry the project without its audio.
It travels only in a project file saved with Export Project. Show the user that the recording is
missing (keep its name and place), and do not throw the rest of the settings away.

**Sizes.** One file is at most 8 MB, and all guests' files in a browser together at most 256 MB.
A project file holds about 12 MB of audio in all, samples included, so a project whose files are
larger is saved without some of them, and the user is told. Store audio compactly: 16-bit WAV at
the context's rate is fine for a few bars; a long recording is better compressed.

**Order.** Answers can arrive in any order and may take a moment: match them by `id`. Do not
block audio on them: a tape whose file has not arrived yet is silent until it does.

## Sending drum sounds (optional)

A guest may send drum sounds to Discobot's drum lanes through the Import Kit dialog. Discobot posts
`{ discobotImport: 1, type: 'ready' }` to the frame whenever its page loads; the guest then posts a
`sounds` message to `window.parent` and is answered `done` or `error`. That handshake has its own
envelope and is described in `SEND_PROTOCOL.md`. The example guest does it with `?send=1`.

## Settings

`state` is whatever the guest needs to put itself back exactly: every
control, and for a generative instrument the current pattern. The host stores
it in the project without looking inside, and returns it with `setState` the
next time the project opens, on any device.

- It must be plain JSON, at most 100,000 characters.
- The host asks every few seconds and when it is told `stateChanged`.
- `setState` must not write to the guest's own saved presets or storage. It
  only sets what is on screen.
- Settings come back from old projects. Tolerate missing and unknown fields.
- **Settings are kept per scene.** A Discobot project is made of scenes (verse,
  chorus, break), and each remembers how the guest was set. `setState` therefore
  arrives often: whenever the user opens another scene, and **during playback**
  each time a song moves to its next scene, a little before the bar line. Apply
  it without stopping or restarting, and without a click or a gap, so the
  change lands on the next bar.

## Starting sound in a frame

Browsers block sound until the user has interacted with a page. The host
frames the guest with `allow="autoplay"`, which in Chrome and Edge lets the
guest start once the user has pressed play in Discobot. Create or resume the
`AudioContext` when the first `transport` with `playing: true` arrives. If
the context stays suspended, show a short "click here to enable sound"
message; one click inside the frame fixes it for the session.

## When the guest is not on show

On a phone Discobot shows one unit of the rack at a time, and the guest may
not be the one on show. Its frame is then still in the page at its full
size, but nothing of it is painted where the user can see it, and it cannot
be touched, focused or read by a screen reader. A guest may assume that it
keeps its width and height, that it is not reloaded, and that messages keep
arriving. It should not assume the user can see or reach it: do not wait for
a click, and do not drive sound or timing from what is drawn. Take time from
the `transport` messages and the clock, and make sound in the audio thread
or from a timer, not from `requestAnimationFrame`.

This is different from the user pressing Hide on the guest's own unit, which
removes the frame from layout: a browser then stops the guest's animation
frames and may slow its timers, and the guest's size reads as zero.

Only the example guest has been tried this way, and only in Chromium. A phone
browser may still slow a page it judges to be out of sight.

## What the host does not do yet

- **Offline export.** Discobot renders WAV files faster than real time and a guest cannot. For
  every audio export it plays the music through and records the guest's `audio` blocks, so a
  guest that does not send audio is not in the file. A loop is played twice and the second
  pass kept. Guests are not in MIDI.
- **Large settings.** `state` is limited to 100,000 characters, which is not enough for
  recorded audio. A guest that holds audio of its own (loaded samples, tape loops) keeps it as
  files (see Files, above), which stay in the browser and travel only in project files.
- **Key and scale.** Discobot has no key setting to send.
- **Notes.** The host does not send notes to a guest; a guest makes its own
  music in time with the host. (A voice handed over with `input` is audio, not notes.)

## Trying it

1. Serve the page over `https`, or from `http://localhost` while developing.
2. In Discobot: **Project → Add Guest Instrument**, and paste the address.
3. The unit's status reads "Connected" once `ready` has been received.
4. Press **Play All**. The guest should start on the first beat, stay with
   the drums, follow a tempo change, and stop with **Stop All**.
5. Change a setting in the guest, reload Discobot, and check it comes back.
