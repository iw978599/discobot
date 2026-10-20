---
name: live-sessions
description: Building or changing live sessions in Discobot - several people editing one shared project at once through a Cloudflare Durable Object relay. Use when working on the relay (server/src/live.ts, server/devLive.ts, the /live route), the browser side (liveSession), or anything that sends edits, the transport or presence between browsers.
---

# Live sessions

Read `docs/LIVE_SESSIONS_PLAN.md` first: it holds the owner's decisions, the
design, the stages, and how far they have got.

## The rules that must hold

- **It costs nothing.** The relay is a Durable Object on Cloudflare's free plan,
  whose caps are hard (past them requests fail; nothing is billed). Keep
  messages few: batch edits, never send one message for every value of a knob's
  drag. Never add anything that needs a paid plan or a card.
- **The room keeps nothing.** No project, edit or name beyond the usernames of
  the people connected while they are. The accounts API's privacy rules
  (`AGENTS.md`, Conventions) still apply.
- **The token never goes in an address.** A browser cannot put a header on a
  WebSocket, so it travels as the connection's second protocol name
  (`['discobot', token]`), and `liveTarget` strips it before the room.
- **The app works without it.** Signed out, offline, or with a project that is
  not shared, nothing connects. A Worker without the `LIVE` binding answers 503,
  and the app must treat that as "not available", not as an error.
- **One order decides.** The room sends every edit to everyone, the sender too,
  in one order. A browser applies its own edits at once; on another person's
  edit it applies theirs, then applies again any of its own edits still on
  their way whose keys overlap (they were ordered after). Keys are paths, and
  two overlap when one contains the other. Every edit carries the scene it was
  made in and is applied there. Do not "simplify" this into skipping the other
  person's edit: that leaves browsers different.
- **Remote edits are not undone here.** They are applied with the `remote`
  origin (`localService.apply(op, 'remote')`), which keeps them out of this
  browser's undo and must keep them from being sent again.
- **Only one person saves to the account** during a session (the one longest
  in the room); the others hold their saves, or every save would refuse the
  others' and split the project. When the hold ends, say how (`projectSync.hold`:
  `'adopt'` on taking over the saving, `'yield'` on leaving others behind,
  nothing when the connection was lost), or the next sync splits it anyway.
- **Ids are made before an edit is applied**, never inside a reducer, or each
  browser makes its own. An edit whose result cannot be repeated (Reset All)
  goes as the whole project instead.
- **Only the Play button tells the session about the transport.** An export's
  play-through or a song ending must never start or stop anyone else's music;
  they use the internal `playStop`, not `handleGlobalPlayStop`.
- **Presence marks are attributes, not renders.** `Rack` sets `data-present`
  on the units from a layout effect; never pass presence to a unit as a prop,
  which would render the tracked units for someone else's pointer.
- **The studio must take a remote edit from its event alone.** Anything a
  handler sets around its call to the store (a ref, the audio) is missing
  when the same edit arrives from someone else.

## Testing

- The room's rules are plain functions (`joined`, `received`, `left`) tested
  with pretend people in `server/test/live.test.ts`, which also runs a real
  round trip through the local runner using Node's built-in WebSocket client.
- `server/devLive.ts` is the local runner's WebSocket server (no dependency,
  never deployed); the browser tests reach live sessions through it.
- The browser side's logic is a plain object (`createLiveSession`) given its
  connection, store and timers. `ui/test/liveSession.test.ts` runs real
  project stores through the real room rules with messages delivered by hand;
  add a case there for any new kind of edit or message. `sharing.spec.ts` is
  the browser test: two people live, then in turns.

## Deploying

The accounts API is deployed by hand: after a change to `server/`, the owner
runs `npm run deploy --workspace=server` (after `npx wrangler@4 login`). Say so
in the pull request. The site can be ahead of the API.
