/**
 * Fimblewood Academy — Alchemy tools and stations
 *
 * Portable tools are items in the character's inventory (flag `alchemyTool`).
 * Stations stand in a room: the GM marks a Region with the behavior
 * "Alchemie-Station" (station-behavior.mjs) and ticks which stations it holds.
 * A character can use them while one of its tokens stands in that region.
 *
 * Which region a token is in comes from the token's own `_regions` (kept by
 * Foundry), so every client, the GM's included, sees the same tools without
 * a canvas.
 */

export const MODULE_ID = "fimblewood-academy";
export const STATION_BEHAVIOR = `${MODULE_ID}.alchemyStation`;

export const PORTABLE_TOOLS = ["reisekessel", "kelle", "moerser"];
export const STATION_TOOLS = ["braukessel", "destille", "athanor", "oelbad"];

export const TOOL_IMG = {
  reisekessel: "icons/tools/cooking/pot-camping-iron-black.webp",
  kelle: "icons/tools/cooking/soup-ladle.webp",
  moerser: "icons/tools/laboratory/mortar-empty-grey.webp",
  braukessel: "icons/tools/laboratory/cauldron-filled-gold.webp",
  destille: "icons/tools/laboratory/alembic-glass-ball-blue.webp",
  athanor: "icons/tools/cooking/oven-stone-grey.webp",
  oelbad: "icons/tools/laboratory/burner-steel-grey.webp"
};

/**
 * The scenes in which a character's tokens count: the active scene and the
 * scenes its (logged-in) players are looking at. The same on every client.
 */
function relevantScenes(actor) {
  const ids = new Set();
  if (game.scenes.active) ids.add(game.scenes.active.id);
  for (const user of game.users) {
    if (user.active && !user.isGM && user.viewedScene && actor.testUserPermission(user, "OWNER")) ids.add(user.viewedScene);
  }
  return [...ids].map((id) => game.scenes.get(id)).filter(Boolean);
}

/**
 * Everything a character can use right now.
 * @returns {{portable: Set<string>, stations: {type: string, regionKey: string, regionName: string, slots: number}[], has: (type: string) => boolean}}
 */
export function toolsFor(actor) {
  const portable = new Set();
  for (const item of actor?.items ?? []) {
    const tool = item.getFlag(MODULE_ID, "alchemyTool");
    if (PORTABLE_TOOLS.includes(tool)) portable.add(tool);
  }

  const stations = [];
  const seen = new Set();
  if (actor) {
    for (const scene of relevantScenes(actor)) {
      for (const token of scene.tokens) {
        if (token.actorId !== actor.id) continue;
        for (const regionId of token._source._regions ?? []) {
          const region = scene.regions.get(regionId);
          if (!region) continue;
          for (const behavior of region.behaviors) {
            if (behavior.type !== STATION_BEHAVIOR || behavior.disabled) continue;
            for (const type of STATION_TOOLS) {
              const regionKey = `${scene.id}.${region.id}`;
              if (!behavior.system[type] || seen.has(`${type}@${regionKey}`)) continue;
              seen.add(`${type}@${regionKey}`);
              stations.push({ type, regionKey, regionName: region.name, slots: Math.max(1, behavior.system.braukesselSlots ?? 3) });
            }
          }
        }
      }
    }
  }

  return {
    portable,
    stations,
    has: (type) => portable.has(type) || stations.some((s) => s.type === type)
  };
}
