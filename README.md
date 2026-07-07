# Fimblewood Academy

A homebrew Foundry VTT module for the **Fimblewood Academy** campaign — custom classes, subclasses, and other content built on top of the `dnd5e` system.

- **Foundry VTT:** v13 (build 351) — verified; compatible up to v14
- **Game system:** `dnd5e` v5.3.1+
- **Current version:** 0.3.0

## Installation

In Foundry VTT, go to **Add-on Modules → Install Module** and paste this manifest URL:

```
https://github.com/Gotova/fimblewood-academy/releases/latest/download/module.json
```

This URL always resolves to the latest release, so it never needs to change between updates.

## What's here

- Module bootstrap (`scripts/module.mjs`) and stylesheet (`styles/module.css`)
- A `dnd5e`-aware compendium pack pipeline (`packs/_source` → compiled packs)
- A GitHub Actions release workflow that builds and publishes the module on every version tag
- Version bump tooling to keep `module.json`, `package.json`, and the manifest download link in sync

### Content

**Druid — Circle of Wild Magic** (compendium: *Fimblewood Academy Subclasses*)

A druid circle that channels chaotic Feywild energy. Closely adapted from the "Circle of Wild Magic" homebrew by u/Jigui26 (GM Binder, 2022) — unofficial Fan Content, not approved or endorsed by Wizards of the Coast.

- **Circle Spells** (2nd level) — always-prepared spell list at 2nd/3rd/5th/7th/9th druid level (see the *Fimblewood Academy Class Features* compendium for the full table). Foundry's automatic spell-prepare advancement isn't wired up yet — add the listed spells to the feature's advancement manually if you want them auto-prepared.
- **Chaotic Wild Shape** (2nd level) — Wild Shape can transform into monstrosities (CR 2 at 10th level, CR 3 at 14th).
- **Chaos Weaver** (6th level) — reaction to invert damage/healing on a nearby creature; limited uses per long rest (auto-tracked).
- **Orderly Disarray** (10th level) — immunity to charmed (auto-applied via Active Effect) and see through illusions within 300 ft.
- **Influencing the Unpredictable** (14th level) — bank a Wild Magic Surge roll to use later.

All four leveled features are granted automatically via the subclass's advancement. A **Wild Magic Surge** roll table (d100, compendium: *Fimblewood Academy Roll Tables*) is included and referenced by these features — right-click it in the compendium and choose "Roll" (or drag it onto the hotbar) whenever a feature calls for a surge.

Further classes, subclasses, and other content will be added incrementally as compendium packs under `packs/`.

## Development

Requires [Node.js](https://nodejs.org/) 22+.

```bash
npm install
```

### Authoring compendium content

1. Add or edit source JSON files under `packs/_source/<pack-name>/`.
2. Compile them into LevelDB packs Foundry can read:

   ```bash
   npm run build:packs
   ```

3. Register any new pack in the `packs` array of `module.json`.

To pull changes made in Foundry's compendium UI back into source JSON for version control:

```bash
npm run extract:packs
```

### Releasing a new version

1. Update `CHANGELOG.md` with the changes.
2. Bump the version (updates `module.json` and `package.json`):

   ```bash
   npm run version:bump -- patch   # or: minor | major | x.y.z
   ```

3. Commit the version bump, then tag and push:

   ```bash
   git add -A
   git commit -m "Release vX.Y.Z"
   git tag vX.Y.Z
   git push origin main --tags
   ```

4. GitHub Actions builds the packs, zips the module, and publishes a release with `module.json` and `module.zip` attached. The manifest URL above automatically points at the new release.

## License

Code is released under the [MIT License](LICENSE). Homebrew rules content is original material for the Fimblewood Academy campaign and is unofficial, unaffiliated Fan Content — not endorsed by Wizards of the Coast or Foundry Gaming LLC.
