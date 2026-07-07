# Changelog

All notable changes to this module are documented here.

## [Unreleased]

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
