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
| `ready` | `name` (string), `features` (array of `'transport'`, `'state'`, `'audio'`) | Once, when the page has loaded. |
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
- Beats are quarter notes. Discobot's bar is four beats, and a bar line is
  every beat that divides by four.

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

## What the host does not do yet

- **Offline export.** Discobot renders WAV files faster than real time and a guest cannot. For
  every audio export it plays the music through and records the guest's `audio` blocks, so a
  guest that does not send audio is not in the file. A loop is played twice and the second
  pass kept. Guests are not in MIDI.
- **Large settings.** `state` is limited to 100,000 characters, which is not enough for
  recorded audio. A guest that holds audio of its own (loaded samples, tape loops) can save
  its settings but not that audio.
- **Key and scale.** Discobot has no key setting to send.
- **Notes.** The host does not send notes to a guest; a guest makes its own
  music in time with the host.

## Trying it

1. Serve the page over `https`, or from `http://localhost` while developing.
2. In Discobot: **Project → Add Guest Instrument**, and paste the address.
3. The unit's status reads "Connected" once `ready` has been received.
4. Press **Play All**. The guest should start on the first beat, stay with
   the drums, follow a tempo change, and stop with **Stop All**.
5. Change a setting in the guest, reload Discobot, and check it comes back.
