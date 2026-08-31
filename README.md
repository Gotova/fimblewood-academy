# Fimblewood Academy

A homebrew Foundry VTT module for the **Fimblewood Academy** campaign — custom classes, subclasses, and other content built on top of the `dnd5e` system.

- **Foundry VTT:** v13 (build 351) — verified; compatible up to v14
- **Game system:** `dnd5e` v5.3.1+
- **Current version:** 0.14.0

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
- **Hideout Jukebox** (`scripts/jukebox.mjs`, `styles/jukebox.css`) — a collectible-music system built around Foundry's native Ambient Sound and Playlist documents
- **Dragonchess** (`scripts/dragonchess/`, `styles/dragonchess.css`) — the Dragonchess Club's chess variant, playable in Foundry with a rules engine, an optional bot opponent, and dice-driven captures streamed live to the whole table

### Magic Circle Draw Pad

An SVG-based drawing canvas for painting magic circles, available to every player and the GM via a dedicated **Fimblewood Controls** category in the scene control bar (left sidebar) — a house-and-star crest icon, separate from Token Controls.

- **Tools:** select (move/rotate), brush, eraser, line, circle, rectangle, text — each with adjustable color, brush size, opacity, and a stroke-smoothing stabilizer. Drawing is vector-based (infinite resolution at any zoom), not raster.
- **Select tool:** click a shape to select it (Shift-click to add/remove, drag a marquee to multi-select), drag to move, drag the handle above it to rotate, click the red ✕ or press Delete to remove. Hold Ctrl while moving/rotating to snap to 45°; hold Alt to snap to the grid.
- **Symmetry:** none, or 2/4/6/8/12-fold rotational symmetry around a fixed centre point — ideal for magic circles. Start with a dark background, 6- or 8-fold symmetry, and draw outward from the centre.
- **Canvas:** a 2000×2000 virtual drawing surface with independent pan (right-drag) and zoom (scroll wheel); the symmetry centre never drifts regardless of window size or viewport. A procedural paper-grain texture is baked into the parchment background.
- **Ink counter & spell-level badge:** a running total of "ink used" (stroke length) is shown in the status bar; a badge in the canvas corner estimates what spell level the circle can hold, from Cantrip up to 9th (and beyond).
- **Undo/redo:** `Ctrl+Z` / `Ctrl+Y` (or `Ctrl+Shift+Z`), up to 20 steps.
- **Export:** save as SVG, copy to clipboard, send to chat, or save to a **Gallery** — gallery entries can be organized into folders (drag-and-drop to reorder or move between folders), renamed, reloaded into the draw pad, or deleted. The gallery is stored per-user (a flag on your user document), so it follows you to any machine you log into.
- **GM tools:** push the current drawing, or any gallery entry, out to all connected players as a one-off image popout; or toggle **Go Live** to broadcast the drawing to all players in real time as you draw (updates every stroke, ~200ms throttled) — a live viewer window opens automatically on player clients and closes when you stop broadcasting.

This module and [FoundryDraw](https://github.com/Gotova/FoundryDraw) should not be run together — disable FoundryDraw once you've switched to this built-in version, otherwise you'll get duplicate buttons and two separate galleries.

### Hideout Jukebox

A party can **collect** music tracks the GM has set up as Ambient Sound themes, then play any collected track together — in sync, for everyone at the table — on a physical record-player prop placed somewhere in the world (e.g. a hideout).

**Setting it up (GM):**

- **Tag an existing Ambient Sound** with a track: open its configuration, pick (or create) a track in the new "Jukebox Track" field at the bottom. The first time you tag a *new* track, a small dialog asks for a name and the audio file (cover art optional) — no separate setup screen needed.
- **Grant a track via an item**: open any item's sheet, tick "Grants a Jukebox track," and pick/create a track the same way. Dropping that item onto a player's character immediately unlocks the track for the whole party — the item stays in their inventory as a keepsake, it's never consumed.
- **Place a collectible on the map**: drop any token, open its Token Configuration, and choose "Map pickup — grants track" (with a track picker) or "This is the Jukebox prop" (for the interactive record player itself). Either way, the token's ownership is automatically opened up so any player can click it — you never need to configure permissions by hand.

**Playing it (players):**

- Walking a character within earshot of a tagged Ambient Sound, receiving a tagged item, or clicking a map pickup token all unlock that track for the **whole party** (not just whoever triggered it) — collection is shared. Every collection announces itself to the whole table with a short reward sound and a "Record *\<name>* collected!" banner (the reward sound itself is a world setting the GM sets once, under Foundry's Configure Settings).
- Clicking the record-player prop token opens the Jukebox window, listing every track the party has collected so far. Click a track's cover art to blow it up full size for the table (the GM can share that popout out to everyone). Hit Play on any of them — it plays looped, for every connected player, using Foundry's own synced Playlist system (no lag or "your client is playing something different" issues, and it's still correct for anyone who reconnects mid-song).
- The music is **local to the hideout**: you only hear it while you're looking at the scene the record-player prop stands on. Leave the scene and it fades out for you; come back and you rejoin the song already in progress, while anyone still in the hideout hears it uninterrupted throughout. Playback itself stays shared and in sync — it's only *your* client that goes quiet, so one player wandering off doesn't stop the music for the rest of the table.
- The GM can rename or delete tracks from the same window; deleting a track just removes it from the Jukebox going forward — nobody who already collected it loses anything.

**Managing it (GM):**

Open **Music Tracks** from the Fimblewood Controls category in the scene controls (the same category as the Draw Pad). This GM-only window lists *every* record you've registered — collected or not — and is where you prepare and reset the whole system between test runs:

- **Collecting enabled / disabled** — the switch at the top. While it's off, players can't collect anything at all: ambient sounds, map pickups and item grants all stop handing out records, and a clicked pickup token stays put on the map instead of being consumed. Turn it on when the party is ready. (It's also available as a normal world setting.)
- **Collected / Uncollected** — the status pill on each row toggles that record's state for the whole party, so you can hand out a record directly or take one back after testing.
- **Collect All / Reset All** — the same across every record at once.
- **Add / edit / delete** — create records here without going through a sound, item or token first, and change a record's name, audio file or cover art at any time.
- **Play / Stop** — audition any record, collected or not.

For players there's no sidebar shortcut to the Jukebox by design — the only way in is the physical prop, to keep it grounded in the fiction. The Music Tracks window is the GM's side of it, and is never shown to players.

### Dragonchess

The Fimblewood Academy Dragonchess Club's house variant: full chess rules, except a capture is never automatic. Moving onto an occupied enemy square is a **Schlagzug** — the attacker rolls `1d20 + attacker value` against `DC 10 + defender value`; on a success the defender is removed and the attacker holds the square, **entrenched** (the next attack on that square rolls with Disadvantage); on a failure the *attacker* dies and the defender becomes entrenched instead. The König can't attack at all, and any attack against it always succeeds — so checkmate can still be "rolled away," which is the whole point.

**Starting a match against the GM's NPC:** target one PC token and one NPC token, then click **Dragonchess** in the Fimblewood Controls scene-control category (GM only). A dialog lets you pick who plays the NPC — the built-in bot (four difficulties: Knappe, Student, Magister, Drache) or yourself — before sending the PC's player an invitation.

**Starting a match against another player:** any player can control their own token, target another player's token, and click **Challenge to Dragonchess** — no GM click required (a GM just has to be logged in somewhere, since only the GM's client can write the shared match state).

Either way, accepting triggers Schere/Stein/Papier for who picks a colour first (Blau moves first), and the match begins. Every other connected player automatically gets a read-only board the moment play starts — no separate step needed — and a **Watch Dragonchess** button lets anyone reopen it (or a latecomer open it for the first time).

**The bot** isn't a chess engine with dice bolted on: its search treats every capture as a chance node, weighing the success and failure branches by the real Dragonchess odds, so it correctly avoids bad-odds trades and values attacking an undefended piece over an entrenched one.

**Every move plays out as a short, legible beat** so the table can actually follow what's happening: an arrow forms from the source square to the destination, the piece physically slides there, and — only if there's an enemy piece on that square — a short pause and then the die rolls in chat (animated by Dice So Nice if installed) before the outcome resolves. The board is labelled a–h / 1–8 like a normal chessboard. The roll delay and the bot's default difficulty are world settings.

**The König attacks and is attacked exactly like a normal chess king** — one step in any direction, including capturing — with one deviation from plain chess: any capture where either side is the König, attacker or defender, always succeeds, no roll. The two Kings still can't stand adjacent, exactly as in normal chess.

Dragonchess's text is deliberately German throughout, regardless of the world's configured Foundry language — the source rulebook, the club fiction, and the world piece names (Drache, Bastion, Magus, Greif, Knappe, König) are German, so following an English world language for everything else around them would just produce a mixed-language mess.

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
