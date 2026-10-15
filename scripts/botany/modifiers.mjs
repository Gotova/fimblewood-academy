/**
 * Fimblewood Academy — Botany Club bed modifiers
 *
 * A bed can carry growth factors (plants ripen faster or slower) and a
 * yield factor (the harvest is bigger or smaller). They belong to the bed,
 * not to the plant, and last until the next plant on that bed is harvested.
 *
 * Growth has three sources that add up: one potion, one fertilizer and the
 * GM's own factor. Each counts by how far it is from 1, so a ×1.5 potion and
 * a ×1.2 fertilizer give ×1.7. A new potion replaces the bed's potion, a new
 * fertilizer its fertilizer.
 *
 * Where they come from:
 *   - potions with a garden effect (see GARDEN_EFFECTS),
 *   - fertilizer items (a `fertilizer` flag holding the growth factor),
 *   - the GM, freely, for both factors.
 *
 * Stored per garden as `mods: { [slotIndex]: { potion?, fertilizer?, growth?, yield? } }`
 * (`growth` is the GM's factor).
 */

import { EFFECT_BY_ID } from "../alchemy/effects.mjs";
import { MODULE_ID } from "./plants.mjs";

export const FACTOR_MIN = 0.1;
export const FACTOR_MAX = 10;

/** The potion effects that do something to a plant. Everything else stays unusable in the garden. */
export const GARDEN_EFFECTS = {
  // `factors` is per potion tier (I, II, III).
  "wildes-wachstum": { kind: "growth", factors: [1.5, 1.75, 2] },
  verlangsamung: { kind: "growth", factors: [0.5, 0.5, 0.5] },
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
 * `effect` is the garden effect (`{kind, factors?}`) or null when the potion
 * has no use on plants; `tier` (1-3, from the flag `potionTier`, default 1)
 * picks the `factor` of a growth potion. The item flag `potionEffect` wins
 * over the name; the flag value "none" switches the garden use off.
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
  const effect = GARDEN_EFFECTS[effectId] ?? null;
  const tier = Math.max(1, Math.min(3, Math.round(Number(item.getFlag(MODULE_ID, "potionTier"))) || 1));
  const factor = effect?.factors ? effect.factors[tier - 1] : null;
  return { effectId, effect, tier, factor };
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

const GROWTH_SOURCES = ["potion", "fertilizer", "growth"];

/** The growth factor of a bed: 1 plus how far each source is from 1 (never below 0). */
export function growthFactor(mod) {
  if (!mod) return 1;
  let factor = 1;
  for (const source of GROWTH_SOURCES) {
    if (Number.isFinite(mod[source])) factor += mod[source] - 1;
  }
  return Math.max(0, Math.round(factor * 100) / 100);
}

/** A plain-text summary of a bed's modifiers for a tooltip, e.g. "Trank ×1.5 · Dünger ×1.2". */
export function modTitle(mod) {
  if (!mod) return "";
  const label = { potion: "Potion", fertilizer: "Fertilizer", growth: "Gm", yield: "Yield" };
  return Object.keys(label)
    .filter((k) => Number.isFinite(mod[k]))
    .map((k) => `${game.i18n.localize(`FIMBLEWOOD.Botany.Mod.${label[k]}`)} ×${fmt(mod[k])}`)
    .join(" · ");
}

/** The little label above a bed: growth and/or yield factor. Built from numbers only, so it is safe HTML. */
export function modBadge(mod) {
  if (!mod) return "";
  const parts = [];
  const growth = growthFactor(mod);
  if (growth !== 1) {
    const up = growth > 1;
    parts.push(`<span class="${up ? "is-up" : "is-down"}"><i class="fas fa-angles-${up ? "up" : "down"}"></i> ×${fmt(growth)}</span>`);
  }
  if (mod.yield) {
    const up = mod.yield > 1;
    parts.push(`<span class="${up ? "is-up" : "is-down"}"><i class="fas fa-wheat-awn"></i> ×${fmt(mod.yield)}</span>`);
  }
  return parts.length ? `<span class="fw-garden-mod">${parts.join("")}</span>` : "";
}
