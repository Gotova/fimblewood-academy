# Changelog

All notable changes to this module are documented here.

## [Unreleased]

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
