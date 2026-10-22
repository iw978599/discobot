# Prompt: Tape Loop Deck keeps its tapes in a Discobot project

This is a prompt for the creator of Tape Loop Deck to give to Claude, in its
repository. Tape Loop Deck already works as a Discobot guest instrument. What
it could not do was keep its tapes: a guest's settings are limited to 100,000
characters, so after a reload the deck came back without its audio. Discobot
now has a way for a guest to keep files with the project, and this asks for
Tape Loop Deck to use it.

Only a guest that holds audio of its own needs this. Choir, Logic Rhythm,
Boolean Melody Machine, Pocket Mouse and Axis Stack need no change.

Copy everything below the line.

---

Tape Loop Deck already works as a **guest instrument inside Discobot**
(https://iw978599.github.io/discobot/): it follows Discobot's transport, sends
its sound into Discobot's mixer, and hands over its settings with `getState`
and takes them back with `setState`. One thing is missing: **its tapes'
audio is not saved with the Discobot project**, because `state` is limited to
100,000 characters. After the user reloads Discobot, or opens the project
again, the deck has its settings but no tapes.

Discobot has added an optional protocol feature, **`files`**, for exactly
this. Please make Tape Loop Deck use it, so that every tape's audio comes back
with the Discobot project.

**When the page is opened on its own, not in a frame, nothing may change.**
Its own project files (Save project .json) and everything else stay as they
are. All of this is active only while hosted by Discobot (in a frame, after a
valid `hello`), and only when Discobot answers; the guest code already knows
when that is.

## Read these first

- The protocol, section "Files": https://github.com/iw978599/discobot/blob/main/docs/GUEST_PROTOCOL.md
- A complete small guest that uses it (open it with `?files=1`):
  https://github.com/iw978599/discobot/blob/main/docs/guest-example.html

If you cannot fetch them, the summary here is enough.

## The feature in brief

Messages are sent the same way as the rest of the protocol: `postMessage`
objects with `discobotGuest: 1` and a `type`, to the host's origin.

1. **Say you support it.** Add `'files'` to `features` in the `ready`
   message. Discobot ignores the new messages from a guest that does not.

2. **Keep a file.** Send
   `{ type: 'putFile', id, mime, data }`, where `id` is a string of your own
   for matching the answer, `mime` is the file's type (such as `'audio/wav'`)
   and `data` is an `ArrayBuffer` of 1 byte to 8 MB, passed in the transfer
   list. Discobot answers
   `{ type: 'fileStored', id, file }` with the file's id, or
   `{ type: 'fileStored', id, error }` where `error` is `'too-large'`,
   `'full'` (the browser's room for guests' files is used up) or
   `'unavailable'` (storage could not be used).

3. **The file id** looks like `'discobot-file:'` followed by 64 hex
   characters: the SHA-256 of the bytes. The same bytes always get the same
   id. Put it in `state` as a **whole string value**, anywhere, for example
   `{ tapes: [{ name, file: 'discobot-file:…', ...placement and mixer settings }] }`.
   Discobot finds which files a project uses by looking for whole strings of
   that form in the guest's settings. **A file nothing names is cleared away
   a week after it was stored**, so once you have an id, send `stateChanged`
   so Discobot saves the settings that name it.

4. **Get a file back.** Send `{ type: 'getFile', id, file }`. Discobot answers
   `{ type: 'file', id, file, mime, data }` (`data` an `ArrayBuffer`), or
   `{ type: 'file', id, file, error: 'missing' }`. A guest may only have back
   a file its own settings in the open project name, or one it stored since
   it loaded.

5. **`missing` is normal and must be handled.** A file travels only in a
   project file saved from Discobot's Export Project. A project shared by
   link, published, synced to another device, or opened in a live session
   arrives without it. Keep the tape in its place, with its name and
   settings, show that its recording is missing (and that it can be recorded
   or loaded again), and do not discard the rest of the settings.

Matching answers to questions by `id` matters: several can be in flight, and
they can arrive in any order.

## What to build in Tape Loop Deck

- **When a tape's audio is made or changed** (recorded, captured with "Grab
  last 4 bars" or "Record next 4 bars", loaded from a dropped file, edited in
  a way that changes its audio), encode it and send `putFile`. When
  `fileStored` arrives with an id, record it on that tape and send
  `stateChanged`. Until then, the tape's state has no file id, and the rest of
  its settings are saved as usual.
- **Do not send the same audio twice.** Remember, for each tape, the id of
  the audio it has now, and send `putFile` again only when the audio changes.
  `getState` arrives every few seconds and must not cause uploads.
- **`state` holds ids, never audio.** The deck's tapes, placement, mixer,
  sends, MIDI map and scenes go in `state` as they do now, each tape naming
  its audio by its file id. Keep `state` well under 100,000 characters.
- **When `setState` arrives**, for each tape whose file id is one the deck
  does not already have decoded, send `getFile`, decode what comes back
  (`AudioContext.decodeAudioData`), and put the tape's audio in place when it
  arrives. Keep decoded audio by file id, so the same file is fetched and
  decoded once per page load.
- **`setState` arrives often, and during playback.** Discobot keeps a guest's
  settings per scene and sends them each time a scene opens, and during a song
  a little before each bar where the scene changes. Applying it must not stop
  the transport, click, or re-fetch audio already loaded. A tape whose audio
  is still on its way is silent until it arrives, then joins in time.
- **Encoding.** 16-bit PCM WAV at the context's sample rate is simplest and
  is decoded everywhere. 8 MB is about 47 seconds of 16-bit stereo at 44.1
  kHz. If a tape is longer than fits, keep it in several files (its audio in
  parts, each part's id in order in the tape's state) and put the parts back
  together after decoding. Do not lower the quality without the user's say.
- **Answers that fail.** On `fileStored` with an `error`, keep the tape
  playing in this session and tell the user in the deck that it could not be
  kept with the Discobot project (`'full'`: the browser's space for guests'
  recordings is used up; `'too-large'`: a part over 8 MB, which the splitting
  above should prevent). On `missing`, as in step 5.

## How to check it

In Discobot (https://iw978599.github.io/discobot/), Project → Add Guest
Instrument → Tape Loop Deck.

1. Record a tape and load another from a file. Wait a few seconds.
2. Reload Discobot. Both tapes come back with their audio and play in time.
3. Make a second scene (+ Add Scene), change the deck there, and switch
   between the scenes while playing: each scene's tapes are right, with no
   gap, click or re-loading.
4. Project → Export Project, then in another browser (or a private window)
   Project → Import Project with that file, and Load It on the deck. The
   tapes are there.
5. Project → Share Link, open the link in another browser, choose Open a
   Copy to Edit, and Load It on the deck: it shows its tapes as missing,
   keeps their names and settings, and does not fail.
6. Open Tape Loop Deck on its own, not in Discobot: everything behaves as it
   always has, its own project files included.
