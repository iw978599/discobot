# Prompt: make Choir (and the other Jam Link apps) Discobot guests

This is a prompt for the creator of [Choir](https://github.com/aaronvandorn/Choir)
to give to Claude, in their own repository. It is written for Choir, Logic
Rhythm and Boolean Melody Machine, which share one Jam Link module.

Copy everything below the line.

---

I want this app to work as a **guest instrument inside Discobot**, a
browser-based sequencer and drum machine made by a friend
(https://iw978599.github.io/discobot/). Discobot can show another creator's
web instrument in a frame as a unit in its rack. It tells the guest the tempo
and when to play, takes the guest's sound into its mixer, and saves the
guest's settings with the project.

Please add this to the **Jam Link module**, so that Choir, Logic Rhythm and
Boolean Melody Machine all get it from the same block of code (between the
`JAM-LINK:BEGIN` and `JAM-LINK:END` markers, with `jam-link.js` as the source
copy). Each app will need a few lines of its own as well, described below.

**When the page is opened normally, not in a frame, nothing about it may
change.** All of this is active only when `window.parent !== window` and a
valid `hello` has been received.

## Read these first

- The protocol: https://github.com/iw978599/discobot/blob/main/docs/GUEST_PROTOCOL.md
- A complete minimal guest in one file, which does everything asked for here:
  https://github.com/iw978599/discobot/blob/main/docs/guest-example.html

If you cannot fetch them, the protocol is summarised here and is enough.

## The protocol in brief

Everything is `window.postMessage`. Every message is an object with
`discobotGuest: 1` and a `type`.

**Guest to host**

- `{ type: 'ready', name, features: ['transport', 'state', 'audio'] }` once on load.
- `{ type: 'state', id, state }` in answer to `getState`, echoing `id`.
- `{ type: 'stateChanged' }` optionally, after the user changes something (not on every step of a drag).
- `{ type: 'audio', wall, sampleRate, left, right }` continuously while audio is on. `left` and `right` are `Float32Array`s of equal length, at most 16,384 frames, passed in the transfer list.

**Host to guest**

- `{ type: 'hello', host: 'discobot', latencyMs }` in answer to `ready`. May arrive more than once.
- `{ type: 'transport', playing: true, bpm, anchorWall, anchorBeat }` and `{ type: 'transport', playing: false }`.
- `{ type: 'getState', id }` and `{ type: 'setState', state }`.
- `{ type: 'audio', on }`.

**Time.** Times are milliseconds on the shared clock,
`performance.timeOrigin + performance.now()`, which is the same clock Jam Link
already uses (`wallNow()`). `transport` with `playing: true` means
*beat `anchorBeat` falls at `anchorWall`, and beats follow at `bpm`*. That is
exactly a Jam Link tempo segment `{ bpm, anchorWall, anchorBeat }`.

- A start has `anchorBeat: 0` and `anchorWall` about a third of a second in the future.
- A tempo change while playing is another `transport` message with the new `bpm`, the beat count so far as `anchorBeat`, and when that beat falls as `anchorWall`.

**Playing early.** The guest plays everything `latencyMs` early (currently
120) and the host holds the audio back by the same amount, so the guest lands
on the beat. Only while hosted and while audio is on.

**Rules.** Only accept messages whose `event.source` is `window.parent`.
Remember `event.origin` from the first valid one and use it as the target of
every later `postMessage`; the first `ready` goes to `'*'`. Validate every
field.

## What to build

### 1. A hosted mode in Jam Link

- On load, if framed, post `ready` with the app's display name.
- On `hello`, enter hosted mode: remember the host's origin and `latencyMs`.
- While hosted, turn Jam Link's own linking off (BroadcastChannel and online
  rooms) and say so in the Jam Link dock, so there are not two things driving
  the transport. Leave the user's saved Link preference as it was; this is
  for the session only.
- `canAutoplay()` should return true while hosted. The host frames the page
  with `allow="autoplay"` and the user has pressed play there.

### 2. Transport

Map the host's messages onto what Jam Link already does when another app
starts, stops or changes tempo.

- **`playing: true` while stopped:** make `{ bpm, anchorWall, anchorBeat }`
  the one tempo segment and start the app with `o.start(true)`. **The app must
  begin on beat 0 at `anchorWall`, not on the next bar line.** `begin()`
  currently rounds a joining app up to the next multiple of `BAR_BEATS`; with
  the anchor in the future that should come out as 0, but check it, because
  starting a bar late is the most likely bug here.
- **`playing: true` while playing:** a tempo change. Insert the segment as
  the `'tempo'` case does and call `o.applyBpm`.
- **`playing: false`:** `o.stop(true)`.
- **Do not clamp the tempo while hosted.** Jam Link limits BPM to 40–240;
  Discobot's range is 20–400. A clamped guest drifts. If an app truly cannot
  run outside its range, follow at half or double time, which stays on the
  grid.
- **Play early.** While hosted with audio on, everything is scheduled
  `latencyMs` early. `timeOfBeat()` already adds `trimMs`; the simplest
  correct change is to subtract the hosted latency there (and add it back in
  `beatAt()`), without touching the user's saved Sync trim.
- When the user presses the app's own play or stop button while hosted,
  either ignore it or hide the button. The host is in charge of the transport.

### 3. Settings

Jam Link apps already expose `o.scene.capture()` and `o.scene.apply(state)`.

- `getState` → reply `{ type: 'state', id, state: o.scene.capture() }`.
- `setState` → `o.scene.apply(state)` inside `withApplying`. **Do not save it
  into the Jam scenes list or the app's saved patterns.** It only sets what is
  on screen. (The existing `'scene-load'` case writes to storage; do not reuse
  it for this.)
- Optionally send `stateChanged`, debounced to about once a second, when the
  user changes a control.
- Settings can come back from an older version of the app. Tolerate missing
  and unknown fields, which `apply` should already do.

### 4. Sound

On `audio` with `on: true`:

- **Silence the page's own speakers.** This needs a small change in each app:
  a final gain node before `ctx.destination` that hosted mode can set to 0.
  Give Jam Link a way to do it, for example an option `o.setMonitor(on)`. In
  Choir the output reaches the destination through `reverbDry` and
  `reverbWet`, which are also the nodes handed to `jam.tapAudio`.
- **Send the signal from before that gain** as PCM. Jam Link already keeps
  `tappedNodes`; connect them to an `AudioWorkletNode` that gathers 128-frame
  blocks into 1,024 frames and posts `{ frame, l, r }` with the buffers
  transferred, then forward each block to the host as an `audio` message.
  Choir's existing `ChoirRec` worklet is close to this already.
- **Stamp each block** with
  `wall = wallAtCtx(firstFrame / ctx.sampleRate)`: when its first sample would
  have been heard on this page. `wallAtCtx` already exists in Jam Link and
  uses `getOutputTimestamp()`, which is what is wanted. Do not include
  `trimMs` or the hosted latency in the stamp.
- Send continuously while on, silence included, so reverb tails come through.
- Keep the tap alive by connecting its silent output to the destination.
- `on: false` undoes all of it.

The existing WebRTC audio sending for online rooms is not used for this. PCM
over `postMessage` is lossless and has a known, fixed delay.

## Leave alone

- Everything about the page when it is not framed.
- The user's saved Jam Link preferences, saved scenes and saved patterns.
- Export, which keeps working from the app's own recorder.

## Checking it

There is no build step, so serve the folder locally (for example
`python -m http.server 8000`) and use the live Discobot:

1. Open https://iw978599.github.io/discobot/, then **Project → Add Guest
   Instrument**, and paste `http://localhost:8000/` (a local address is
   allowed for development; a published one must be `https`).
2. The unit's status should read **Connected**.
3. Put a kick on every beat in Discobot's drum grid and press **Play All**.
   The app should start on the first kick and stay with it. Listen for a
   flam (two close hits), which would mean the early-playing or the time stamp
   is off, and for doubled sound, which would mean the page's own speakers
   were not silenced.
4. Change Discobot's tempo while playing. The app should follow without a
   jump.
5. Press **Stop All**. The app should stop.
6. Change some controls in the app, wait five seconds, reload Discobot. The
   controls should come back.
7. Open the app on its own, not in a frame, and check it is exactly as before,
   including Jam Link between tabs.

Please also add a short "Discobot guest" section to the README and to
`JAM-LINK.md` saying what this is and how to add the app to a Discobot
project.
