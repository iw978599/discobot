# Sending drum sounds to Discobot

Another web app can hand Discobot drum sounds, which open in the **Import Kit** dialog on the
lanes the sender suggests. Nothing is stored until the user presses Use These Sounds, exactly as
for files picked by hand. Drum Foundry (https://aaronvandorn.github.io/Drum-Foundry/) was the
first sender; its creator wrote the request on 2026-10-27, and the owner asked for it.

The code is `ui/src/services/receiveSounds.ts` (the checks, the one set of sounds on show, the
`#receive` handshake), `ui/src/rack/ReceivedSounds.tsx` (the dialog) and the frame's part in
`ui/src/rack/GuestModule.tsx`. `docs/send-example.html` is a complete sender, served by the local
API at `/__send`; `send-sounds.spec.ts` runs against it, and the example guest sends a sound
from its frame with `?send=1`.

## Messages

Every message is a plain object with `discobotImport: 1` and a `type`, sent with
`window.postMessage`. It is kept apart from the guests' `discobotGuest`.

**Discobot to the sender**

| `type` | Fields | When |
|---|---|---|
| `ready` | none | Discobot can show sounds. Sent once (see the two ways below). |
| `done` | `imported`: how many files were put on a lane or a new row, 0 if cancelled | The dialog the sounds opened has closed. |
| `error` | `message`: short, for the user | Nothing in the sounds could be used, or other sounds are already on show. |

**The sender to Discobot**

| `type` | Fields |
|---|---|
| `sounds` | `v: 1`; `from`: the app's name; `files`: a list of `{ name, mime, lane, data }`, where `name` ends in `.wav`, `mime` is `'audio/wav'`, `lane` is a drum id (`kick`, `snare`, `clap`, `closedHH`, `openHH`, `snare2` for Low Tom, `ride` for High Tom, `crash` for Cymbal) or `null`, and `data` is an `ArrayBuffer`, best passed in the transfer list. |

## Two ways in

1. **A new tab.** The sender opens Discobot's address with `#receive` on the end using
   `window.open`. Discobot takes the mark off the address before anything renders, and once the
   studio has its project tells `window.opener` `ready` (to `'*'`, since it carries nothing).
   It takes the first `sounds` from that window and nothing after.
2. **A guest's frame.** A guest on the rack is told `ready` by its parent each time its page
   loads, at the guest's own origin. It may then send `sounds` to `window.parent` as often as it
   likes; each opens the dialog, one at a time. A sender that wants to work both ways uses the
   frame when it is framed by Discobot and has heard `ready` from `window.parent`.

## What Discobot checks

- The sender: the opener or the guest's own frame (`event.source`), at an origin that is
  `https`, or `http://localhost` / `http://127.0.0.1` while developing, and is not Discobot's.
  Answers go to that origin.
- Everything in `sounds`: `v` is 1; `from` is cut to 60 characters (an absent name is "another
  app"); at most `MAX_KIT_FILES` (64) files, each 1 byte to 8 MB, with a name tidied as a sample's
  is (no path or control characters, ending in `.wav`), and only files the browser can decode
  (on an `OfflineAudioContext`, so the app's audio is not started). A `lane` that is not one of
  the eight is `null`.
- The lanes the dialog starts with: the lane each file was sent for, the first file when two ask
  for one; then, for files sent for no lane, what `matchKit` guesses from their names, on the
  lanes still free. The rest are under "Files on no lane", with their New row switches.
- Nothing about the sender is remembered, nothing is loaded from its site, and nothing is asked
  with `window.confirm`: the dialog is the question.
