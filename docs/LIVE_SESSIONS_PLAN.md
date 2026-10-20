# Live sessions

Roadmap features 7, the rest of it. The owner chose on 2026-10-20 to lift the rule against a
held-open connection for this, and decided:

- **The relay** is a Cloudflare Durable Object on the free plan: one room for each shared project.
  The free plan has hard daily caps (100,000 requests, a WebSocket message counting as a twentieth of
  one) and fails rather than bills when they are reached; it asks for no card.
- **What is shared:** every edit, and the transport (play, stop, the tempo), so the people in a
  session hear the song together, each through their own browser.
- **Who joins:** the people a project is shared with, as sharing already works: an account is needed.
- **What people see:** who is in the session, and a coloured mark on the part of the rack each was
  last at.

Everything else stays as it is. The app works with no account and no connection; a project that is
not shared never connects; the room keeps nothing.

## The design

**The room** (`server/src/live.ts`) passes messages on and keeps nothing. Its rules are plain
functions over the people connected (`joined`, `received`, `left`), used by the Durable Object
(`LiveRoomObject`, with the hibernation API, so an idle room costs nothing) and by the local runner
(`server/devLive.ts`, a small WebSocket server with no dependency, for development and the browser
tests). The Worker's route `GET /live/<owner>/<project>` (`liveTarget`) checks the session and that
the person owns the project or has it shared with them, then hands the connection to the project's
room. A browser cannot put a header on a WebSocket, so the token travels as the connection's second
protocol name (`new WebSocket(url, ['discobot', token])`), never in the address, and the room is not
given it.

**Edits** are the store's operations (`localService.apply`) whose `OP_META` says `share`. A browser
applies its own at once and sends it with its keys: the things it changes, finely enough that two
people turning different knobs on one lane do not touch each other (`synth:2:filter.frequency`; a
pattern written whole is one key). The room sends every edit to everyone, the sender too, in one
order. A browser applies someone else's edit unless an edit of its own to one of the same keys is
still on its way: its own was then ordered after, so it is the one everybody keeps. Everybody ends
with the last edit the room ordered to each key, without a clock or a counter.

**Joining** someone in the room already: the room asks the person longest in it (`send-state`) to
send the whole project (`state`) to the newcomer, who opens it in place of their own copy and then
applies the edits that arrived while it was on its way. Alone, a person's own copy is the project.

**Undo** puts back a whole project, so in a session it is sent whole (`replace`) and everybody takes
it.

**Saving** to the account: during a session only the person longest in it saves the shared project;
the others hold their saves. Otherwise each save would refuse the others' and split the project.

**The transport:** play, stop and the tempo go to the others, with a start time on the computer's
clock (the clock guest instruments already share across browsers), so everyone's first beat lands
together.

**Presence:** each person has a colour from the room; the bar of units and the rack mark where each
other person last was.

## Stages, each a pull request

1. The relay: the room, the Worker's route, the Durable Object, the local runner, tests. **Done.**
2. Edits, joining, undo and saving: `ui/src/services/liveSession.ts`, connected when a shared project
   is opened by someone signed in.
3. The transport.
4. Presence on screen.

## What the owner has to do

Deploy the accounts API after stage 1 is merged (`npm run deploy --workspace=server`): it creates the
Durable Object class. Until then the site's live sessions are refused (503) and everything else works
as it does now.
