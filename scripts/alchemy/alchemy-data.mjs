/**
 * Fimblewood Academy — Alchemy operations
 *
 * Everything that changes an inventory goes through the active GM's client,
 * the same way the garden does it (scripts/botany/data.mjs): a player sends a
 * request, the GM re-checks tools and items and applies it, and sends the
 * result back so the alchemy window can show it.
 *
 *   grind    {actorId, itemId, qty}       raw ingredient -> ground, needs a Mörser
 *   brew     {actorId, kettle, slots}     kettle "portable" (Reisekessel, 1 slot) or
 *                                         "region:<sceneId>.<regionId>" (Braukessel)
 *   gmLearn  {actorId, key, known}        GM: tick a recipe in a character's book
 *
 * Recipe items (compendium "Alchemie: Rezepte", flag `recipe`) teach their
 * recipe as soon as they land in a character's inventory. The item stays, so
 * it can be passed on and teach the next character too.
 *
 * Brewing is instant: ingredients are used up and the potion (or a failed
 * one) lands in the inventory right away. Successful recipes go into the
 * character's recipe book (actor flag `knownRecipes`).
 */

import { EFFECT_BY_ID } from "./effects.mjs";
import { evaluateBrew, parseRecipeKey, recipeKey } from "./brewing.mjs";
import { buildPotion } from "./potions.mjs";
import { potionPrice } from "./potion-prices.mjs";
import { toolsFor, MODULE_ID } from "./tools.mjs";
import { addToStack, consumeQty, packItemData } from "../shared/items.mjs";

const CHANNEL = `module.${MODULE_ID}`;
export const HINTS_SETTING = "alchemyHints";
export const KNOWN_FLAG = "knownRecipes";

const i18n = (key, data) => (data ? game.i18n.format(`FIMBLEWOOD.Alchemy.${key}`, data) : game.i18n.localize(`FIMBLEWOOD.Alchemy.${key}`));
const fail = (message) => ({ ok: false, message });
const count = (n) => Math.max(0, Math.round(Number(n) || 0));

export function knownRecipes(actor) {
  return new Set(actor?.getFlag(MODULE_ID, KNOWN_FLAG) ?? []);
}

/** The ingredient items of a character (raw and ground). */
export function ingredientItems(actor) {
  return (actor?.items ?? [])
    .filter((i) => i.getFlag(MODULE_ID, "ingredientId") && ["harvest", "ground"].includes(i.getFlag(MODULE_ID, "role")))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The items holding a liquid ("oil" or "mondtau"). */
export function liquidItems(actor, liquid) {
  return (actor?.items ?? []).filter((i) => i.getFlag(MODULE_ID, "liquid") === liquid);
}

export function liquidTotal(actor, liquid) {
  return liquidItems(actor, liquid).reduce((sum, i) => sum + (i.system.quantity ?? 1), 0);
}

async function consumeLiquid(actor, liquid, cups) {
  let left = cups;
  for (const item of liquidItems(actor, liquid)) {
    if (left <= 0) break;
    const take = Math.min(left, item.system.quantity ?? 1);
    await consumeQty(item, take);
    left -= take;
  }
}

/* -------------------------------------------- */
/*  Operations (active GM only)                  */
/* -------------------------------------------- */

async function grind(actor, tools, op) {
  if (!tools.portable.has("moerser")) return fail(i18n("Notice.NeedMortar"));
  const item = actor.items.get(op.itemId);
  const ingredientId = item?.getFlag(MODULE_ID, "ingredientId");
  if (!ingredientId || item.getFlag(MODULE_ID, "role") !== "harvest") return fail(i18n("Notice.NotGrindable"));
  const qty = Math.min(count(op.qty) || 1, item.system.quantity ?? 1);
  const data = await packItemData("botany", (f) => f.ingredientId === ingredientId && f.role === "ground");
  if (!data) return fail(i18n("Notice.PackMissing"));
  await consumeQty(item, qty);
  await addToStack(actor, (i) => i.getFlag(MODULE_ID, "ingredientId") === ingredientId && i.getFlag(MODULE_ID, "role") === "ground", data, qty);
  return { ok: true, message: i18n("Notice.Ground", { qty, name: data.name }) };
}

async function brew(actor, tools, op) {
  const slots = Array.isArray(op.slots) ? op.slots : [];
  if (!slots.length) return fail(i18n("Notice.Empty"));

  let capacity = 0;
  if (op.kettle === "portable") {
    if (tools.portable.has("reisekessel")) capacity = 1;
  } else {
    const station = tools.stations.find((s) => s.type === "braukessel" && `region:${s.regionKey}` === op.kettle);
    if (station) capacity = station.slots;
  }
  if (!capacity) return fail(i18n("Notice.NoKettle"));
  if (slots.length > capacity) return fail(i18n("Notice.TooManySlots", { slots: capacity }));

  // Collect what the brew needs, slot by slot, and check it all against the inventory and tools.
  const usage = new Map();
  const liquids = { oil: 0, mondtau: 0 };
  const brews = [];
  for (const slot of slots) {
    const items = [];
    for (const x of slot.ingredients ?? []) {
      const qty = count(x.qty);
      const item = actor.items.get(x.itemId);
      if (!qty) continue;
      const ingredientId = item?.getFlag(MODULE_ID, "ingredientId");
      const role = item?.getFlag(MODULE_ID, "role");
      if (!ingredientId || !["harvest", "ground"].includes(role)) return fail(i18n("Notice.NotIngredient"));
      usage.set(item.id, (usage.get(item.id) ?? 0) + qty);
      items.push({ ingredientId, ground: role === "ground", qty });
    }
    const water = count(slot.water);
    const oil = count(slot.oil);
    const mondtau = count(slot.mondtau);
    if ((water || oil || mondtau) && !tools.portable.has("kelle")) return fail(i18n("Notice.NeedTool", { tool: i18n("Tool.kelle") }));
    if (oil && !tools.has("oelbad")) return fail(i18n("Notice.NeedTool", { tool: i18n("Tool.oelbad") }));
    if (mondtau && !tools.has("athanor")) return fail(i18n("Notice.NeedTool", { tool: i18n("Tool.athanor") }));
    liquids.oil += oil;
    liquids.mondtau += mondtau;
    if (items.length || water || oil || mondtau) brews.push({ items, water, oil, mondtau });
  }
  if (!brews.length) return fail(i18n("Notice.Empty"));
  for (const [itemId, qty] of usage) {
    if ((actor.items.get(itemId).system.quantity ?? 1) < qty) return fail(i18n("Notice.NotEnough", { name: actor.items.get(itemId).name }));
  }
  for (const liquid of ["oil", "mondtau"]) {
    if (liquidTotal(actor, liquid) < liquids[liquid]) return fail(i18n("Notice.NotEnough", { name: i18n(`Liquid.${liquid}`) }));
  }

  const stations = { destille: tools.has("destille"), athanor: tools.has("athanor") };
  const outcomes = brews.map((b) => evaluateBrew(b, stations));

  // Use everything up, then hand out the results.
  for (const [itemId, qty] of usage) await consumeQty(actor.items.get(itemId), qty);
  for (const liquid of ["oil", "mondtau"]) if (liquids[liquid]) await consumeLiquid(actor, liquid, liquids[liquid]);

  const hints = game.settings.get(MODULE_ID, HINTS_SETTING);
  const known = knownRecipes(actor);
  const before = known.size;
  const results = [];
  for (const outcome of outcomes) {
    if (outcome.fail) {
      const data = await packItemData("alchemy", (f) => f.role === "failedPotion");
      if (data) await addToStack(actor, (i) => i.getFlag(MODULE_ID, "role") === "failedPotion", data, 1);
      results.push({ fail: true, hintKey: hints ? outcome.hintKey : null, hintData: hints ? outcome.hintData : null });
      continue;
    }
    const { item } = buildPotion(outcome.effectId, outcome.tier);
    item.system.price.value = potionPrice(outcome.effectId, outcome.tier);
    await addToStack(actor, (i) => {
      const f = i.flags?.[MODULE_ID] ?? {};
      return f.role === "potion" && f.potionEffect === outcome.effectId && Number(f.potionTier) === outcome.tier;
    }, item, 1);
    known.add(recipeKey(outcome.effectId, outcome.tier, outcome.variant));
    results.push({ effectId: outcome.effectId, tier: outcome.tier, name: item.name });
  }
  if (known.size !== before) await actor.setFlag(MODULE_ID, KNOWN_FLAG, [...known]);
  return { ok: true, message: "", results };
}

async function gmLearn(actor, op) {
  const { effectId, tier } = parseRecipeKey(op.key);
  const effect = EFFECT_BY_ID.get(effectId);
  if (!effect || tier > effect.maxTier) return fail(i18n("Notice.Refused"));
  const known = knownRecipes(actor);
  if (op.known) known.add(String(op.key));
  else known.delete(String(op.key));
  await actor.setFlag(MODULE_ID, KNOWN_FLAG, [...known]);
  return { ok: true, message: "" };
}

/** A recipe item reached an inventory: learn it and tell the owners (only when it is new to them). */
async function learnFromItem(actor, item) {
  const key = String(item.getFlag(MODULE_ID, "recipe") ?? "");
  const { effectId, tier } = parseRecipeKey(key);
  const effect = EFFECT_BY_ID.get(effectId);
  if (!effect || tier > effect.maxTier) return;
  const known = knownRecipes(actor);
  if (known.has(key)) return;
  known.add(key);
  await actor.setFlag(MODULE_ID, KNOWN_FLAG, [...known]);
  const owners = game.users.filter((u) => actor.testUserPermission(u, "OWNER")).map((u) => u.id);
  const esc = foundry.utils.escapeHTML;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    whisper: owners,
    content: `<p>${i18n("Notice.Learned", { actor: esc(actor.name), recipe: esc(item.name) })}</p>`
  });
}

async function applyAlchemyOp(user, op = {}) {
  const actor = game.actors.get(String(op.actorId ?? ""));
  if (!actor) return fail(i18n("Notice.NoActor"));
  if (!user.isGM && !actor.testUserPermission(user, "OWNER")) return fail(i18n("Notice.Refused"));
  if (op.type === "gmLearn") return user.isGM ? gmLearn(actor, op) : fail(i18n("Notice.Refused"));
  const tools = toolsFor(actor);
  if (op.type === "grind") return grind(actor, tools, op);
  if (op.type === "brew") return brew(actor, tools, op);
  return fail(i18n("Notice.Refused"));
}

/* -------------------------------------------- */
/*  Requests                                     */
/* -------------------------------------------- */

const pending = new Map();

/** Sends an operation to the active GM and resolves with its result (`{ok, message, results?}`), or null. */
export function requestAlchemyOp(op) {
  const gm = game.users.activeGM;
  if (!gm) {
    ui.notifications.warn(i18n("Notice.NeedsGM"));
    return Promise.resolve(null);
  }
  if (gm.isSelf) {
    return applyAlchemyOp(game.user, op).catch((err) => {
      console.error(`${MODULE_ID} | Alchemy: operation failed`, err);
      return fail(String(err?.message ?? err));
    });
  }
  const requestId = foundry.utils.randomID();
  return new Promise((resolve) => {
    pending.set(requestId, resolve);
    setTimeout(() => {
      if (pending.delete(requestId)) resolve(fail(i18n("Notice.Timeout")));
    }, 15000);
    game.socket.emit(CHANNEL, { type: "alchemyOp", userId: game.user.id, requestId, op });
  });
}

export function registerAlchemyData() {
  game.settings.register(MODULE_ID, HINTS_SETTING, {
    name: "FIMBLEWOOD.Alchemy.Settings.Hints.name",
    hint: "FIMBLEWOOD.Alchemy.Settings.Hints.hint",
    scope: "world", config: true, type: Boolean, default: true
  });

  // Only the active GM handles recipe items, so each is learned exactly once.
  Hooks.on("createItem", (item) => {
    if (!game.users.activeGM?.isSelf) return;
    if (!(item.parent instanceof Actor) || item.getFlag(MODULE_ID, "role") !== "recipe") return;
    learnFromItem(item.parent, item).catch((err) => console.error(`${MODULE_ID} | Alchemy: learning a recipe failed`, err));
  });

  Hooks.once("ready", () => {
    game.socket.on(CHANNEL, async (data) => {
      if (data?.type === "alchemyOp") {
        if (!game.users.activeGM?.isSelf) return;
        const user = game.users.get(data.userId);
        if (!user) return;
        let result;
        try {
          result = await applyAlchemyOp(user, data.op);
        } catch (err) {
          console.error(`${MODULE_ID} | Alchemy: operation from ${user.name} failed`, err);
          result = fail(String(err?.message ?? err));
        }
        game.socket.emit(CHANNEL, { type: "alchemyResult", userId: user.id, requestId: data.requestId, result });
      } else if (data?.type === "alchemyResult" && data.userId === game.user.id) {
        const resolve = pending.get(data.requestId);
        if (resolve) {
          pending.delete(data.requestId);
          resolve(data.result);
        }
      }
    });
  });
}
