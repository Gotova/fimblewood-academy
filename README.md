# Fimblewood Academy

A homebrew Foundry VTT module for the **Fimblewood Academy** campaign — custom classes, subclasses, and other content built on top of the `dnd5e` system.

- **Foundry VTT:** v13 (build 351) — verified; compatible up to v14
- **Game system:** `dnd5e` v5.3.1+
- **Current version:** 0.1.0

## Installation

In Foundry VTT, go to **Add-on Modules → Install Module** and paste this manifest URL:

```
https://github.com/Gotova/fimblewood-academy/releases/latest/download/module.json
```

This URL always resolves to the latest release, so it never needs to change between updates.

## What's here

This is currently a clean scaffold — no homebrew content has been authored yet. It includes:

- Module bootstrap (`scripts/module.mjs`) and stylesheet (`styles/module.css`)
- A `dnd5e`-aware compendium pack pipeline (`packs/_source` → compiled packs)
- A GitHub Actions release workflow that builds and publishes the module on every version tag
- Version bump tooling to keep `module.json`, `package.json`, and the manifest download link in sync

Classes, subclasses, and other content will be added incrementally as compendium packs under `packs/`.

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
