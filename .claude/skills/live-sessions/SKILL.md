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
  others' and split the project.

## Testing

- The room's rules are plain functions (`joined`, `received`, `left`) tested
  with pretend people in `server/test/live.test.ts`, which also runs a real
  round trip through the local runner using Node's built-in WebSocket client.
- `server/devLive.ts` is the local runner's WebSocket server (no dependency,
  never deployed); the browser tests reach live sessions through it.
- Keep the browser side's logic a plain object with its connection, store and
  clock passed in, so it can be tested the same way.

## Deploying

The accounts API is deployed by hand: after a change to `server/`, the owner
runs `npm run deploy --workspace=server` (after `npx wrangler@4 login`). Say so
in the pull request. The site can be ahead of the API.
