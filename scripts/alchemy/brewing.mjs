/**
 * Fimblewood Academy — Alchemy brewing rules
 *
 * Pure functions, no Foundry: they decide what comes out of a cauldron.
 *
 * A brew is a set of ingredients (each raw or ground), cups of water, oil and
 * Mondtau. It succeeds only if it matches one recipe of the catalogue exactly:
 * same ingredients, same preparation, same amounts, same cups (powdered mana
 * crystals count as the ingredient "manakristall", ground). Anything else
 * fails, with one hint taken from the recipe it comes closest to.
 *
 * Stations decide the tier: a tier II recipe needs the Destillierapparat, a
 * tier III recipe the Athanor. Without them a matching brew fails too.
 */

import { EFFECTS, MANA_INGREDIENT, tierRecipe } from "./effects.mjs";
import { INGREDIENT_BY_ID } from "./ingredients.mjs";

const key = (ingredientId, ground) => `${ingredientId}|${ground ? "g" : "r"}`;
const LIQUIDS = ["water", "oil", "mondtau"];

/** The exact inputs of a recipe: ingredient amounts by `id|g`/`id|r`, and the cups. */
export function recipeInputs(effect, tier, variant = 0) {
  const r = tierRecipe(effect, tier, variant);
  const items = new Map();
  const add = (id, ground, qty) => items.set(key(id, ground), (items.get(key(id, ground)) ?? 0) + qty);
  for (const x of r.ingredients) add(x.ingredient, INGREDIENT_BY_ID.get(x.ingredient)?.prep === "ground", x.qty);
  if (r.mana) add(MANA_INGREDIENT, true, r.mana);
  return { effectId: effect.id, tier, variant, items, water: r.water, oil: r.oil, mondtau: r.mondtau, mana: r.mana };
}

/** Every recipe of the catalogue: all effects, tiers and variants. */
export const ALL_RECIPES = EFFECTS.flatMap((effect) => {
  const list = [];
  for (let tier = 1; tier <= effect.maxTier; tier++) {
    effect.variants.forEach((_, variant) => list.push(recipeInputs(effect, tier, variant)));
  }
  return list;
});

/** The book key of a recipe, as stored in the actor flag `knownRecipes`. */
export const recipeKey = (effectId, tier, variant = 0) => `${effectId}:${tier}:${variant}`;

export function parseRecipeKey(k) {
  const [effectId, tier, variant] = String(k).split(":");
  return { effectId, tier: Number(tier) || 1, variant: Number(variant) || 0 };
}

function inputMap(brew) {
  const items = new Map();
  for (const x of brew.items ?? []) {
    const qty = Math.max(0, Math.round(Number(x.qty) || 0));
    if (!qty || !x.ingredientId) continue;
    const k = key(x.ingredientId, !!x.ground);
    items.set(k, (items.get(k) ?? 0) + qty);
  }
  return items;
}

function sameItems(a, b) {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

const idOf = (k) => k.split("|")[0];
const isGround = (k) => k.endsWith("|g");

/** Total amount per ingredient id, preparation ignored. */
function byId(items) {
  const m = new Map();
  for (const [k, v] of items) m.set(idOf(k), (m.get(idOf(k)) ?? 0) + v);
  return m;
}

/** The recipe the brew is closest to: most shared ingredient amounts, then the lowest tier. */
function closestRecipe(items) {
  const have = byId(items);
  let best = null;
  let bestScore = -1;
  for (const recipe of ALL_RECIPES) {
    const want = byId(recipe.items);
    let score = 0;
    for (const [id, qty] of want) score += Math.min(qty, have.get(id) ?? 0);
    if (score > bestScore || (score === bestScore && recipe.tier < best.tier)) {
      best = recipe;
      bestScore = score;
    }
  }
  return best;
}

/** One hint about what is off compared to the closest recipe. */
function hintFor(items, brew, recipe) {
  // 1. An ingredient that belongs in the recipe, but prepared the wrong way.
  for (const k of items.keys()) {
    const other = key(idOf(k), !isGround(k));
    if (!recipe.items.has(k) && recipe.items.has(other)) return { hintKey: "prep" };
  }
  // 2. Powdered mana crystals.
  const manaKey = key(MANA_INGREDIENT, true);
  const mana = items.get(manaKey) ?? 0;
  const wantMana = recipe.items.get(manaKey) ?? 0;
  if (mana < wantMana) return { hintKey: mana === 0 ? "manaMissing" : "manaTooLittle" };
  if (mana > wantMana) return { hintKey: "manaTooMuch" };
  // 3. Liquids.
  for (const liquid of LIQUIDS) {
    const have = Number(brew[liquid]) || 0;
    if (have !== recipe[liquid]) return { hintKey: have > recipe[liquid] ? "liquidTooMuch" : "liquidTooLittle", hintData: { liquid } };
  }
  // 4. An ingredient missing or too much, told by its element.
  const have = byId(items);
  const want = byId(recipe.items);
  for (const [id, qty] of want) {
    if ((have.get(id) ?? 0) < qty) return { hintKey: "missing", hintData: { element: INGREDIENT_BY_ID.get(id)?.alchemy.element ?? "earth" } };
  }
  for (const [id, qty] of have) {
    if (qty > (want.get(id) ?? 0)) return { hintKey: "extra", hintData: { element: INGREDIENT_BY_ID.get(id)?.alchemy.element ?? "earth" } };
  }
  return { hintKey: "unknown" };
}

/**
 * What a brew becomes.
 * @param {{items: {ingredientId: string, ground: boolean, qty: number}[], water?: number, oil?: number, mondtau?: number}} brew
 * @param {{destille?: boolean, athanor?: boolean}} stations  stations within reach
 * @returns {{effectId: string, tier: number, variant: number} | {fail: true, hintKey: string, hintData?: object}}
 */
export function evaluateBrew(brew, stations = {}) {
  const items = inputMap(brew);
  if (!items.size) return { fail: true, hintKey: "empty" };
  const liquids = Object.fromEntries(LIQUIDS.map((l) => [l, Math.max(0, Math.round(Number(brew[l]) || 0))]));

  const match = ALL_RECIPES.find((r) => sameItems(items, r.items) && LIQUIDS.every((l) => r[l] === liquids[l]));
  if (match) {
    if ((match.tier === 2 && !stations.destille) || (match.tier === 3 && !stations.athanor)) {
      return { fail: true, hintKey: "equipment" };
    }
    return { effectId: match.effectId, tier: match.tier, variant: match.variant };
  }
  return { fail: true, ...hintFor(items, liquids, closestRecipe(items)) };
}
