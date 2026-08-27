# Changelog

All notable changes to this module are documented here.

## [Unreleased]

## [0.8.0] - 2026-08-27

### Added

- Jukebox music is now **scoped to the hideout scene** — the scene the record-player prop stands on. Each client silences the jukebox locally while viewing any other scene and fades it back in on return, so a player who wanders off stops hearing it without stopping it for everyone else, and rejoins the song already in progress when they come back. Playback itself is untouched: the shared Playlist keeps running in sync for whoever is still in the hideout.
  - If the prop hasn't been placed on any scene yet there is no hideout to scope to, so the jukebox stays audible everywhere rather than going silent world-wide.
- `diagnoseJukebox()` now also reports which scenes hold the prop and whether the client is currently viewing one.

## [0.7.1] - 2026-08-27

### Fixed

- Proximity collection measured distance from the token *placeable* rather than its document, so a check running off the `updateToken` hook could read the position the token was animating from instead of the one it just landed on. Now measured from the document.
- The proximity check swallowed any measurement error and returned "not in range", which meant a single failure left proximity collection permanently dead with nothing in the console. Errors are now logged.
- The GM's Music Tracks tool was added to the scene controls for every user with `visible: false` on player clients. It is now not registered at all for players, since an invisible entry is still a real tool as far as core's control activation is concerned.

### Added

- `game.modules.get("fimblewood-academy").api.jukebox.diagnoseJukebox()` — reports why proximity collection isn't firing on the client it's run from: the collecting master switch, whether that client owns a token on the canvas, and each tagged ambient sound's radius against the measured distance. The collection paths are deliberately silent, so there was previously nothing to inspect when a record didn't drop.

## [0.7.0] - 2026-08-27

### Added

- **Music Tracks manager** — a GM-only console for the Hideout Jukebox, opened from a new "Music Tracks" button in the Fimblewood Controls scene-control category (next to the Draw Pad and Gallery). Unlike the player-facing Jukebox window, it lists *every* registered record, collected or not:
  - Each row shows its cover art, name, audio path and a Collected/Uncollected status pill. Clicking the pill flips the party's collection state for that record — granting writes it to every non-GM user, revoking clears it from everyone — so a test run can be wound back before the real session.
  - "Collect All" and "Reset All" do the same across the whole registry in one click.
  - Add, edit (name, audio file and cover art) and delete records without going through a token/item/sound config sheet. Edits sync straight into the managed Playlist.
  - Play/Stop each record straight from the manager for a quick audition.
- **Collecting on/off master switch** (`jukeboxCollectionEnabled`, also exposed as a world setting) — toggled from the top of the Music Tracks window. While off, no player-facing source hands out records: ambient-sound proximity, map pickups and item grants all no-op, and a clicked pickup token stays on the map instead of being consumed. The GM's manual grants in the manager still work.

### Fixed

- The Jukebox window re-registered its `updatePlaylistSound` hook on every render, stacking duplicate listeners that each triggered another render. It now wires its hooks exactly once per open window.
- The Jukebox window now also refreshes when collection state changes, so records the GM grants or revokes appear and disappear live on player clients instead of needing the window reopened.

## [0.6.2] - 2026-08-26

### Fixed

- Play/Stop/Rename/Delete in the Jukebox window did nothing — verified live that clicking Play never even reached `playSound()` (the target `PlaylistSound`'s `playing` field stayed `false`). The buttons relied on `ApplicationV2`'s built-in `data-action`/`DEFAULT_OPTIONS.actions` dispatch, which didn't reliably fire. Replaced with a manually-wired delegated click listener attached directly to the window's content element, removing the dependency on that mechanism entirely.

## [0.6.1] - 2026-08-26

### Fixed

- The Jukebox's "make this token clickable by every player" logic (`forceJukeboxTokenOwnership`) was a silent no-op — it tried to set `ownership.default` directly on the `TokenDocument`, but `TokenDocument` has no `ownership` field of its own; control permission is inherited entirely from the token's Actor. Fixed to grant ownership on the token's actor instead. A one-time catch-up pass on world load re-applies this to any token that already had a `recordPickup`/`recordPlayer` flag set before this fix, so existing setups self-heal without needing the GM to re-toggle each token's config by hand.

## [0.6.0] - 2026-08-26

### Added

- **Hideout Jukebox** — a party-shared music collection built on Foundry's native Ambient Sound and Playlist documents:
  - Tag an Ambient Sound, an Item, or a map-placed token with a "Jukebox Track" (a small GM-only picker injected into each one's own configuration sheet; naming a brand-new track happens inline the first time you tag one, via a small dialog — no separate track-manager screen).
  - Players collect a track by walking within an Ambient Sound's own audible radius, receiving a tagged item (which stays in their inventory as a keepsake — never consumed), or clicking a tagged map pickup token (which then disappears for everyone). Collection is party-wide: whoever triggers it, the whole table gets it.
  - Every collection announces itself to the whole table with a short reward sound (a GM-configurable world setting) and a "Record "<name>" collected!" banner.
  - A record-player prop token, placed by the GM anywhere in the world, opens the Jukebox window on click — listing every track the party has collected, with Play/Stop per track. Playback uses a module-managed Playlist with player-level ownership, so it plays in sync for every connected client (including ones who join mid-song) via Foundry's native Playlist sync — no custom broadcast code needed for that part.
  - GM-only rename/delete controls live in the same Jukebox window; there's no separate management screen and no sidebar shortcut — the record-player prop is the only way in, by design.

### Known issues

- The exact hook name and DOM anchor for injecting the track picker into dnd5e's Item sheet (`renderItemSheet5e`, per dnd5e's documented naming convention) haven't been verified against a live install — this repo has no Foundry/dnd5e runtime to test against. Verify live and adjust the anchor/hook name if needed; the Ambient Sound and Token Config injections use the same pattern and are lower-risk since those are stable core Foundry classes.
- The new-track dialog's audio/art file fields use Foundry v13's `<file-picker>` custom form element — unverified live for the same reason. If it doesn't render as expected, it's a contained fix inside `promptNewTrack()` in `scripts/jukebox.mjs`.

## [0.5.0] - 2026-08-26

### Fixed

- The 0.4.0 port of the Magic Circle Draw Pad was built from a stale copy: the `scripts/foundrydraw.js` committed to FoundryDraw's own git repository (1158 lines, raster canvas engine) turned out to be out of sync with `foundrydraw.zip` in that same repo — the file that actually gets installed, and what this campaign was really running (2862 lines, SVG-based). This release replaces the port wholesale with a faithful port of the real, currently-shipping script, restoring everything that was missing:
  - **Live-draw broadcast** — GM-only "Go Live" toggle streams the drawing to all players in real time (~200ms throttle while drawing, immediate on stroke end); a live viewer window opens automatically on player clients and closes when broadcasting stops.
  - **Select tool** — click, Shift-click, or marquee-drag to select one or more shapes; drag to move, drag the handle to rotate; Ctrl snaps to 45°, Alt snaps to the grid; Delete/Backspace or the ✕ button removes the selection.
  - **Text tool** — click to place vector text, sized from the brush-size slider.
  - **Ink counter & spell-level badge** — tracks total stroke length and estimates the spell level a circle can hold (Cantrip through 9th, or beyond).
  - **Gallery folders** — organize saved circles into named, collapsible, drag-to-reorder folders.
  - **Per-user gallery storage** — the gallery is now a flag on your user document (follows you to any machine you log into as that user) instead of a world setting.
  - **SVG drawing engine** — infinite resolution at any zoom, exports as true `.svg`; replaces the old raster canvas (flood-fill, a raster-only operation, is gone as a result — matching upstream).
  - Paper-grain background texture, eraser cursor ring, "send to chat," Ctrl/Alt/Shift modifier keys for shape and select-tool precision.
  - The scene-control registration and the `activeTool` auto-open fix from 0.4.2 were re-applied on top of the real engine.

### Changed

- Gallery data from the 0.4.0–0.4.2 releases (a world setting) is not carried over to the new per-user flag storage — those releases shipped too recently for this to likely matter, but re-save anything you created under them.

## [0.4.2] - 2026-08-26

### Fixed

- Clicking the **Fimblewood Controls** category itself (not one of its two buttons) was opening the Magic Circle Draw Pad automatically. Foundry requires a scene-control category's `activeTool` to name a real tool, and fires that tool's `onChange` the instant the category becomes active — not just when its button is clicked. Both real tools here (draw pad, gallery) are one-shot actions, so pointing `activeTool` at either popped its window open on category select. Fixed with an invisible, no-op placeholder tool as the default `activeTool`; the draw pad and gallery now only open when their own buttons are clicked.
- The custom category icon (a hand-drawn house-with-star-cutout SVG) looked malformed at the toolbar's actual 20px size. Replaced with Font Awesome's own `fa-house` glyph — crisp at any size — with a small gold star badge overlaid on top via a CSS `::after` mask, instead of trying to hand-draw the whole shape.

## [0.4.1] - 2026-08-26

### Changed

- The scene control category is now titled **"Fimblewood Controls"** (was "Magic Circle Tools"), and uses a custom icon — a house silhouette with a star cut out of the centre, evoking a school crest — instead of a generic Font Awesome wand icon. Implemented as a small inline SVG applied via CSS mask (`styles/module.css`), so it still follows the sidebar's hover/active coloring like every other control icon.

## [0.4.0] - 2026-08-26

### Added

- **Magic Circle Draw Pad**, merged in from the standalone [FoundryDraw](https://github.com/Gotova/FoundryDraw) module: a drawing canvas for painting magic circles, with brush/eraser/line/circle/rectangle/flood-fill tools, rotational symmetry (2/4/6/8/12-fold), pan/zoom, up to 20-step undo/redo, PNG/clipboard export, and a saved-circle gallery. GMs can push a drawing out to all players.
- A new **Magic Circle Tools** category in the scene control bar (left sidebar), separate from Token Controls, holding the draw pad and gallery buttons.
- German translations for the draw pad (`lang/de.json`), also carried over from FoundryDraw.

### Changed

- FoundryDraw's two buttons no longer appear inside Token Controls — the module now registers its own top-level control group instead of adding tools to an existing one.

### Known issues

- The draw pad and gallery windows are still built on Foundry's Application V1 / Dialog V1 APIs (unchanged from FoundryDraw). These are deprecated as of v13 and still function through v14, but will need porting to ApplicationV2/DialogV2 before a future Foundry version removes them.
- The gallery is a new world setting under this module's namespace; circles saved in FoundryDraw's gallery do not carry over automatically. Re-save anything you want to keep after switching over.
- If FoundryDraw is left active alongside this module, both will register competing scene controls and separate galleries. Disable FoundryDraw once you've confirmed this module's draw pad works for you.

## [0.3.7] - 2026-07-07

### Fixed

- Actually fixed the "Cancel acts like Crook the Strike" bug (0.3.6's `type="button"` change addressed a real but different double-submit risk — it wasn't the cause of this specific symptom). The real cause: Foundry's `DialogV2._onSubmit` computes `result = (await callback()) ?? button.action`, so a callback that explicitly returns `null` (as Bend Magic's Cancel button did) gets silently replaced with the button's own action string `"cancel"` — a truthy value. That string passed the code's `if (!choice) return` guard, and since it has no `.effect` property, the message defaulted to "Crook the Strike". Cancel callbacks across the module now return `false` (falsy, but not nullish, so it survives `??`) instead of `null`. Verified live with an isolated dialog test before shipping.

## [0.3.6] - 2026-07-07

### Fixed

- Clicking "Cancel" on Bend Magic (and other multi-button prompts) could act like a different button was clicked instead. Foundry's `DialogV2` buttons default to `type="submit"`, which fires the dialog's result callback twice — once via the button's own click handler (correctly identifying the clicked button), and again via the native form "submit" event (which can resolve to the wrong button under a race). All dialog buttons now use `type="button"`, which only allows the correct click handler to fire.

## [0.3.5] - 2026-07-07

### Fixed

- Resonance could exceed its maximum from ordinary gains (clicking the bar, Active Siphon) if the internal "Mana Surge is active" flag ever got stuck on — that flag bypassed the Resonance cap for *every* gain, not just Mana Surge itself. The cap bypass is now scoped exclusively to the one Mana Surge gain that's supposed to exceed it; every other source of Resonance is always clamped to the maximum.
- Actors left with Resonance above their maximum by this bug are corrected automatically the next time the world loads.

### Added

- Right-click the Resonance bar to remove 1 Resonance (left-click still adds 1).

## [0.3.4] - 2026-07-07

### Fixed

- Mana Surge and Resonant Sundering (Unblooded Magic, level 18) never triggered because dnd5e's core Innate Sorcery doesn't create a tracked Active Effect on its own — there was nothing for the code to detect. The module now creates its own 1-minute marker effect when Innate Sorcery is activated, confirmed against the live item's actual "1 minute" duration text, and both features key off that instead.
- Verified live: Drain Magic correctly ends a matching ongoing spell effect and restores the target's slot; Mana Resistance's Midi QoL flags apply correctly on a freshly-granted Resonant Reserve.

## [0.3.3] - 2026-07-07

### Added

- Actual Drain Magic / Improved Drain Magic automation (was previously documented but never implemented): targets a willing creature, ends a matching ongoing spell effect and restores a slot, or spends Resonance for the same effect if no ongoing spell qualifies.
- Mana Resistance (Resonant Reserve, 10 Resonance) now actually grants Advantage on saves against spells via Midi QoL per-school flags, instead of being description-only.
- Resonant Sundering (Unblooded Magic, level 18) now actually applies Disadvantage to Constitution saves against the sorcerer's own spells/features while Innate Sorcery is active, toggled live as Innate Sorcery starts/ends (via Midi QoL).

### Fixed

- Absorb Magic's bonus Sorcery Points now correctly target the "Font of Magic" feature's uses (the actual mechanism dnd5e uses for Sorcery Points) instead of a nonexistent `system.resources` path.
- Passive Siphon's damage-target detection now reads the correct Midi QoL workflow field (`damageList[].actorUuid`) instead of a nonexistent token reference, so it was never actually firing on damage before this fix.

## [0.3.2] - 2026-07-07

### Fixed

- Bend Magic / Redirect Magic / Cast via Resonance dialogs could pass a non-numeric amount through to Resonance spending, which — because the old spend check used `<` against `NaN` (always false) — silently wiped an actor's Resonance to 0 instead of failing safely. `addResonance`/`spendResonance` now reject non-finite amounts outright, and the dialogs clamp/validate their inputs before spending. Found and fixed during live testing.
- Removed dead no-op code in Redirect Magic's range check.

## [0.3.1] - 2026-07-07

### Fixed

- Nearby-spellcasting detection (Active Siphon, Bend Magic, Redirect Magic) never triggered because the token lookup used `getActiveTokens(true, true)`, which returns `TokenDocument`s instead of canvas placeables — their `.center` isn't compatible with `canvas.grid.measurePath`, silently crashing the hook. Verified live: fixed and confirmed detection now works at range.
- Hardened distance checks against a canvas grid error observed on live tokens so one bad token can't silently kill the whole nearby-spellcasting scan.

## [0.3.0] - 2026-07-07

### Added

- **Sorcerer — Unblooded Sorcery** subclass, closely adapted from "Unblooded Sorcery" (2026): replaces Spell Slots with a custom **Resonance** resource. Includes Spellcasting Modifications, Mana Siphon, Resonant Reserve, Bend Magic, Drain Magic, Absorb Magic, Occult Shroud, Redirect Magic, Improved Drain Magic, and Unblooded Magic.
- A purple Resonance bar on the character sheet, below Hit Dice, for any actor with this subclass.
- Automation: Resonance gain (Active/Passive Siphon), spending Resonance to cast spells, Resonant Reserve threshold effects, and more — see README for the full automation breakdown.
- The PDF's "Mana Siphon table" was missing from the source document; Resonance gained from siphoning equals the siphoned spell's level (campaign ruling).

## [0.2.1] - 2026-07-07

### Fixed

- Broken icons on the subclass and on Chaotic Wild Shape, Orderly Disarray, and Influencing the Unpredictable — the original paths didn't exist in Foundry's core icon set. Verified the new paths live against a running Foundry v13.351 instance.
- Verified against a live instance that dragging the subclass onto a Druid actor correctly links it to the class and grants its features under "Druid Features" — this was already working; the broken icons just made it look wrong.

## [0.2.0] - 2026-07-07

### Added

- **Druid — Circle of Wild Magic** subclass, closely adapted from the "Circle of Wild Magic" homebrew by u/Jigui26 (GM Binder, 2022): Circle Spells, Chaotic Wild Shape, Chaos Weaver, Orderly Disarray, and Influencing the Unpredictable.
- **Wild Magic Surge** d100 roll table used by the above features.
- New `classfeatures` and `rolltables` compendium packs, plus a `packFolders` grouping for all Fimblewood Academy packs in the compendium sidebar.

## [0.1.0] - 2026-07-07

### Added

- Initial module scaffold: manifest, module bootstrap script, styles, and language file.
- Compendium pack build tooling (`packs/_source` → compiled LevelDB packs via `@foundryvtt/foundryvtt-cli`).
- GitHub Actions release workflow that builds and publishes `module.json` + `module.zip` on tag push.
- Version bump helper script.
