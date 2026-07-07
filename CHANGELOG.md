# Changelog

All notable changes to this module are documented here.

## [Unreleased]

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
