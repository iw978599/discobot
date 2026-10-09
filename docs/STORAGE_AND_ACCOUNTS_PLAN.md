# Long-term storage and users — plan

Status: proposed, nothing built. Written 2026-10-08; stage 3 revised the same day after the owner's decisions.

## Progress

- **Stage 1, items 1 to 3: built** on `feat/project-library`. Every project is a
  record in IndexedDB; "saved arrangements" became projects; the Projects
  dialog lists, opens, renames, copies and deletes them, and asks the browser
  for persistent storage. One difference from the plan: the open project also
  keeps a working copy in `localStorage`, because that can be written at the
  instant a tab closes and IndexedDB cannot. The library record is updated
  alongside it.
- **Stage 1, item 4 (automatic versions): not built.** "Save a Copy" is the
  manual version of it.
- **Stage 1, items 5 to 7: not built.**
- **Stage 2, share by link: built.** A link carries the song; opening it shows
  a page that plays it and offers a copy. No account and no server.
- **Stage 3, step 2 (the API and accounts): built.** Sign up with an invite
  code, sign in, sign out, recovery codes, change password, delete account,
  and the owner's invite codes and member list. The API runs on Cloudflare at
  `https://discobot-api.discobot-server.workers.dev`. Only the owner creates
  invite codes. Samples will not sync at first: Cloudflare's file storage (R2)
  needs a payment card, so projects go in the database and samples wait.
- **Stage 3, step 3 (project sync): built.** Projects made while signed in
  are kept in the account and follow it to other browsers. Projects that were
  in the browser before signing in are added by hand. A project changed in
  two browsers is kept twice. An account holds up to 100 projects of up to
  400 KB each. Sync runs a few seconds after an edit, when the page comes
  back into view, every two minutes, and from a Sync Now button.
- **Stage 3, steps 4 and 5 (public pages, samples): not started.**

## Where things were when this was written

- A project lives in one browser profile: `localStorage` for the project and
  saved arrangements, IndexedDB for imported samples.
- **Export Project** writes everything except samples to a JSON file, and
  **Import Project** reads it back. That is the only backup and the only way to
  move between devices.
- There are no users. The site is static files on GitHub Pages, with no server.

What can go wrong for someone using it now:

- Clearing site data, or a private window, loses everything.
- Safari deletes a site's stored data after seven days without a visit unless
  the site is installed to the home screen.
- `localStorage` is capped at about 5 MB per site. Saved arrangements each hold
  a full copy of the project, so a keen user can reach it.
- Nothing moves between a laptop and a phone unless they export and import by hand.

## The decision that shapes everything

"Handling users" means accounts, and accounts mean a server that holds
people's data. That reverses a rule this project has followed since the
Discord version was removed: no backend, no authentication (see `AGENTS.md`).
It can be the right call, but it brings running costs, a privacy policy,
account deletion, and someone responsible for the data.

So the plan is in three stages. Each is useful on its own, and the first two
need no server. Stage 3 is where users arrive. The owner has chosen to go
there, with the limits recorded under stage 3.

Throughout: **the browser copy stays the working copy.** The app must keep
working offline and signed out. Anything in the cloud is a copy that syncs.

## Stage 1 — make local storage dependable (no server)

1. **Move the project store to IndexedDB.** (M) Removes the 5 MB cap, stops
   blocking the page on every save, and lets a saved arrangement be its own
   record instead of part of one large blob. Migrate from `localStorage` on
   first run and keep the old copy until the new one is confirmed.
2. **Ask the browser not to evict the data.** (S) `navigator.storage.persist()`.
   Chrome grants it to installed or frequently used sites; Firefox asks the
   user. Show whether it was granted.
3. **A library of projects.** (M) Today there is one project plus "saved
   arrangements", which are really whole projects under another name. Replace
   both with a list of named projects: new, open, duplicate, rename, delete.
   This is also the shape any later sync needs.
4. **Automatic versions.** (S) Keep the last 20 or so snapshots of each
   project, taken when it is closed or every few minutes of editing, with
   "restore this version". This protects against mistakes that undo cannot
   reach after a reload.
5. **Samples inside the project file.** (M) Export a zip holding the project
   JSON and its sample files, so a backup is complete.
6. **Save to a real file.** (M) In Chrome and Edge the File System Access API
   lets a project be a file on disk that the app keeps saving to, like a
   desktop program. The user then owns the file and can put it in any synced
   folder they already use. Other browsers keep export and import.
7. **Backup reminder.** (S) If a project has changed a lot since its last
   export and the browser has not granted persistent storage, say so once.

Result: nobody loses work to the browser, and a careful user has complete
backups, with no accounts.

## Stage 2 — sharing without accounts (no server)

1. **Share by link.** (M) Compress a project into the part of the URL after
   `#`. Opening the link loads it as a new local project. Works for small
   projects without samples; a typical one is a few kilobytes.
2. **Share by file.** Already possible with the project file; make "Open
   project" accept a file dropped onto the page.

Result: people can send each other songs. Still no server and nothing to
moderate, because nothing is hosted.

## Stage 3 — accounts, sync and public song pages (needs a server)

### Decisions made (2026-10-08)

- **Who it is for:** friends, mostly.
- **Public song pages:** wanted.
- **Accounts:** a username and a password, and nothing else. No email
  address, no real name, no other personal information.

### What those decisions lead to

**No email means no "forgot my password".** There is nowhere to send a reset
link. Instead, sign-up shows a **recovery code** once, to be written down; it
can set a new password. Someone who loses both the password and the code
loses the account, though not the projects in their browser. This is the one
real cost of collecting no email, and people need to be told at sign-up.

**No email means anyone can make accounts without limit.** With public pages
that invites spam. Since this is for friends, sign-up needs an **invite
code**: you generate codes and hand them out. That also keeps storage costs
bounded and means every account belongs to someone you know.

**Hosted sign-in services do not fit.** Supabase and Firebase build their
accounts around an email address or phone number. Username-only sign-in means
a small server of our own that stores a username and a password hash. This
changes the earlier recommendation from a hosted service to a small API.

### What to build it on

A Cloudflare Worker (the API), with Cloudflare's D1 database for accounts and
projects and R2 object storage for samples. Reasons: the free allowance is far
more than a group of friends will use, there is no machine to maintain, and
the site itself can stay on GitHub Pages. It needs a Cloudflare account in
your name; that is the one thing I cannot set up for you.

### What gets stored

- **Accounts:** username, password hash, recovery-code hash, created date,
  and which invite code was used. Nothing else. No IP addresses are kept by
  the app.
- **Sessions:** a random token per signed-in browser, stored as a hash, with
  an expiry. "Sign out everywhere" deletes them.
- **Projects:** id, owner, name, updated time, revision number, and the
  project as one JSON document in the same format as the project file.
- **Samples:** files in object storage, named by a hash of their contents,
  private, with a size limit per account.
- **Public pages:** project id, a short code for the link, a title, and the
  published copy of the project.

### Passwords

- Stored only as a salted hash made with a slow, standard function (PBKDF2 or
  scrypt, as strong as the platform's limits allow). Never logged, never
  stored in plain form.
- A minimum length of ten characters and a check against the most common
  passwords. No rules about symbols.
- Sign-in attempts are limited per username, so a password cannot be guessed
  by brute force.
- Usernames are public (they appear on song pages), so the sign-up form
  should say: do not use your real name if you do not want it shown.

### How syncing works

- Every project has a revision number. The browser remembers which revision
  it last saw.
- Saving sends the project with that revision. If the server's revision is
  the same, the save is accepted and the number goes up.
- If the server has moved on (the project was edited on another device), the
  save is refused and both versions are kept, the other as "Song (copy from
  laptop)". Nothing is merged automatically and nothing is overwritten
  silently. This is the rule the two-tab guard already follows.
- Offline edits are queued and sent when the connection returns.
- No live collaboration.

Signing in is always optional. Signed out, the app is exactly what it is
today. On first sign-in the app offers to upload the projects already in the
browser; it never uploads without being asked.

### Public song pages

- **Publish** makes a public, read-only copy of a project at a short link.
  The page shows the title and the author's username, plays the song, and has
  **Open a copy**, which loads it into the visitor's own browser.
- Publishing is a snapshot: later edits do not change the page until you
  publish again. **Unpublish** removes it.
- A profile page lists a user's published songs.
- Imported samples are not included in public pages at first. They can be
  copyrighted audio, and hosting them publicly is the part most likely to
  cause trouble.
- Visitors do not need an account to listen or to open a copy.

### What we still take on

Even with no email or personal details:

- A short, plain privacy note saying exactly what is stored (the list above).
- **Delete my account**, which removes the account, its projects, samples and
  pages. **Download my data**, which is the existing project file export.
- A way for you, as the owner, to remove a published page or an account.
- Limits per account on projects, sample storage and published pages.

### Order of work

1. **Stage 1 items 1 and 3 first:** IndexedDB and the project library. Sync
   needs a local list of projects with ids and revisions. (M each)
2. **The API and accounts:** sign up with an invite code, sign in, sign out,
   recovery code, delete account. (L)
3. **Project sync:** upload, download, revisions and the keep-both rule. (L)
4. **Public pages:** publish, the read-only player page, open a copy,
   profile page. (M)
5. **Samples in the cloud.** (M) Last, and optional.

### Still to decide

1. **A Cloudflare account** to host the API, or another host you prefer.
2. **The address.** The API can live at a `workers.dev` address for free; a
   custom domain is optional and would also give public pages nicer links.
3. **Who can create invite codes:** only you, or any member.

## Suggested next step

Stage 1 items 1 to 4. They fix real risks for every user today, and items 1
and 3 are required before any sync can be built. The server work can start
as soon as there is a Cloudflare account to deploy to.
