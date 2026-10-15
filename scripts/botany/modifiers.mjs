/**
 * Fimblewood Academy — Botany Club bed modifiers
 *
 * A bed can carry a growth factor (plants ripen faster or slower) and a
 * yield factor (the harvest is bigger or smaller). Both belong to the bed,
 * not to the plant, and last until the next plant on that bed is harvested.
 * A new growth factor replaces the old one instead of stacking.
 *
 * Where they come from:
 *   - potions with a garden effect (see GARDEN_EFFECTS),
 *   - fertilizer items (a `fertilizer` flag holding the growth factor),
 *   - the GM, freely, for both factors.
 *
 * Stored per garden as `mods: { [slotIndex]: { growth?, yield? } }`.
 */

import { EFFECT_BY_ID } from "../alchemy/effects.mjs";
import { MODULE_ID } from "./plants.mjs";

export const FACTOR_MIN = 0.1;
export const FACTOR_MAX = 10;

/** The potion effects that do something to a plant. Everything else stays unusable in the garden. */
export const GARDEN_EFFECTS = {
  "wildes-wachstum": { kind: "growth", factor: 1.5 },
  verlangsamung: { kind: "growth", factor: 0.5 },
  // Harmful: the plant's HP drop to 0.
  gift: { kind: "harm" },
  saeure: { kind: "harm" },
  explosion: { kind: "harm" },
  feuer: { kind: "harm" },
  frost: { kind: "harm" },
  nekromantie: { kind: "harm" },
  fluch: { kind: "harm" }
};

/** Names a potion item may carry when it has no explicit flag (whole words, case-insensitive). */
const NAME_ALIASES = {
  "wildes-wachstum": ["wildes wachstum", "wilden wachstums", "wilder wachstum", "wild growth"],
  verlangsamung: ["verlangsamung", "verlangsamen", "slowness"],
  gift: ["gift"],
  saeure: ["säure", "saeure"],
  explosion: ["explosion"],
  feuer: ["feuer"],
  frost: ["frost"],
  nekromantie: ["nekromantie", "necromancy"],
  fluch: ["fluch"]
};

const wholeWord = (term) => new RegExp(`(?<![\\p{L}])${term}(?![\\p{L}])`, "iu");

export function effectName(effectId) {
  return EFFECT_BY_ID.get(effectId)?.name ?? effectId;
}

/**
 * What a potion item does in the garden, or null if the item is no potion.
 * `effect` is the garden effect (`{kind, factor?}`) or null when the potion
 * has no use on plants. The item flag `potionEffect` wins over the name;
 * the flag value "none" switches the garden use off.
 */
export function potionInfo(item) {
  if (item?.type !== "consumable" || item.system.type?.value !== "potion") return null;
  const flag = item.getFlag(MODULE_ID, "potionEffect");
  let effectId = null;
  if (flag === "none") effectId = null;
  else if (flag) effectId = flag;
  else {
    const name = item.name ?? "";
    effectId = Object.keys(GARDEN_EFFECTS).find((id) => NAME_ALIASES[id].some((term) => wholeWord(term).test(name))) ?? null;
  }
  return { effectId, effect: GARDEN_EFFECTS[effectId] ?? null };
}

export function potionsOf(actor) {
  return [...(actor?.items ?? [])].map((item) => ({ item, info: potionInfo(item) })).filter((x) => x.info);
}

/** The growth factor of a fertilizer item, or null. */
export function fertilizerFactor(item) {
  if (item?.type !== "loot") return null;
  const factor = Number(item.getFlag(MODULE_ID, "fertilizer"));
  return Number.isFinite(factor) && factor >= FACTOR_MIN && factor <= FACTOR_MAX ? factor : null;
}

export function fertilizersOf(actor) {
  return [...(actor?.items ?? [])].map((item) => ({ item, factor: fertilizerFactor(item) })).filter((x) => x.factor);
}

/** `value` as a clean factor within the allowed range, or null if it is not one. */
export function cleanFactor(value) {
  const n = Math.round(Number(value) * 100) / 100;
  return Number.isFinite(n) && n >= FACTOR_MIN && n <= FACTOR_MAX ? n : null;
}

/** Sets or clears one factor of a bed (mutates `mods`); a factor of exactly 1 is the same as none. */
export function setFactor(mods, key, which, factor) {
  const mod = { ...(mods[key] ?? {}) };
  if (factor == null || factor === 1) delete mod[which];
  else mod[which] = factor;
  if (Object.keys(mod).length) mods[key] = mod;
  else delete mods[key];
}

const fmt = (n) => String(Math.round(n * 100) / 100);

/** The little label above a bed: growth and/or yield factor. Built from numbers only, so it is safe HTML. */
export function modBadge(mod) {
  if (!mod) return "";
  const parts = [];
  if (mod.growth) {
    const up = mod.growth > 1;
    parts.push(`<span class="${up ? "is-up" : "is-down"}"><i class="fas fa-angles-${up ? "up" : "down"}"></i> ×${fmt(mod.growth)}</span>`);
  }
  if (mod.yield) {
    const up = mod.yield > 1;
    parts.push(`<span class="${up ? "is-up" : "is-down"}"><i class="fas fa-wheat-awn"></i> ×${fmt(mod.yield)}</span>`);
  }
  return parts.length ? `<span class="fw-garden-mod">${parts.join("")}</span>` : "";
}
