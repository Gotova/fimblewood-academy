/**
 * Fimblewood Academy — Timetable afternoon appointments
 *
 * After classes each PC has two free slots per day (afternoon, evening) for
 * clubs, jobs or anything else. Unlike courses, these aren't part of the
 * GM's A/B week rotation: every appointment belongs to one concrete in-game
 * day (`day`, see calendar.mjs's dayNumberForTimestamp) and is created by
 * the players themselves for their own character (`ownerId`), who can
 * invite other PCs (`invitees`) — the appointment then shows up in their
 * timetable too.
 *
 * Players can't write world settings, so every change goes through
 * requestAfternoonChange(): the active GM applies it directly, everyone
 * else sends it over the module socket to the active GM, who checks the
 * sender owns the character(s) involved before writing. The setting's
 * onChange then re-renders every open Timetable window, same as courses.
 *
 * The GM can mark utility/test characters as not relevant in the module
 * settings (see relevant-characters-app.mjs); those never show up in the
 * timetable's character pickers.
 */

import { currentTimeOfDay, currentTimestamp, dayNumberForTimestamp } from "./calendar.mjs";
import { RelevantCharactersApp } from "./relevant-characters-app.mjs";

const MODULE_ID = "fimblewood-academy";
const CHANNEL = `module.${MODULE_ID}`;
export const AFTERNOON_SETTING = "timetableAfternoon";
const EXCLUDED_SETTING = "timetableExcludedActors";

/** The two free slots after classes. */
export const AFTERNOON_SLOTS = [
  { key: "Afternoon", start: "17:00", end: "19:00" },
  { key: "Evening", start: "19:30", end: "21:30" }
];

/** Appointments older than this many days are dropped on the next write. */
const KEEP_PAST_DAYS = 14;
const MAX_TITLE = 100;
const MAX_DESCRIPTION = 2000;

function timeToMinutes(str) {
  const [h, m] = str.split(":").map(Number);
  return h * 60 + m;
}

/** Index of the afternoon slot we're in right now by Simple Calendar's clock, or null. */
export function currentAfternoonSlot() {
  const t = currentTimeOfDay();
  if (!t) return null;
  const nowMin = t.hour * 60 + t.minute;
  const index = AFTERNOON_SLOTS.findIndex((s) => nowMin >= timeToMinutes(s.start) && nowMin < timeToMinutes(s.end));
  return index === -1 ? null : index;
}

/* -------------------------------------------- */
/*  Reading                                      */
/* -------------------------------------------- */

export function getAppointments() {
  return foundry.utils.deepClone(game.settings.get(MODULE_ID, AFTERNOON_SETTING)?.appointments ?? []);
}

export function getAppointment(id, appointments = getAppointments()) {
  return appointments.find((a) => a.id === id) ?? null;
}

export function involves(appointment, actorId) {
  return appointment.ownerId === actorId || appointment.invitees.includes(actorId);
}

/** Appointments `actorId` organises or is invited to, on the given day and slot. */
export function appointmentsFor(actorId, day, slot, appointments = getAppointments()) {
  return appointments.filter((a) => a.day === day && a.slot === slot && involves(a, actorId));
}

/**
 * Actors in `appointment` (organiser and invitees) who already have a
 * *different* appointment at the same day and slot. Map of actorId -> [titles].
 */
export function conflictingParticipants(appointment, appointments = getAppointments()) {
  const siblings = appointments.filter((a) => a.id !== appointment.id && a.day === appointment.day && a.slot === appointment.slot);
  const conflicts = new Map();
  for (const actorId of [appointment.ownerId, ...appointment.invitees]) {
    const clashing = siblings.filter((a) => involves(a, actorId));
    if (clashing.length) conflicts.set(actorId, clashing.map((a) => a.title));
  }
  return conflicts;
}

/** Every player character (owned by at least one player), relevant or not — the candidates for the Characters menu. */
export function playerCharacters() {
  return game.actors.filter((a) => a.type === "character" && a.hasPlayerOwner)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Actor ids the GM marked as not relevant (utility/test characters) in the Characters menu. */
export function excludedActorIds() {
  return new Set(game.settings.get(MODULE_ID, EXCLUDED_SETTING) ?? []);
}

export async function setExcludedActorIds(ids) {
  await game.settings.set(MODULE_ID, EXCLUDED_SETTING, [...ids]);
}

/** Player characters that can take part in appointments: player-owned characters the GM hasn't excluded. */
export function plannableActors() {
  const excluded = excludedActorIds();
  return playerCharacters().filter((a) => !excluded.has(a.id));
}

/* -------------------------------------------- */
/*  Permissions                                  */
/* -------------------------------------------- */

function ownsActor(user, actorId) {
  if (user.isGM) return true;
  return game.actors.get(actorId)?.testUserPermission(user, "OWNER") ?? false;
}

/** The organiser's owners (and the GM) may edit or delete an appointment. */
export function canEdit(appointment, user = game.user) {
  return ownsActor(user, appointment.ownerId);
}

/** Only owners of the character (and the GM) may plan in its name. */
export function canPlanFor(actorId, user = game.user) {
  return ownsActor(user, actorId);
}

/* -------------------------------------------- */
/*  Writing (active GM only)                     */
/* -------------------------------------------- */

function sanitize(raw) {
  const ownerId = String(raw.ownerId ?? "");
  const invitees = [...new Set((raw.invitees ?? []).map(String))]
    .filter((id) => id !== ownerId && game.actors.has(id));
  return {
    id: String(raw.id || foundry.utils.randomID()),
    day: Number(raw.day),
    slot: Number(raw.slot),
    title: String(raw.title ?? "").trim().slice(0, MAX_TITLE),
    description: String(raw.description ?? "").trim().slice(0, MAX_DESCRIPTION),
    ownerId,
    invitees
  };
}

function isValid(a) {
  return a.title && Number.isInteger(a.day) && Number.isInteger(a.slot) && a.slot >= 0 && a.slot < AFTERNOON_SLOTS.length && game.actors.has(a.ownerId);
}

function prune(appointments) {
  const today = dayNumberForTimestamp(currentTimestamp());
  if (today == null) return appointments;
  return appointments.filter((a) => a.day >= today - KEEP_PAST_DAYS);
}

/** Applies one change on the active GM's client, on behalf of `user`. Returns false if refused. */
async function applyChange(user, { op, appointment, id, actorId }) {
  let list = getAppointments();
  let invited = [];
  let saved = null;

  if (op === "upsert") {
    const next = sanitize(appointment);
    if (!isValid(next) || !canPlanFor(next.ownerId, user)) return false;
    const index = list.findIndex((a) => a.id === next.id);
    if (index === -1) {
      invited = next.invitees;
      list.push(next);
    } else {
      if (!canEdit(list[index], user)) return false;
      invited = next.invitees.filter((i) => !list[index].invitees.includes(i));
      list[index] = next;
    }
    saved = next;
  } else if (op === "delete") {
    const existing = getAppointment(id, list);
    if (!existing || !canEdit(existing, user)) return false;
    list = list.filter((a) => a.id !== id);
  } else if (op === "leave") {
    const existing = getAppointment(id, list);
    if (!existing || !existing.invitees.includes(actorId) || !ownsActor(user, actorId)) return false;
    existing.invitees = existing.invitees.filter((i) => i !== actorId);
  } else {
    return false;
  }

  await game.settings.set(MODULE_ID, AFTERNOON_SETTING, { appointments: prune(list) });

  if (saved && invited.length) {
    const message = { type: "ttInvited", actorIds: invited, title: saved.title, ownerId: saved.ownerId, userId: user.id };
    game.socket.emit(CHANNEL, message);
    notifyInvited(message);
  }
  return true;
}

/**
 * Create/update (`{op: "upsert", appointment}`), delete (`{op: "delete", id}`)
 * or leave as invitee (`{op: "leave", id, actorId}`). Routed to the active GM.
 */
export async function requestAfternoonChange(change) {
  const gm = game.users.activeGM;
  if (!gm) {
    ui.notifications.warn(game.i18n.localize("FIMBLEWOOD.Timetable.Afternoon.NeedsGM"));
    return false;
  }
  if (gm.isSelf) return applyChange(game.user, change);
  game.socket.emit(CHANNEL, { type: "ttAfternoon", userId: game.user.id, change });
  return true;
}

/** Tells the players of newly invited characters (not the inviter, not the GM) about the invitation. */
function notifyInvited({ actorIds, title, ownerId, userId }) {
  if (game.user.isGM || game.user.id === userId) return;
  const mine = actorIds.map((id) => game.actors.get(id)).filter((a) => a?.isOwner);
  if (!mine.length) return;
  const organiser = game.actors.get(ownerId)?.name ?? "?";
  for (const actor of mine) {
    ui.notifications.info(game.i18n.format("FIMBLEWOOD.Timetable.Afternoon.InvitedNotice", { actor: actor.name, organiser, title }));
  }
}

/* -------------------------------------------- */
/*  Registration                                 */
/* -------------------------------------------- */

export function registerAfternoonData(onChange) {
  game.settings.register(MODULE_ID, AFTERNOON_SETTING, {
    scope: "world", config: false, type: Object, default: { appointments: [] },
    onChange: () => onChange()
  });
  game.settings.register(MODULE_ID, EXCLUDED_SETTING, {
    scope: "world", config: false, type: Array, default: [],
    onChange: () => onChange()
  });
  game.settings.registerMenu(MODULE_ID, "timetableCharacters", {
    name: "FIMBLEWOOD.Timetable.Characters.MenuName",
    label: "FIMBLEWOOD.Timetable.Characters.MenuLabel",
    hint: "FIMBLEWOOD.Timetable.Characters.MenuHint",
    icon: "fas fa-user-check",
    type: RelevantCharactersApp,
    restricted: true
  });

  Hooks.once("ready", () => {
    game.socket.on(CHANNEL, async (data) => {
      if (data?.type === "ttAfternoon") {
        if (!game.users.activeGM?.isSelf) return;
        const user = game.users.get(data.userId);
        if (!user) return;
        const ok = await applyChange(user, data.change ?? {});
        if (!ok) console.warn(`${MODULE_ID} | Timetable: refused an afternoon change from ${user.name}`, data.change);
      } else if (data?.type === "ttInvited") {
        notifyInvited(data);
      }
    });
  });
}
