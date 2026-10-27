# Prompt: Drum Foundry sends to Discobot from inside its rack

This is for the creator of Drum Foundry to give to Claude in Drum Foundry's repository.

Discobot now takes sounds by the handshake you wrote (`#receive`, `ready`, `sounds`, `done`,
`error`). Discobot also lists Drum Foundry as a featured guest, so it can sit in a frame on
Discobot's rack. There, Send to Discobot still opens a second Discobot tab. That works, but the
second tab opens the same project as the first, which then stops saving until the user picks a
version.

Copy everything below the line.

---

When Drum Foundry is shown in a frame by Discobot, **Send to Discobot** and **Send kit to
Discobot** should hand the sounds to the page around it instead of opening a new tab.

- Discobot posts `{ discobotImport: 1, type: 'ready' }` to a guest's frame each time the frame's
  page loads, from Discobot's own origin. Listen for it when `window.parent !== window`; accept it
  only when `event.source === window.parent` and the origin is `https://iw978599.github.io` (or
  the address given with `?discobot=`), and remember that origin.
- Once it has come, the two buttons post the same `sounds` message as now to `window.parent`,
  at that origin, with the buffers in the transfer list. Every press may send again: each opens
  Discobot's Import Kit dialog in turn, and a press while one is still open is answered `error`
  ("Discobot is already showing sounds sent to it").
- `done` and `error` come back from `window.parent` exactly as they come from the tab today, so
  the same status lines serve both. Accept them only from `window.parent` at the remembered origin.
- Without that `ready`, or when not framed, the buttons open a tab as they do now.

Discobot's side is described in its `docs/SEND_PROTOCOL.md`. Drum Foundry does not speak the
guest protocol (`docs/GUEST_PROTOCOL.md` there), so in the rack it does not follow the tempo or
play through the mixer; that is not needed for designing and sending sounds.
