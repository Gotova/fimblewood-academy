/**
 * Fimblewood Academy — Botany Club plants
 *
 * Every growable ingredient from the alchemy catalogue becomes a plant with
 * a growth time, hit points and a harvest yield. Seeds and harvested goods
 * are compendium items (packs/botany, built by tools/generate-botany-packs.mjs);
 * the stable ids below are what ties a seed item (`flags.fimblewood-academy.plantId`)
 * and a harvest item (`flags.fimblewood-academy.ingredientId`) to a plant.
 */

import { INGREDIENTS } from "../alchemy/ingredients.mjs";

export const MODULE_ID = "fimblewood-academy";
export const BOTANY_PACK = "botany";

/** Default days of (in-game) time a plant needs to reach 100 % maturity, by rarity. The GM can change it per plant (see growthDays in data.mjs). */
const GROWTH_DAYS = { common: 5, uncommon: 8, rare: 12, veryRare: 30 };

/** [min, max] items per harvest, by ingredient kind and rarity. */
function yieldFor(kind, rarity) {
  if (kind === "food") return [3, 5];
  if (kind === "flower") return [2, 4];
  if (rarity === "veryRare") return [1, 2];
  if (rarity === "rare") return [1, 3];
  return [2, 4];
}

export const MAX_HP = 10;

export const PLANTS = INGREDIENTS.filter((i) => i.growable).map((ing) => ({
  id: ing.id,
  ingredientId: ing.id,
  name: ing.name,
  kind: ing.kind,
  rarity: ing.rarity,
  defaultGrowthDays: GROWTH_DAYS[ing.rarity] ?? 5,
  maxHp: MAX_HP,
  yield: yieldFor(ing.kind, ing.rarity),
  seedGp: Math.max(ing.gp / 2, 0.01)
}));

export const PLANT_BY_ID = new Map(PLANTS.map((p) => [p.id, p]));

/** The garden sizes the GM can pick per member: [columns, rows]. */
export const GARDEN_SIZES = {
  "2x2": [2, 2],
  "3x2": [3, 2],
  "3x3": [3, 3],
  "3x4": [3, 4],
  "4x4": [4, 4]
};
export const DEFAULT_SIZE = "2x2";

export function slotCount(size) {
  const [c, r] = GARDEN_SIZES[size] ?? GARDEN_SIZES[DEFAULT_SIZE];
  return c * r;
}

/** Index entry of a plant's harvest item in the botany compendium (looked up by flag, as the ids are generated). */
export async function harvestIndexEntry(ingredientId) {
  const pack = game.packs.get(`${MODULE_ID}.${BOTANY_PACK}`);
  if (!pack) return null;
  const index = await pack.getIndex({ fields: [`flags.${MODULE_ID}`] });
  return index.find((e) => e.flags?.[MODULE_ID]?.ingredientId === ingredientId && e.flags?.[MODULE_ID]?.role === "harvest") ?? null;
}
