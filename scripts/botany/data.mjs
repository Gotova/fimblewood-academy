/**
 * Fimblewood Academy — Botany Club data and rules
 *
 * World settings hold everything, so the GM (the only writer) can adjust it:
 *
 *   botanyMembers  { [actorId]: { size } }                      which characters are in the club, and the garden size
 *   botanyGardens  { [actorId]: { slots: { [index]: plant }, lastDay } }
 *   plant          { plantId, maturity (0-100), hp, plantedDay }
 *   mods           { [slotIndex]: { growth?, yield? } }          bed modifiers, see modifiers.mjs
 *   botanyGrowthDays  { [plantId]: days }                       the GM's growth times; plants not listed use their default
 *
 * Players never write settings themselves: they send a request (see
 * requestGardenOp) which the active GM's client validates and applies, the
 * same pattern the timetable uses for afternoon appointments.
 *
 * Growth: every day change of Simple Calendar Reborn adds `100 / growthDays`
 * maturity to every living plant (the GM can switch that off, and can edit
 * maturity and HP directly). Care is judged by the GM alone: only the GM
 * changes HP.
 */

import { currentTimestamp, dayNumberForTimestamp, isCalendarAvailable, onDateChange } from "../timetable/calendar.mjs";
import {
  MODULE_ID, PLANT_BY_ID, DEFAULT_SIZE, GARDEN_SIZES, slotCount, harvestIndexEntry
} from "./plants.mjs";
import { potionInfo, fertilizerFactor, cleanFactor, setFactor, growthFactor } from "./modifiers.mjs";

export const MEMBERS_SETTING = "botanyMembers";
export const GARDENS_SETTING = "botanyGardens";
export const AUTOGROW_SETTING = "botanyAutoGrow";
export const GROWTH_SETTING = "botanyGrowthDays";
const CHANNEL = `module.${MODULE_ID}`;

const i18n = (key, data) => (data ? game.i18n.format(`FIMBLEWOOD.Botany.${key}`, data) : game.i18n.localize(`FIMBLEWOOD.Botany.${key}`));

/* -------------------------------------------- */
/*  Reading                                      */
/* -------------------------------------------- */

export function getMembers() {
  const raw = game.settings.get(MODULE_ID, MEMBERS_SETTING) ?? {};
  const members = {};
  for (const [id, value] of Object.entries(raw)) {
    if (game.actors.has(id)) members[id] = { size: GARDEN_SIZES[value?.size] ? value.size : DEFAULT_SIZE };
  }
  return members;
}

/** The club's characters that `user` may garden for: all of them for the GM, else the ones they own. */
export function memberActors(user = game.user) {
  return Object.keys(getMembers())
    .map((id) => game.actors.get(id))
    .filter((a) => a && (user.isGM || a.testUserPermission(user, "OWNER")))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function isMember(user = game.user) {
  return memberActors(user).length > 0;
}

export function getGardens() {
  return game.settings.get(MODULE_ID, GARDENS_SETTING) ?? {};
}

/** A member's garden with a guaranteed `slots` object. */
export function getGarden(actorId) {
  const garden = getGardens()[actorId] ?? {};
  return { slots: garden.slots ?? {}, mods: garden.mods ?? {}, lastDay: garden.lastDay ?? null };
}

/** Days a plant needs to ripen: the GM's value if set, else the default for its rarity. */
export function growthDays(plant) {
  const custom = Number(game.settings.get(MODULE_ID, GROWTH_SETTING)?.[plant.id]);
  return Number.isFinite(custom) && custom >= 1 ? custom : plant.defaultGrowthDays;
}

export async function saveGrowthDays(overrides) {
  return game.settings.set(MODULE_ID, GROWTH_SETTING, overrides);
}

export async function saveMembers(members) {
  return game.settings.set(MODULE_ID, MEMBERS_SETTING, members);
}

export function today() {
  return dayNumberForTimestamp(currentTimestamp());
}

/** A plant's derived state, for display. */
export function plantState(slot) {
  const plant = PLANT_BY_ID.get(slot?.plantId);
  if (!plant) return null;
  const maturity = Math.max(0, Math.min(100, Number(slot.maturity) || 0));
  const hp = Math.max(0, Math.min(plant.maxHp, Number(slot.hp) || 0));
  return { plant, maturity, hp, dead: hp <= 0, ripe: maturity >= 100 && hp > 0 };
}

/** The seed items of an actor, with the plant each one grows (null if the GM never assigned one). */
export function seedsOf(actor) {
  return (actor?.items ?? [])
    .filter((i) => i.type === "loot" && i.system.type?.value === "seed")
    .map((item) => ({ item, plant: PLANT_BY_ID.get(item.getFlag(MODULE_ID, "plantId")) ?? null }));
}

/* -------------------------------------------- */
/*  Applying changes (active GM only)            */
/* -------------------------------------------- */

const fail = (message) => ({ ok: false, message });
const done = (message) => ({ ok: true, message });

function round1(n) {
  return Math.round(n * 10) / 10;
}

async function writeGardens(gardens) {
  await game.settings.set(MODULE_ID, GARDENS_SETTING, gardens);
}

/** Adds `days` of growth to every living plant in `gardens` (mutates). */
function grow(gardens, days) {
  if (!(days > 0)) return;
  for (const garden of Object.values(gardens)) {
    for (const [key, slot] of Object.entries(garden.slots ?? {})) {
      const state = plantState(slot);
      if (!state || state.dead) continue;
      const factor = growthFactor(garden.mods?.[key]);
      slot.maturity = Math.min(100, round1(state.maturity + (days * 100 * factor) / growthDays(state.plant)));
    }
  }
}

/** Adds one harvested stack to the actor, merging with an existing stack of the same ingredient. */
async function grantHarvest(actor, ingredientId, quantity) {
  const entry = await harvestIndexEntry(ingredientId);
  if (!entry) return false;
  const existing = actor.items.find((i) => i.getFlag(MODULE_ID, "ingredientId") === ingredientId && i.getFlag(MODULE_ID, "role") === "harvest");
  if (existing) {
    await existing.update({ "system.quantity": (existing.system.quantity ?? 0) + quantity });
    return true;
  }
  const doc = await game.packs.get(`${MODULE_ID}.botany`).getDocument(entry._id);
  const data = doc.toObject();
  delete data._id;
  data.system.quantity = quantity;
  await actor.createEmbeddedDocuments("Item", [data]);
  return true;
}

/** Uses up one of an item: a smaller stack, or gone if it was the last. */
async function consumeOne(item) {
  const qty = item.system.quantity ?? 1;
  if (qty > 1) await item.update({ "system.quantity": qty - 1 });
  else await item.delete();
}

async function rollYield(plant) {
  const [min, max] = plant.yield;
  if (min === max) return min;
  const roll = await new Roll(`1d${max - min + 1}+${min - 1}`).evaluate();
  return roll.total;
}

/**
 * Applies one operation on the active GM's client, on behalf of `user`.
 * Everyone (for characters they own): `plant {actorId, slot, itemId}`, `harvest {actorId, slot}`.
 * Everyone also: `usePotion {actorId, slot, itemId}` and `useFertilizer {actorId, slot, itemId}`.
 * GM: additionally `gmPlant {actorId, slot, plantId}`, `gmSet {actorId, slot, maturity, hp}`,
 * `gmRemove {actorId, slot}`, `gmMod {actorId, slot, growth, yield, clear}` and `advance {days}`.
 */
async function applyOp(user, op = {}) {
  const gmOnly = ["gmPlant", "gmSet", "gmRemove", "gmMod", "advance"];
  if (gmOnly.includes(op.type) && !user.isGM) return fail(i18n("Notice.Refused"));

  if (op.type === "advance") {
    const days = Number(op.days);
    if (!Number.isFinite(days) || days <= 0 || days > 60) return fail(i18n("Notice.Refused"));
    const gardens = foundry.utils.deepClone(getGardens());
    grow(gardens, days);
    await writeGardens(gardens);
    return done(i18n("Notice.Advanced", { days }));
  }

  const actorId = String(op.actorId ?? "");
  const actor = game.actors.get(actorId);
  const member = getMembers()[actorId];
  if (!actor || !member) return fail(i18n("Notice.NotMember"));
  if (!user.isGM && !actor.testUserPermission(user, "OWNER")) return fail(i18n("Notice.Refused"));
  const slotIndex = Number(op.slot);
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= slotCount(member.size)) return fail(i18n("Notice.Refused"));

  const gardens = foundry.utils.deepClone(getGardens());
  const garden = (gardens[actorId] ??= { slots: {}, lastDay: today() });
  garden.slots ??= {};
  garden.mods ??= {};
  const key = String(slotIndex);

  if (op.type === "plant" || op.type === "gmPlant") {
    if (garden.slots[key]) return fail(i18n("Notice.SlotTaken"));
    let plant;
    let seed = null;
    if (op.type === "gmPlant") {
      plant = PLANT_BY_ID.get(op.plantId);
    } else {
      seed = actor.items.get(op.itemId);
      plant = PLANT_BY_ID.get(seed?.getFlag(MODULE_ID, "plantId"));
      if (!seed || seed.type !== "loot" || seed.system.type?.value !== "seed") return fail(i18n("Notice.NoSeed"));
    }
    if (!plant) return fail(i18n("Notice.NoPlant"));
    garden.slots[key] = { plantId: plant.id, maturity: 0, hp: plant.maxHp, plantedDay: today() };
    await writeGardens(gardens);
    if (seed) {
      const qty = seed.system.quantity ?? 1;
      if (qty > 1) await seed.update({ "system.quantity": qty - 1 });
      else await seed.delete();
    }
    return done(i18n("Notice.Planted", { plant: plant.name }));
  }

  // Modifiers work on a bed, planted or not.
  if (op.type === "gmMod") {
    if (op.clear) {
      delete garden.mods[key];
    } else {
      for (const which of ["growth", "yield"]) {
        if (op[which] == null) continue;
        const factor = cleanFactor(op[which]);
        if (factor == null) return fail(i18n("Notice.ModInvalid"));
        setFactor(garden.mods, key, which, factor);
      }
    }
    await writeGardens(gardens);
    return done(i18n("Notice.ModSet"));
  }

  if (op.type === "useFertilizer") {
    const item = actor.items.get(op.itemId);
    const factor = fertilizerFactor(item);
    if (!factor) return fail(i18n("Notice.NotUsable"));
    setFactor(garden.mods, key, "fertilizer", factor);
    await writeGardens(gardens);
    await consumeOne(item);
    return done(i18n("Notice.Fertilized", { factor: growthFactor(garden.mods[key]) }));
  }

  if (op.type === "usePotion") {
    const item = actor.items.get(op.itemId);
    const info = potionInfo(item);
    const effect = info?.effect;
    if (!effect) return fail(i18n("Notice.NotUsable"));
    if (effect.kind === "growth") {
      setFactor(garden.mods, key, "potion", info.factor);
      await writeGardens(gardens);
      await consumeOne(item);
      return done(i18n("Notice.Fertilized", { factor: growthFactor(garden.mods[key]) }));
    }
    const target = plantState(garden.slots[key]);
    if (!target) return fail(i18n("Notice.NeedsPlant"));
    if (target.dead) return fail(i18n("Notice.AlreadyDead"));
    garden.slots[key].hp = 0;
    await writeGardens(gardens);
    await consumeOne(item);
    return done(i18n("Notice.Withered", { plant: target.plant.name }));
  }

  const slot = garden.slots[key];
  const state = plantState(slot);
  if (!slot) return fail(i18n("Notice.SlotEmpty"));
  if (!state) {
    // Unknown plant id (catalogue changed): just clear it.
    delete garden.slots[key];
    await writeGardens(gardens);
    return done("");
  }

  if (op.type === "gmSet") {
    if (op.maturity != null) slot.maturity = Math.max(0, Math.min(100, round1(Number(op.maturity) || 0)));
    if (op.hp != null) slot.hp = Math.max(0, Math.min(state.plant.maxHp, Math.round(Number(op.hp) || 0)));
    await writeGardens(gardens);
    return done("");
  }

  if (op.type === "gmRemove") {
    delete garden.slots[key];
    await writeGardens(gardens);
    return done("");
  }

  if (op.type === "harvest") {
    // The bed's modifiers last until the next harvest: this one uses them up.
    const mod = garden.mods[key];
    delete garden.slots[key];
    delete garden.mods[key];
    await writeGardens(gardens);
    if (!state.ripe) return done(i18n(state.dead ? "Notice.RemovedDead" : "Notice.NothingGained", { plant: state.plant.name }));
    const quantity = Math.max(1, Math.round((await rollYield(state.plant)) * (mod?.yield ?? 1)));
    const granted = await grantHarvest(actor, state.plant.ingredientId, quantity);
    if (!granted) return fail(i18n("Notice.PackMissing"));
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p>${i18n("Chat.Harvested", { actor: foundry.utils.escapeHTML(actor.name), qty: quantity, plant: foundry.utils.escapeHTML(state.plant.name) })}</p>`
    });
    return done(i18n("Notice.Harvested", { qty: quantity, plant: state.plant.name }));
  }

  return fail(i18n("Notice.Refused"));
}

function notify(result) {
  if (result?.message) ui.notifications[result.ok ? "info" : "warn"](result.message);
}

/** Sends an operation to the active GM (or applies it right here if this client is the active GM). */
export async function requestGardenOp(op) {
  const gm = game.users.activeGM;
  if (!gm) {
    ui.notifications.warn(i18n("Notice.NeedsGM"));
    return;
  }
  if (gm.isSelf) {
    try {
      notify(await applyOp(game.user, op));
    } catch (err) {
      console.error(`${MODULE_ID} | Botany: operation failed`, err);
      ui.notifications.error(String(err?.message ?? err));
    }
    return;
  }
  game.socket.emit(CHANNEL, { type: "botanyOp", userId: game.user.id, op });
}

/* -------------------------------------------- */
/*  Growth over time (active GM only)            */
/* -------------------------------------------- */

/** Brings every garden up to the calendar's current day, growing plants by the days that passed. */
export async function syncGrowth() {
  if (!game.users.activeGM?.isSelf) return;
  const now = today();
  if (now == null) return;
  const gardens = foundry.utils.deepClone(getGardens());
  const auto = game.settings.get(MODULE_ID, AUTOGROW_SETTING);
  let changed = false;
  for (const [actorId, garden] of Object.entries(gardens)) {
    if (!game.actors.has(actorId)) continue;
    const delta = garden.lastDay == null ? 0 : now - garden.lastDay;
    if (delta > 0 && auto) grow({ [actorId]: garden }, delta);
    if (garden.lastDay !== now) {
      garden.lastDay = now;
      changed = true;
    }
  }
  if (changed) await writeGardens(gardens);
}

/* -------------------------------------------- */
/*  Registration                                 */
/* -------------------------------------------- */

export function registerBotanyData(onChange, MembersApp, GrowthApp) {
  const hidden = { scope: "world", config: false, type: Object, default: {}, onChange: () => onChange() };
  game.settings.register(MODULE_ID, MEMBERS_SETTING, hidden);
  game.settings.register(MODULE_ID, GARDENS_SETTING, hidden);
  game.settings.register(MODULE_ID, GROWTH_SETTING, { ...hidden, onChange: () => onChange() });
  game.settings.register(MODULE_ID, AUTOGROW_SETTING, {
    name: "FIMBLEWOOD.Botany.Settings.AutoGrow.name",
    hint: "FIMBLEWOOD.Botany.Settings.AutoGrow.hint",
    scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.registerMenu(MODULE_ID, "botanyMembersMenu", {
    name: "FIMBLEWOOD.Botany.Members.MenuName",
    label: "FIMBLEWOOD.Botany.Members.MenuLabel",
    hint: "FIMBLEWOOD.Botany.Members.MenuHint",
    icon: "fas fa-seedling",
    type: MembersApp,
    restricted: true
  });
  game.settings.registerMenu(MODULE_ID, "botanyGrowthMenu", {
    name: "FIMBLEWOOD.Botany.Growth.MenuName",
    label: "FIMBLEWOOD.Botany.Growth.MenuLabel",
    hint: "FIMBLEWOOD.Botany.Growth.MenuHint",
    icon: "fas fa-hourglass-half",
    type: GrowthApp,
    restricted: true
  });

  Hooks.once("ready", () => {
    game.socket.on(CHANNEL, async (data) => {
      if (data?.type === "botanyOp") {
        if (!game.users.activeGM?.isSelf) return;
        const user = game.users.get(data.userId);
        if (!user) return;
        let result;
        try {
          result = await applyOp(user, data.op);
        } catch (err) {
          console.error(`${MODULE_ID} | Botany: operation from ${user.name} failed`, err);
          result = fail(String(err?.message ?? err));
        }
        if (result?.message) game.socket.emit(CHANNEL, { type: "botanyResult", userId: user.id, result });
      } else if (data?.type === "botanyResult") {
        if (data.userId === game.user.id) notify(data.result);
      }
    });

    if (isCalendarAvailable()) {
      onDateChange(() => syncGrowth());
      syncGrowth();
    }
  });
}
