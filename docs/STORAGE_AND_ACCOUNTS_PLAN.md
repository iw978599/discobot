# Long-term storage and users — plan

Status: proposed, nothing built. Written 2026-10-08.

## Where things are today

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
need no server. Stage 3 is where users arrive, and it should be a deliberate
choice, not a default.

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

## Stage 3 — accounts and sync (needs a server)

### What it would give

- The same projects on every device after signing in.
- A copy that survives a lost laptop.
- Optionally, public pages for shared songs.

### Three ways to do it

| | A. The user's own cloud drive | B. Hosted backend service | C. Our own server |
|---|---|---|---|
| How | Sign in with Google or Dropbox; projects are files in a folder the app is allowed to see | Supabase or Firebase: sign-in, database and file storage as a service | A small API (for example Cloudflare Workers with a database and object storage) |
| Who holds the data | The user | The service, on our account | Us |
| Running cost | None | Free at small scale, then by usage | Small, but never zero |
| Our obligations | Few: we never see the data | Privacy policy, deletion, data requests | The same, plus security and upkeep |
| Sharing publicly | Awkward | Straightforward | Straightforward |
| Effort | M–L | L | L+ |

**Recommendation:** B (Supabase) if the goal is a product with users and
shared songs; A if the goal is only "my projects on all my devices" with the
least responsibility. C is not worth it at this size.

### Signing in

Use the service's sign-in: a link sent by email, plus "Continue with Google"
and "Continue with GitHub". The app never stores a password. Signing in is
always optional; a signed-out visitor gets exactly today's app.

### What gets stored (option B)

- **Users:** id, email, display name, created date. Nothing else.
- **Projects:** id, owner, name, updated time, revision number, and the
  project as one JSON document. It is the same format as the project file, so
  there is one format to keep compatible.
- **Samples:** files in object storage, named by a hash of their contents so
  the same sample is stored once per user. Private by default, with a size
  limit per user.
- **Shares:** project id, a short link code, and whether it is public.

Each row is readable and writable only by its owner, enforced by the database
itself (row-level security), not only by the app.

### How syncing works

- Every project has a revision number. The browser remembers which revision
  it last saw.
- Saving sends the project with that revision. If the server's revision is
  the same, the save is accepted and the number goes up.
- If the server has moved on (the project was edited on another device), the
  save is refused and the user is offered both versions; the simplest safe
  answer is to keep the other one as "Song (copy from laptop)". Nothing is
  merged automatically and nothing is overwritten silently. This is the same
  rule the two-tab guard already follows.
- Offline edits are queued and sent when the connection returns.
- No live collaboration. Two people editing one song at once is a much larger
  project and is out of scope.

### First sign-in

Projects already in the browser stay there. The app offers to upload them;
it never uploads without being asked.

### What we take on by having users

- A privacy policy and terms, written before launch.
- "Delete my account" that removes everything, and "download my data".
- If songs can be public: a way to report one, and a way to take it down.
  Imported samples can be copyrighted audio, so samples stay private and are
  not included in public shares unless the user explicitly adds them.
- Limits per user on projects and sample storage, so the bill has a ceiling.
- Someone who reads the support address.

### Order of work for stage 3

1. Stage 1 items 1 and 3 first: IndexedDB and the project library. Sync needs
   "a list of projects with ids and revisions" to exist locally.
2. Sign-in and a private "my projects" list that syncs. (L)
3. Samples in cloud storage. (M)
4. Share links backed by the server, and optional public pages. (M)

## Questions to answer before stage 3

1. **Who is this for?** You and friends, or the public? For a handful of
   people, option A or just stage 1 and 2 may be all that is needed.
2. **Do you want public song pages, or only private sync?** Public pages are
   what bring moderation and copyright questions.
3. **Are you willing to be responsible for people's data and an email
   address they can write to?**
4. **Is there a budget?** Supabase's free tier would cover early use; past
   that it is a monthly bill.

## Suggested next step

Do stage 1 items 1 to 4 regardless of the answers: they fix real risks for
every user today and are the foundation for anything later. Decide on stage 3
once those are in and you know who is using it.
