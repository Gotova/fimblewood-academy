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

/** The tokens this behavior has placed. */
function spawnedTokens(behavior) {
  return behavior.scene.tokens.filter(t => t.getFlag(MODULE_ID, SPAWN_FLAG) === behavior.uuid);
}

/**
 * Everything needed to place NPCs in the behavior's region, or null (with a
 * warning) if nothing can be placed.
 */
function spawnContext(behavior) {
  const { scene, region, system } = behavior;
  const grid = scene.grid;
  if (grid.isGridless) {
    ui.notifications.warn(i18n("Warn.Gridless", { region: region.name }));
    return null;
  }
  const actors = collectActors(system.folder, system.includeSubfolders);
  if (!actors.length) {
    ui.notifications.warn(i18n("Warn.NoActors", { region: region.name }));
    return null;
  }
  const occupied = new Set();
  const placed = new Set();
  const own = new Set(spawnedTokens(behavior));
  for (const token of scene.tokens) {
    for (const offset of token.getOccupiedGridSpaceOffsets()) {
      occupied.add(offsetKey(offset));
      if (own.has(token)) placed.add(offsetKey(offset));
    }
  }
  return { behavior, scene, grid, system, actors, spaces: regionSpaces(region, grid), occupied, placed, tokens: [] };
}

const hasPlacedNeighbor = (ctx, offset) => ctx.grid.getAdjacentOffsets(offset).some(o => ctx.placed.has(offsetKey(o)));

/**
 * Queue a random actor's token at the given space. A larger token is only
 * placed if every space it covers is free and inside the region.
 * @returns {Promise<boolean>} Whether a token was queued.
 */
async function queueToken(ctx, offset) {
  const actor = ctx.actors[Math.floor(Math.random() * ctx.actors.length)];
  const { x, y } = ctx.grid.getTopLeftPoint(offset);
  const tokenDoc = await actor.getTokenDocument({ x, y, hidden: ctx.system.hidden }, { parent: ctx.scene });
  const covered = tokenDoc.getOccupiedGridSpaceOffsets().map(offsetKey);
  if (covered.some(k => ctx.occupied.has(k) || !ctx.spaces.has(k))) return false;
  for (const k of covered) {
    ctx.occupied.add(k);
    ctx.placed.add(k);
  }
  const data = tokenDoc.toObject();
  foundry.utils.setProperty(data, `flags.${MODULE_ID}.${SPAWN_FLAG}`, ctx.behavior.uuid);
  ctx.tokens.push(data);
  return true;
}

async function flush(ctx) {
  if (ctx.tokens.length) await ctx.scene.createEmbeddedDocuments("Token", ctx.tokens);
  return ctx.tokens.length;
}

/**
 * Remove every token this behavior placed.
 * @param {RegionBehavior} behavior
 */
export async function clearRegion(behavior) {
  if (!game.user.isGM || behavior?.type !== BEHAVIOR_TYPE) return;
  const ids = spawnedTokens(behavior).map(t => t.id);
  if (ids.length) await behavior.scene.deleteEmbeddedDocuments("Token", ids);
}

/**
 * Remove the tokens this behavior placed before and fill its region anew.
 * @param {RegionBehavior} behavior
 */
export async function rerollRegion(behavior) {
  if (!game.user.isGM || behavior?.type !== BEHAVIOR_TYPE) return;
  await clearRegion(behavior);
  const ctx = spawnContext(behavior);
  if (!ctx) return;
  const limit = ctx.system.maxNpcs || Infinity;
  for (const offset of shuffle([...ctx.spaces.values()])) {
    if (ctx.tokens.length >= limit) break;
    if (ctx.occupied.has(offsetKey(offset))) continue;
    const chance = hasPlacedNeighbor(ctx, offset) ? ctx.system.neighborChance : ctx.system.baseChance;
    if (Math.random() * 100 < chance) await queueToken(ctx, offset);
  }
  await flush(ctx);
}

/**
 * Add NPCs to free spaces of the region. Spaces next to an existing NPC are
 * favored by the same ratio as neighborChance to baseChance, so additions
 * tend to join groups. Ignores maxNpcs, since the GM asked for them.
 * @param {RegionBehavior} behavior
 * @param {number} [count=1]
 */
export async function addNpcs(behavior, count = 1) {
  if (!game.user.isGM || behavior?.type !== BEHAVIOR_TYPE) return;
  const ctx = spawnContext(behavior);
  if (!ctx) return;
  const candidates = [...ctx.spaces.values()];
  const base = Math.max(ctx.system.baseChance, 0.01);
  const neighbor = Math.max(ctx.system.neighborChance, 0.01);
  while (ctx.tokens.length < count) {
    const free = candidates.filter(o => !ctx.occupied.has(offsetKey(o)));
    if (!free.length) break;
    const weights = free.map(o => (hasPlacedNeighbor(ctx, o) ? neighbor : base));
    let roll = Math.random() * weights.reduce((a, b) => a + b, 0);
    const index = weights.findIndex(w => (roll -= w) < 0);
    const offset = free[index === -1 ? free.length - 1 : index];
    // A space too small for the chosen actor is dropped from the candidates.
    if (!(await queueToken(ctx, offset))) candidates.splice(candidates.indexOf(offset), 1);
  }
  if (!(await flush(ctx))) ui.notifications.info(i18n("Warn.NoSpace", { region: behavior.region.name }));
}

/**
 * Remove random NPCs this behavior placed.
 * @param {RegionBehavior} behavior
 * @param {number} [count=1]
 */
export async function removeNpcs(behavior, count = 1) {
  if (!game.user.isGM || behavior?.type !== BEHAVIOR_TYPE) return;
  const ids = shuffle(spawnedTokens(behavior).map(t => t.id)).slice(0, count);
  if (ids.length) await behavior.scene.deleteEmbeddedDocuments("Token", ids);
}

/**
 * Reroll every enabled Random NPCs behavior in the scene.
 * @param {Scene} [scene]
 */
export async function rerollScene(scene = canvas.scene) {
  if (!game.user.isGM || !scene) return;
  for (const region of scene.regions) {
    for (const behavior of region.behaviors) {
      if (behavior.type === BEHAVIOR_TYPE && !behavior.disabled) await rerollRegion(behavior);
    }
  }
}

/* -------------------------------------------- */
/*  Region controls overlay                      */
/* -------------------------------------------- */

const HUD_ID = "fw-npc-spawner-hud";
/** Clicks with Shift held add or remove this many NPCs at once. */
const SHIFT_COUNT = 5;

const HUD_ACTIONS = {
  add: { icon: "fa-solid fa-plus", run: (b, shift) => addNpcs(b, shift ? SHIFT_COUNT : 1) },
  remove: { icon: "fa-solid fa-minus", run: (b, shift) => removeNpcs(b, shift ? SHIFT_COUNT : 1) },
  reroll: { icon: "fa-solid fa-dice", run: b => rerollRegion(b) },
  clear: { icon: "fa-solid fa-trash", run: b => clearRegion(b) }
};

/** Keep the buttons the same size on screen at any zoom level. */
function updateHudScale() {
  const el = document.getElementById(HUD_ID);
  if (el && canvas.ready) el.style.setProperty("--fw-npc-hud-scale", String(1 / canvas.stage.scale.x));
}

/**
 * Draw a small button bar above every region with a Random NPCs behavior while
 * the Regions layer is active. It lives in core's #hud element, which core
 * keeps aligned with the canvas, so the bars are placed in scene coordinates.
 */
function renderSpawnerHud() {
  document.getElementById(HUD_ID)?.remove();
  if (!game.user.isGM || !canvas.ready || !canvas.regions?.active) return;
  const hud = document.getElementById("hud");
  if (!hud) return;

  const root = document.createElement("div");
  root.id = HUD_ID;
  for (const region of canvas.scene.regions) {
    const behaviors = region.behaviors.filter(b => b.type === BEHAVIOR_TYPE);
    if (!behaviors.length || !region.bounds.width) continue;
    const column = document.createElement("div");
    column.className = "fw-npc-hud-column";
    column.style.left = `${region.bounds.x + (region.bounds.width / 2)}px`;
    column.style.top = `${region.bounds.y}px`;
    for (const behavior of behaviors) {
      const bar = document.createElement("div");
      bar.className = "fw-npc-hud-bar";
      bar.dataset.uuid = behavior.uuid;
      if (behavior.disabled) bar.classList.add("disabled");
      const count = spawnedTokens(behavior).length;
      bar.innerHTML = `<span class="fw-npc-hud-count" data-tooltip="${i18n("Hud.count")}">`
        + `<i class="fa-solid fa-people-group"></i> ${count}</span>`
        + Object.entries(HUD_ACTIONS).map(([action, { icon }]) =>
          `<button type="button" data-action="${action}" data-tooltip="${i18n(`Hud.${action}`)}"><i class="${icon}"></i></button>`
        ).join("");
      column.appendChild(bar);
    }
    root.appendChild(column);
  }

  root.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const bar = button.closest(".fw-npc-hud-bar");
    if (bar.classList.contains("busy")) return;
    const behavior = foundry.utils.fromUuidSync(bar.dataset.uuid);
    if (!behavior) return;
    bar.classList.add("busy");
    try {
      await HUD_ACTIONS[button.dataset.action].run(behavior, event.shiftKey);
    } catch (err) {
      console.error(`${MODULE_ID} | NPC spawner failed`, err);
    } finally {
      bar.classList.remove("busy");
    }
  });
  hud.appendChild(root);
  updateHudScale();
}

const refreshSpawnerHud = foundry.utils.debounce(renderSpawnerHud, 50);

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

  // Redraw the region buttons whenever what they show could have changed.
  for (const hook of ["canvasReady", "activateRegionLayer", "deactivateRegionLayer",
    "createRegion", "updateRegion", "deleteRegion",
    "createRegionBehavior", "updateRegionBehavior", "deleteRegionBehavior",
    "createToken", "deleteToken"]) {
    Hooks.on(hook, () => refreshSpawnerHud());
  }
  Hooks.on("canvasTearDown", () => document.getElementById(HUD_ID)?.remove());
  Hooks.on("canvasPan", updateHudScale);
}
