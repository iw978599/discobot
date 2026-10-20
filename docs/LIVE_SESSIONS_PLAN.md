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
order. A browser applies someone else's edit, then applies again any edit of its own that is still
on its way and whose keys overlap it (its own was ordered after, so it must land on top, as it will
everywhere else). Keys are paths (`synth/2/sound/filter/frequency`, `scenes/<id>/synth/2/pattern`),
and two overlap when one is the start of the other, so a whole pattern and one cell of it overlap.
Every browser ends with the edits applied in the room's order, without a clock or a counter. Simply
skipping the other person's edit is not enough: where it covers more than one's own (a whole
pattern against a cell), the browsers would differ.

Stage 2 in detail:

- `ui/src/services/liveSession.ts` runs while the open project is shared (`projectSync.status()`:
  `shared[id]` names the owner, `sharedByMe[id]` makes it one's own) and its person is signed in.
  The socket is opened by `openLiveSocket(owner, id)` in `account.ts`, so the token stays there.
- It hears local edits through `localService.subscribeOps`, sends those `OP_META` marks `share`
  and whose origin is `local` as `{ t: 'op', n, edits: [{ op, scene }] }`: one message for the
  edits of about 40 ms, a run of edits to the same keys sent as its last, so a knob's drag is a few
  messages, not hundreds. The keys are not sent; each browser works them out (`editKeys`).
- A remote edit is applied with the `remote` origin (kept out of undo, never sent again), in the
  scene it was made in: the browser opens that scene for it with `scene.select` and goes back.
- A joiner applies the host's project through `syncReceive`, which keeps a version first, then the
  edits that arrived meanwhile.
- Undo and redo send `replace` with the whole project; a receiver puts it back as undo does
  (`restoreContent`), keeping a version, and does not send it on.
- Project sync is held for everyone but the host during a session (a hold in `startProjectSync`).
- The logic is a plain object given its socket, store and clock, so a unit test can run two
  browsers and a room against each other.

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
   is opened by someone signed in. **Done.** As built, beyond the design above:
   - Opening a scene is not sent (`scene.select` became `share: false`): each person opens their own.
   - A guest's own settings are not sent; each browser's guest reports its own.
   - Reset All sends the whole project, like undo, because it makes a scene id inside the store.
   - A lane's id is put in the operation before it is applied (`createLane`), and the studio sets up
     a lane made by someone else from its event alone.
   - How the sync hold ends: `adopt` when a browser takes over the saving mid-session, `yield` when
     it leaves others in the session, and the usual "keep both" when the connection is lost. Without
     these, every change of who saves split the project in two.
   - Known limits: someone else's undo forgets your own undo steps (the whole project is put in
     place); an edit made in a scene that is gone when it arrives is dropped; edits made while
     disconnected are replaced by the session's project on joining again (a version is kept); a
     project over the room's 600,000-character message limit cannot be sent, and the session ends.
     There is nothing on screen yet that says a session is on; that is stage 4.
3. The transport. **Done.** As built: a play is a moment on the sender's clock and a tick, with the play
   mode, song entry and count-in; each browser measures the others' clocks through the room (the
   quickest of three round trips) and starts its transport at that moment on its own, skipping
   ahead when it is already past. Pressing Play while someone else's music plays listens along from
   where it is; Stop stops everyone; two starts at once keep the earlier; someone joining is told
   where the music is. A browser whose page has not been touched cannot start its audio, so it says
   who is playing and waits for Play. Known limits: a tempo change while playing reaches each
   browser when its edit arrives, so the beats can slip by that delay's share of a beat; the
   computers' audio clocks drift by a few milliseconds a minute and nothing pulls them back during
   a long play; the clock measurement is as good as the room's round trip is even in both
   directions. Not verified by ear across two real computers.
4. Presence on screen. **Done.** A line under the top bar says who else is in the session, each name
   in their colour; each unit someone was last at (the one they last pressed or moved the keyboard
   into) has a stripe of their colour and their name, and so does its switch on a phone's bar of
   units. A place is sent only when it changes. Not looked at on a screen yet: the design pictures
   are taken on GitHub for a design-review branch.

## After the four stages: playing together

Asked for by the owner on 2026-10-20, with an option to snap to the beat. Keys pressed and let go on
a lane, and drum pads hit, go to the others as `jam` on the transport channel (no change to the room)
and are heard on the same lane in each browser, with its own sound and mutes, never recorded. With
Snap on (each browser's choice, starting on) and the music playing, someone else's note starts on the
next sixteenth here, which hides the 50 to 150 ms the room takes; with it off, or while stopped, it
plays as it arrives. Known limits: two people playing one lane with its arpeggiator on share one
arpeggio; a pitch bend or the mod wheel is not sent; snap ignores swing. Not verified by ear.

## Deploying

The accounts API with the relay was deployed on 2026-10-20, creating the Durable Object class. A later
stage that changes `server/` needs `npm run deploy --workspace=server` again; until then the site can
be ahead of the API, and a refused live session leaves everything else working as it does now.
