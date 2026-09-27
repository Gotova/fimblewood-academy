/**
 * Fimblewood Academy — Random NPC Spawner
 *
 * A Region Behavior type ("Random NPCs") that fills its region with tokens of
 * random actors from a chosen Actor folder. Every time the scene is activated,
 * the tokens it placed last time are removed and the region is rolled anew.
 *
 * Each free grid space inside the region gets a base chance of receiving an
 * NPC, and a higher chance when an adjacent space already holds one, so that
 * small groups form. The spaces are rolled in random order; row by row, groups
 * would only ever grow towards the bottom right.
 */

const MODULE_ID = "fimblewood-academy";
const BEHAVIOR_TYPE = `${MODULE_ID}.npcSpawner`;
const SPAWN_FLAG = "npcSpawner";

const i18n = (key, data) => data
  ? game.i18n.format(`FIMBLEWOOD.NpcSpawner.${key}`, data)
  : game.i18n.localize(`FIMBLEWOOD.NpcSpawner.${key}`);

/** Actor folders as select choices, indented by depth. */
function actorFolderChoices() {
  const choices = {};
  const actorFolders = game.folders?.filter(f => f.type === "Actor") ?? [];
  const walk = (parent, depth) => {
    const folders = actorFolders.filter(f => (f.folder ?? null) === parent);
    for (const folder of folders.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))) {
      choices[folder.id] = `${" ".repeat(depth)}${folder.name}`;
      walk(folder, depth + 1);
    }
  };
  walk(null, 0);
  return choices;
}

class NpcSpawnerBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
  static LOCALIZATION_PREFIXES = ["FIMBLEWOOD.NpcSpawner"];

  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      folder: new fields.StringField({ required: true, blank: true, choices: actorFolderChoices }),
      includeSubfolders: new fields.BooleanField({ initial: true }),
      baseChance: new fields.NumberField({ required: true, nullable: false, min: 0, max: 100, step: 0.5, initial: 5 }),
      neighborChance: new fields.NumberField({ required: true, nullable: false, min: 0, max: 100, step: 0.5, initial: 15 }),
      maxNpcs: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
      hidden: new fields.BooleanField({ initial: false })
    };
  }
}

/* -------------------------------------------- */

function collectActors(folderId, includeSubfolders) {
  const folder = game.folders.get(folderId);
  if (!folder) return [];
  const folders = includeSubfolders ? [folder, ...folder.getSubfolders(true)] : [folder];
  return folders.flatMap(f => f.contents);
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

const offsetKey = ({ i, j }) => `${i},${j}`;

/** The grid spaces whose centers lie inside the region. */
function regionSpaces(region, grid) {
  const spaces = new Map();
  const [i0, j0, i1, j1] = grid.getOffsetRange(region.bounds);
  for (let i = i0; i < i1; i++) {
    for (let j = j0; j < j1; j++) {
      const offset = { i, j };
      if (region.polygonTree.testPoint(grid.getCenterPoint(offset))) spaces.set(offsetKey(offset), offset);
    }
  }
  return spaces;
}

/**
 * Remove the tokens this behavior placed before and fill its region anew.
 * @param {RegionBehavior} behavior
 */
export async function rerollRegion(behavior) {
  if (!game.user.isGM || behavior?.type !== BEHAVIOR_TYPE) return;
  const scene = behavior.scene;
  const region = behavior.region;
  const system = behavior.system;
  const grid = scene.grid;

  const stale = scene.tokens.filter(t => t.getFlag(MODULE_ID, SPAWN_FLAG) === behavior.uuid).map(t => t.id);
  if (stale.length) await scene.deleteEmbeddedDocuments("Token", stale);
  if (behavior.disabled) return;

  if (grid.isGridless) {
    ui.notifications.warn(i18n("Warn.Gridless", { region: region.name }));
    return;
  }
  const actors = collectActors(system.folder, system.includeSubfolders);
  if (!actors.length) {
    ui.notifications.warn(i18n("Warn.NoActors", { region: region.name }));
    return;
  }

  const spaces = regionSpaces(region, grid);
  const occupied = new Set();
  for (const token of scene.tokens) {
    for (const offset of token.getOccupiedGridSpaceOffsets()) occupied.add(offsetKey(offset));
  }

  const placed = new Set();
  const tokens = [];
  const limit = system.maxNpcs || Infinity;
  for (const offset of shuffle([...spaces.values()])) {
    if (tokens.length >= limit) break;
    const key = offsetKey(offset);
    if (occupied.has(key)) continue;
    const hasNeighbor = grid.getAdjacentOffsets(offset).some(o => placed.has(offsetKey(o)));
    const chance = hasNeighbor ? system.neighborChance : system.baseChance;
    if (Math.random() * 100 >= chance) continue;

    const actor = actors[Math.floor(Math.random() * actors.length)];
    const { x, y } = grid.getTopLeftPoint(offset);
    const tokenDoc = await actor.getTokenDocument({ x, y, hidden: system.hidden }, { parent: scene });
    // A larger token is only placed if every space it covers is free and inside the region.
    const covered = tokenDoc.getOccupiedGridSpaceOffsets().map(offsetKey);
    if (covered.some(k => occupied.has(k) || !spaces.has(k))) continue;
    for (const k of covered) {
      occupied.add(k);
      placed.add(k);
    }
    const data = tokenDoc.toObject();
    foundry.utils.setProperty(data, `flags.${MODULE_ID}.${SPAWN_FLAG}`, behavior.uuid);
    tokens.push(data);
  }
  if (tokens.length) await scene.createEmbeddedDocuments("Token", tokens);
}

/**
 * Reroll every Random NPCs behavior in the scene.
 * @param {Scene} [scene]
 */
export async function rerollScene(scene = canvas.scene) {
  if (!game.user.isGM || !scene) return;
  for (const region of scene.regions) {
    for (const behavior of region.behaviors) {
      if (behavior.type === BEHAVIOR_TYPE) await rerollRegion(behavior);
    }
  }
}

/* -------------------------------------------- */

export function registerNpcSpawner() {
  CONFIG.RegionBehavior.dataModels[BEHAVIOR_TYPE] = NpcSpawnerBehaviorType;
  CONFIG.RegionBehavior.typeLabels[BEHAVIOR_TYPE] = "FIMBLEWOOD.NpcSpawner.Label";
  CONFIG.RegionBehavior.typeIcons[BEHAVIOR_TYPE] = "fa-solid fa-people-group";

  // Only the client that activated the scene rolls, so it happens exactly once.
  Hooks.on("updateScene", (scene, changes, options, userId) => {
    if (changes.active !== true || userId !== game.user.id) return;
    rerollScene(scene).catch(err => console.error(`${MODULE_ID} | NPC spawner failed`, err));
  });
}
