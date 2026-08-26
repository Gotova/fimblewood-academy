# Fimblewood Academy

A homebrew Foundry VTT module for the **Fimblewood Academy** campaign — custom classes, subclasses, and other content built on top of the `dnd5e` system.

- **Foundry VTT:** v13 (build 351) — verified; compatible up to v14
- **Game system:** `dnd5e` v5.3.1+
- **Current version:** 0.3.4

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
- **Magic Circle Draw Pad** (`scripts/draw.mjs`, `styles/draw.css`) — merged in from the standalone [FoundryDraw](https://github.com/Gotova/FoundryDraw) module

### Magic Circle Draw Pad

A drawing canvas for painting magic circles, available to every player and the GM via a dedicated **Fimblewood Controls** category in the scene control bar (left sidebar) — a house-and-star crest icon, separate from Token Controls.

- **Tools:** brush, eraser, line, circle, rectangle, flood-fill — each with adjustable color, brush size, opacity, and a stroke-smoothing stabilizer.
- **Symmetry:** none, or 2/4/6/8/12-fold rotational symmetry around a fixed centre point — ideal for magic circles. Start with a dark background, 6- or 8-fold symmetry, and draw outward from the centre.
- **Canvas:** a 2000×2000 virtual drawing surface with independent pan (right-drag) and zoom (scroll wheel); the symmetry centre never drifts regardless of window size or viewport.
- **Undo/redo:** `Ctrl+Z` / `Ctrl+Y` (or `Ctrl+Shift+Z`), up to 20 steps.
- **Export:** save as PNG, copy to clipboard, or save to a **Gallery** (a world-scoped setting) for later reuse — gallery entries can be renamed, reloaded into the draw pad, or deleted.
- **GM tools:** push the current drawing, or any gallery entry, out to all connected players as an image popout (requires the module's socket, already enabled).

This module and [FoundryDraw](https://github.com/Gotova/FoundryDraw) should not be run together — disable FoundryDraw once you've switched to this built-in version, otherwise you'll get duplicate buttons and two separate galleries.

### Content

**Druid — Circle of Wild Magic** (compendium: *Fimblewood Academy Subclasses*)

A druid circle that channels chaotic Feywild energy. Closely adapted from the "Circle of Wild Magic" homebrew by u/Jigui26 (GM Binder, 2022) — unofficial Fan Content, not approved or endorsed by Wizards of the Coast.

- **Circle Spells** (2nd level) — always-prepared spell list at 2nd/3rd/5th/7th/9th druid level (see the *Fimblewood Academy Class Features* compendium for the full table). Foundry's automatic spell-prepare advancement isn't wired up yet — add the listed spells to the feature's advancement manually if you want them auto-prepared.
- **Chaotic Wild Shape** (2nd level) — Wild Shape can transform into monstrosities (CR 2 at 10th level, CR 3 at 14th).
- **Chaos Weaver** (6th level) — reaction to invert damage/healing on a nearby creature; limited uses per long rest (auto-tracked).
- **Orderly Disarray** (10th level) — immunity to charmed (auto-applied via Active Effect) and see through illusions within 300 ft.
- **Influencing the Unpredictable** (14th level) — bank a Wild Magic Surge roll to use later.

All four leveled features are granted automatically via the subclass's advancement. A **Wild Magic Surge** roll table (d100, compendium: *Fimblewood Academy Roll Tables*) is included and referenced by these features — right-click it in the compendium and choose "Roll" (or drag it onto the hotbar) whenever a feature calls for a surge.

---

**Sorcerer — Unblooded Sorcery** (compendium: *Fimblewood Academy Subclasses*)

A Sorcerous Origin built around **Resonance**, a resource that replaces Spell Slots entirely. Closely adapted from "Unblooded Sorcery" (2026). One rule from the source PDF was left underspecified: the text references a "Mana Siphon table" for how much Resonance you gain from siphoning another creature's spell, but that table isn't actually printed anywhere in the document. Per a campaign ruling, **Resonance gained from siphoning equals the siphoned spell's level.**

Requires [Midi QoL](https://foundryvtt.com/packages/midi-qol) for full automation (already active in this world) — a few pieces degrade gracefully without it, noted below.

**Resonance display:** a purple bar on the character sheet, directly below Hit Dice, for any actor with this subclass. Maximum is twice your Proficiency Bonus; it resets to 0 on a Long Rest.

#### What's automated

- **Spellcasting via Resonance** — Spell Slots are forced to 0 automatically. Casting a 1st-level-or-higher spell intercepts the normal cast flow, lets you pick an upcast level (up to your max, computed from the real Sorcerer Slot table — not from your zeroed slots), deducts the right amount of Resonance (including the Charged Focus discount, see below), and blocks the cast if you can't afford it.
- **Active Siphon** — the module watches for any creature casting a spell within 60 ft and prompts you to spend a use to gain Resonance equal to the spell's level. Uses (= Proficiency Bonus) and their reset on a Short/Long Rest are tracked automatically.
- **Passive Siphon** — detects when you take damage from a spell or fail a save against one (via Midi QoL) and offers you the Reaction, once per spell-casting.
- **Resonant Reserve thresholds** — all six thresholds (2/4/6/8/10/12) automatically enable/disable as your Resonance crosses them:
  - *Mana Veil* (+2 AC) and *Surging Strike* (bonus damage on hit, equal to Proficiency Bonus) are fully automatic. **Surging Strike's "once per turn" limit isn't enforced** — track that yourself.
  - *Charged Focus* (−1 Resonance cost per cast) is applied automatically in the casting flow.
  - *Echo Ward* (temp HP at the start of your turn) is applied automatically in combat.
  - *Mana Resistance* (Advantage on saves vs. spells) applies via Midi QoL flags, covering all spell schools — non-spell magical effects aren't covered.
  - *Mana Free* (free Metamagic once per turn) is **not automated** — apply it and track the once-per-turn limit yourself.
- **Bend Magic** — detects nearby spellcasting and offers the choice (Skew the Roll / Crook the Strike) with Resonance validated against what you have. Actually adjusting the roll/targets is manual — the chat card tells you exactly what to apply.
- **Drain Magic / Improved Drain Magic** — target a creature (use Foundry's normal targeting); if they have a matching ongoing spell effect, it's removed and a slot of your choice is restored automatically. Otherwise you're offered the Resonance-cost alternative. The once-per-rest use and the Bonus Action upgrade (Improved) are both tracked.
- **Absorb Magic / Occult Shroud** — Counterspell and Nondetection are granted as always-prepared spells automatically. Absorb Magic's bonus Sorcery Points (on a target's failed save against your Counterspell) are rolled and applied automatically via Midi QoL. Occult Shroud's first free Nondetection cast each day is tracked and waives the Resonance cost automatically.
- **Redirect Magic** — detects nearby spellcasting, validates the Resonance cost and that the spell isn't Range: Self, and prompts you. Actually choosing new targets/origin is resolved manually with your GM — Foundry has no safe generic way to re-target an already-cast spell.
- **Unblooded Magic (level 18)** — the module creates its own tracking effect when you activate Innate Sorcery (core dnd5e's version doesn't leave a trackable effect on its own). While it's active: Mana Surge grants bonus Resonance (able to exceed your normal max) at the start of each of your turns, automatically clamped back down when Innate Sorcery ends; Resonant Sundering applies Disadvantage to Constitution saves against your spells/features via a Midi QoL flag, toggled live as Innate Sorcery starts and ends.

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
