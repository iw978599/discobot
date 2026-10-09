---
name: add-project-field
description: Add a new saved setting to a Discobot project (a synth parameter, an effect setting, something per scene or per guest) without breaking projects, files, links or synced copies saved before it existed. Use whenever a change adds or renames anything that is stored.
---

# Adding a stored field

Every project a user has ever saved must still open and sound the same. Stored
data reaches the app from browser storage, project files, share links,
published songs, synced copies and kept versions, and all of it goes through
`restore()` in `ui/src/services/localService.ts`.

## Steps

1. **Type** (`engine/src/types.ts`): make the field optional. Say in a comment
   what absent means.
2. **Absent must mean "as before".** Pick the neutral value so an old project
   plays and exports exactly as it did. If the new behaviour changes sound,
   keep the old path bit-identical when the field is absent or zero (see
   `reverbImpulse`), and leave a flat or disabled effect out of the export
   graph altogether.
3. **Checks** (`ui/src/services/projectSanitization.ts`): clamp numbers, accept
   only known strings, drop anything else. Never trust a file.
4. **Defaults: know which kind of object it is.**
   - `SynthParameters` and send levels are filled from defaults by
     `sanitizeShape`. Add the field to `createDefaultSynthParameters()` with
     its neutral value and bump `SCHEMA` in `localService.ts`.
   - `effectsLoop` and `drumState` are compared against the defaults with
     `matchesShape`, and a mismatch reports the project as damaged. Keep new
     fields **out** of the defaults passed to `localService`, and add them
     back by hand at the end of `sanitizeEffects`. Put the values the controls
     show before the field is set in `effectSettings.ts`.
   - A scene's extras (`guests`, `guestMix`, `mutes`) are optional keys added
     in `sanitizeScenes`; `sceneBar` must carry them through or exports lose
     them.
5. **State that is merged** (`normalizeEffectsLoop` in `useStudio.tsx`): if a
   control can return a field to its "off" value, always include it in the
   object sent to the store, or the store's merge keeps the old value.
6. **Live and export together.** Sound belongs in the engine cores or in a
   builder shared by `browserAudio.ts` and `wavExport.ts`. Use `seededRandom`
   for anything random in an export.
7. **New projects only** get non-neutral starting values, in `blankState`.
8. **Tests.** A unit test that an old project (the field deleted from an
   exported file) imports unchanged and is not reported damaged; that hostile
   values are bounded; and, for sound, that absent equals the old output.
9. **Docs.** One line under "Behaviour Worth Knowing" in `AGENTS.md` for
   anything a later change could break by not knowing it.

## Things that have gone wrong before

- Adding a field to the effects defaults made every older project load as
  "damaged".
- A control that could not be set back to zero, because the zero was dropped
  before the store's merge.
- A per-scene field lost in song export because `sceneBar` rebuilt the scene
  without it.
- Filtering a song export by the open scene's mutes. Mutes are per scene: use
  `applySceneMutes` and hand the lanes to the exporter unmuted.
