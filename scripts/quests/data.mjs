/**
 * Fimblewood Academy — Quests: data model, settings and the GM relay
 *
 * Every quest is a JournalEntry in the "Fimblewood Quests" folder. Its state
 * (status, category, picture, objectives, visibility, permissions, rewards)
 * is the flag `flags.fimblewood-academy.quest`. Two text pages hold the
 * description and the shared notes; the notes page is co-edited live with
 * Foundry's collaborative ProseMirror editor.
 *
 * Every write except typing in the notes goes through `requestQuestOp`: the
 * active GM applies it after checking the quest's permissions, so players
 * never need ownership of the journal itself. The journal stays at NONE for
 * players (which also keeps the folder out of their journal directory); only
 * the notes page is made OWNER for the players allowed to write in it, because
 * the collaborative editor saves that page directly.
 *
 * Foundry sends all journal data to every client, so hidden quests and
 * secret objectives are hidden in the UI only, as everywhere in Foundry.
 */

export const MODULE_ID = "fimblewood-academy";
export const CHANNEL = `module.${MODULE_ID}`;
export const FLAG = "quest";

export const STATUSES = ["active", "onhold", "completed", "failed", "draft"];
export const CATEGORIES = ["main", "side", "personal", "academy"];
export const STATES = ["open", "done", "failed"];
export const MAX_DEPTH = 3;

const FOLDER_SETTING = "questFolderId";
export const SETTINGS = {
  playersCreate: "questsPlayersCreate",
  defaultCheck: "questsDefaultCheck",
  defaultNotes: "questsDefaultNotes",
  defaultEdit: "questsDefaultEdit",
  chat: "questsChat",
  sound: "questsSound",
  dockEnabled: "questDockEnabled",
  dockPos: "questDockPos",
  dockCollapsed: "questDockCollapsed",
  dockExpanded: "questDockExpanded",
  dockHidden: "questDockHidden"
};

export const t = (key) => game.i18n.localize(`FIMBLEWOOD.Quests.${key}`);
export const tf = (key, data) => game.i18n.format(`FIMBLEWOOD.Quests.${key}`, data);

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

/* -------------------------------------------- */
/*  Reading                                      */
/* -------------------------------------------- */

export function isQuest(entry) {
  return !!entry?.flags?.[MODULE_ID]?.[FLAG];
}

export function defaultPerms() {
  return {
    checkObjectives: game.settings.get(MODULE_ID, SETTINGS.defaultCheck),
    editNotes: game.settings.get(MODULE_ID, SETTINGS.defaultNotes),
    editQuest: game.settings.get(MODULE_ID, SETTINGS.defaultEdit)
  };
}

/** The quest flag with every field filled in. */
export function questData(entry) {
  const raw = entry?.flags?.[MODULE_ID]?.[FLAG] ?? {};
  return {
    version: 1,
    status: STATUSES.includes(raw.status) ? raw.status : "active",
    category: CATEGORIES.includes(raw.category) ? raw.category : "side",
    image: raw.image ?? "",
    order: Number(raw.order) || 0,
    visibleTo: raw.visibleTo === "all" || !Array.isArray(raw.visibleTo) ? "all" : raw.visibleTo,
    perms: { checkObjectives: true, editNotes: true, editQuest: false, ...(raw.perms ?? {}) },
    objectives: (raw.objectives ?? []).map(cleanObjective),
    sequential: !!raw.sequential,
    rewards: { qmFolderId: null, xp: 0, text: "", autoAward: false, awarded: false, awardedItems: [], ...(raw.rewards ?? {}) },
    importedFrom: raw.importedFrom ?? null,
    createdBy: raw.createdBy ?? null
  };
}

export function cleanObjective(o = {}) {
  return {
    id: o.id || foundry.utils.randomID(),
    text: String(o.text ?? ""),
    state: STATES.includes(o.state) ? o.state : "open",
    secret: !!o.secret,
    optional: !!o.optional,
    afterPrevious: !!o.afterPrevious,
    depth: Math.max(0, Math.min(MAX_DEPTH, Number(o.depth) || 0))
  };
}

export function getQuests() {
  return game.journal.filter(isQuest)
    .sort((a, b) => (questData(a).order - questData(b).order) || a.name.localeCompare(b.name));
}

export function getQuest(id) {
  const entry = game.journal.get(id);
  return isQuest(entry) ? entry : null;
}

export function pageOf(entry, role) {
  return entry?.pages.find((p) => p.getFlag(MODULE_ID, "role") === role) ?? null;
}

export function canSee(entry, user = game.user) {
  if (user.isGM) return true;
  const q = questData(entry);
  if (q.status === "draft") return false;
  return q.visibleTo === "all" || q.visibleTo.includes(user.id);
}

/** Whether the user may do `perm` ("checkObjectives" | "editNotes" | "editQuest") on the quest. */
export function can(entry, perm, user = game.user) {
  if (user.isGM) return true;
  if (!canSee(entry, user)) return false;
  const perms = questData(entry).perms;
  if (perms.editQuest) return true;
  return !!perms[perm];
}

/** Whether an objective waits for the one above it (by itself or because the quest reveals them one by one). */
export function isLocked(q, index) {
  const o = q.objectives[index];
  const prev = q.objectives[index - 1];
  return !!prev && (o.afterPrevious || q.sequential) && prev.state === "open";
}

/**
 * The objectives a user sees: the GM all of them, players neither secret ones
 * nor ones still waiting for the objective above to be done or failed.
 */
export function visibleObjectives(q, user = game.user) {
  if (user.isGM) return q.objectives;
  return q.objectives.filter((o, i) => !o.secret && !isLocked(q, i));
}

/** Done / total of the objectives that count: optional ones are left out. */
export function progress(q, user = game.user) {
  const list = visibleObjectives(q, user).filter((o) => !o.optional);
  return { done: list.filter((o) => o.state === "done").length, total: list.length };
}

export function canCreate(user = game.user) {
  return user.isGM || game.settings.get(MODULE_ID, SETTINGS.playersCreate);
}

export function players() {
  return game.users.filter((u) => !u.isGM);
}

/* -------------------------------------------- */
/*  Objective text mode (Simpler Quests syntax)  */
/* -------------------------------------------- */

/** "+" done, "-" failed, "/" secret, "?" optional, "*" one level deeper — one objective per line. */
export function parseObjectives(text, previous = []) {
  const byText = new Map(previous.map((o) => [o.text, o]));
  const result = [];
  for (let line of String(text).split("\n")) {
    line = line.trim();
    const o = { state: "open", secret: false, optional: false, depth: 0 };
    while (/^[-+/*?]/.test(line)) {
      const c = line[0];
      if (c === "-") o.state = "failed";
      else if (c === "+") o.state = "done";
      else if (c === "/") o.secret = true;
      else if (c === "?") o.optional = true;
      else o.depth++;
      line = line.slice(1).trim();
    }
    if (!line) continue;
    // A line deeper than the one before it is clamped instead of rejected.
    const before = result.at(-1)?.depth ?? -1;
    o.depth = Math.min(o.depth, before + 1, MAX_DEPTH);
    result.push(cleanObjective({ ...o, text: line, id: byText.get(line)?.id }));
  }
  return result;
}

export function stringifyObjectives(objectives) {
  return objectives.map((o) =>
    `${"*".repeat(o.depth)}${o.secret ? "/" : ""}${o.optional ? "?" : ""}${o.state === "done" ? "+" : o.state === "failed" ? "-" : ""}${o.depth || o.secret || o.optional || o.state !== "open" ? " " : ""}${o.text}`
  ).join("\n");
}

/* -------------------------------------------- */
/*  Writing (active GM)                          */
/* -------------------------------------------- */

const { NONE, OWNER } = CONST.DOCUMENT_OWNERSHIP_LEVELS;
const INHERIT = CONST.DOCUMENT_OWNERSHIP_LEVELS.INHERIT;

async function questFolder() {
  let folder = game.folders.get(game.settings.get(MODULE_ID, FOLDER_SETTING));
  if (folder?.type === "JournalEntry") return folder;
  folder = game.folders.find((f) => f.type === "JournalEntry" && f.getFlag(MODULE_ID, "questFolder"));
  if (!folder) {
    folder = await Folder.create({
      name: "Fimblewood Quests", type: "JournalEntry", color: "#6b4a8a",
      flags: { [MODULE_ID]: { questFolder: true } }
    });
  }
  await game.settings.set(MODULE_ID, FOLDER_SETTING, folder.id);
  return folder;
}

/** Notes-page ownership: OWNER for every player who sees the quest and may write notes. */
function notesOwnership(entry) {
  const ownership = { default: INHERIT };
  for (const user of players()) {
    if (can(entry, "editNotes", user)) ownership[user.id] = OWNER;
  }
  return ownership;
}

async function syncOwnership(entry) {
  const notes = pageOf(entry, "notes");
  if (!notes) return;
  const wanted = notesOwnership(entry);
  if (foundry.utils.objectsEqual(wanted, notes.ownership)) return;
  await notes.update({ ownership: wanted }, { diff: false, recursive: false });
}

export async function createQuestEntry(user, data = {}) {
  const folder = await questFolder();
  const maxOrder = Math.max(0, ...getQuests().map((e) => questData(e).order));
  const quest = {
    ...questData(null),
    perms: user.isGM ? defaultPerms() : { ...defaultPerms(), editQuest: true },
    order: maxOrder + 1,
    createdBy: user.id,
    ...(data.quest ?? {})
  };
  quest.objectives = (quest.objectives ?? []).map(cleanObjective);
  const entry = await JournalEntry.create({
    name: data.name || t("NewQuest"),
    folder: folder.id,
    ownership: { default: NONE },
    flags: { [MODULE_ID]: { [FLAG]: quest } },
    pages: [
      { name: t("Tabs.Description"), type: "text", text: { content: data.description ?? "" }, flags: { [MODULE_ID]: { role: "description" } } },
      { name: t("Tabs.Notes"), type: "text", text: { content: "" }, flags: { [MODULE_ID]: { role: "notes" } } }
    ]
  });
  await syncOwnership(entry);
  return entry;
}

/* -------------------------------------------- */
/*  Operations                                   */
/* -------------------------------------------- */

const ok = (data = {}) => ({ ok: true, ...data });
const fail = (message) => ({ ok: false, message });

/** Hooks in other quest files (notifications, Quartermaster) see every change made here. */
async function writeQuest(entry, quest, extra = {}, user = game.user) {
  const before = questData(entry);
  const oldName = entry.name;
  await entry.update({ ...extra, [`flags.${MODULE_ID}.${FLAG}`]: quest });
  const after = questData(entry);
  if (before.status !== after.status || !foundry.utils.objectsEqual(before.visibleTo, after.visibleTo)
    || !foundry.utils.objectsEqual(before.perms, after.perms)) await syncOwnership(entry);
  Hooks.callAll("fimblewoodQuestChanged", entry, before, after, { user, oldName });
  return ok();
}

/** Applies one operation for `user`. Runs on the active GM only. */
export async function applyQuestOp(user, op) {
  if (op?.type === "create") {
    if (!canCreate(user)) return fail(t("Notice.NoPermission"));
    const entry = await createQuestEntry(user, op.data);
    Hooks.callAll("fimblewoodQuestChanged", entry, null, questData(entry), { user });
    return ok({ id: entry.id });
  }

  if (op?.type === "reorder") {
    if (!user.isGM) return fail(t("Notice.NoPermission"));
    const updates = (op.ids ?? []).filter((id) => getQuest(id))
      .map((id, i) => ({ _id: id, [`flags.${MODULE_ID}.${FLAG}.order`]: i + 1 }));
    await JournalEntry.updateDocuments(updates);
    return ok();
  }

  const entry = getQuest(op?.id);
  if (!entry) return fail(t("Notice.Missing"));
  const quest = questData(entry);

  switch (op.type) {
    case "update": {
      if (!can(entry, "editQuest", user)) return fail(t("Notice.NoPermission"));
      const changes = foundry.utils.deepClone(op.changes ?? {});
      // Visibility and permissions belong to the GM, even on a quest a player may edit.
      if (!user.isGM) {
        delete changes.visibleTo;
        delete changes.perms;
        delete changes.sequential;
        if (changes.status === "draft") delete changes.status;
      }
      delete changes.rewards?.awarded;
      delete changes.rewards?.awardedItems;
      const next = foundry.utils.mergeObject(quest, changes, { inplace: false });
      if (Array.isArray(changes.visibleTo) || changes.visibleTo === "all") next.visibleTo = changes.visibleTo;
      if (changes.objectives) next.objectives = changes.objectives.map(cleanObjective);
      if (changes.objectives && !user.isGM) {
        // Players don't see secret or still-locked objectives, so put back the ones they could not have sent,
        // each after the objective it followed before.
        const sent = new Set(next.objectives.map((o) => o.id));
        const shown = new Set(visibleObjectives(quest, user).map((o) => o.id));
        quest.objectives.forEach((o, i) => {
          if (sent.has(o.id) || shown.has(o.id)) return;
          const prevId = quest.objectives[i - 1]?.id;
          const at = prevId ? next.objectives.findIndex((n) => n.id === prevId) + 1 : 0;
          next.objectives.splice(at > 0 ? at : (prevId ? next.objectives.length : 0), 0, cleanObjective(o));
        });
      }
      const extra = typeof op.name === "string" && op.name.trim() ? { name: op.name.trim() } : {};
      return writeQuest(entry, next, extra, user);
    }
    case "setObjective": {
      const obj = quest.objectives.find((o) => o.id === op.objectiveId);
      if (!obj || !visibleObjectives(quest, user).includes(obj)) return fail(t("Notice.Missing"));
      if (!can(entry, "checkObjectives", user)) return fail(t("Notice.NoPermission"));
      if (!STATES.includes(op.state)) return fail(t("Notice.Missing"));
      obj.state = op.state;
      return writeQuest(entry, quest, {}, user);
    }
    case "setDescription": {
      if (!can(entry, "editQuest", user)) return fail(t("Notice.NoPermission"));
      await pageOf(entry, "description")?.update({ "text.content": String(op.html ?? "") });
      return ok();
    }
    case "saveNotes": {
      if (!can(entry, "editNotes", user)) return fail(t("Notice.NoPermission"));
      const page = pageOf(entry, "notes");
      if (page && page.text.content !== op.html) await page.update({ "text.content": String(op.html ?? "") });
      return ok();
    }
    case "delete": {
      if (!user.isGM && !(can(entry, "editQuest", user) && quest.createdBy === user.id)) return fail(t("Notice.NoPermission"));
      await entry.delete();
      return ok();
    }
    case "awardLoot": {
      if (!user.isGM) return fail(t("Notice.NoPermission"));
      const { awardQuestLoot } = await import("./quartermaster.mjs");
      return awardQuestLoot(entry);
    }
  }
  return fail(t("Notice.Unknown"));
}

const pending = new Map();

/** Sends an operation to the active GM, or applies it right here on the active GM. Resolves with the result. */
export async function requestQuestOp(op) {
  const gm = game.users.activeGM;
  let result;
  if (!gm) {
    result = fail(t("Notice.NeedsGM"));
  } else if (gm.isSelf) {
    result = await applyQuestOp(game.user, op).catch((err) => {
      console.error(`${MODULE_ID} | Quests: operation failed`, err);
      return fail(String(err?.message ?? err));
    });
  } else {
    const requestId = foundry.utils.randomID();
    result = await new Promise((resolve) => {
      pending.set(requestId, resolve);
      setTimeout(() => {
        if (pending.delete(requestId)) resolve(fail(t("Notice.Timeout")));
      }, 15000);
      game.socket.emit(CHANNEL, { type: "questOp", userId: game.user.id, requestId, op });
    });
  }
  if (!result?.ok && result?.message) ui.notifications.warn(result.message);
  return result;
}

/* -------------------------------------------- */
/*  Registration                                 */
/* -------------------------------------------- */

export function registerQuestData({ onDockChange }) {
  game.settings.register(MODULE_ID, FOLDER_SETTING, { scope: "world", config: false, type: String, default: "" });

  const worldBool = (key, name, def) => game.settings.register(MODULE_ID, key, {
    name: `FIMBLEWOOD.Quests.Settings.${name}.name`,
    hint: `FIMBLEWOOD.Quests.Settings.${name}.hint`,
    scope: "world", config: true, type: Boolean, default: def
  });
  worldBool(SETTINGS.playersCreate, "PlayersCreate", false);
  worldBool(SETTINGS.defaultCheck, "DefaultCheck", true);
  worldBool(SETTINGS.defaultNotes, "DefaultNotes", true);
  worldBool(SETTINGS.defaultEdit, "DefaultEdit", false);
  worldBool(SETTINGS.chat, "Chat", true);
  game.settings.register(MODULE_ID, SETTINGS.sound, {
    name: "FIMBLEWOOD.Quests.Settings.Sound.name",
    hint: "FIMBLEWOOD.Quests.Settings.Sound.hint",
    scope: "world", config: true, type: String, default: "",
    filePicker: "audio"
  });

  game.settings.register(MODULE_ID, SETTINGS.dockEnabled, {
    name: "FIMBLEWOOD.Quests.Settings.DockEnabled.name",
    hint: "FIMBLEWOOD.Quests.Settings.DockEnabled.hint",
    scope: "client", config: true, type: Boolean, default: true,
    onChange: () => onDockChange()
  });
  const clientHidden = (key, def) => game.settings.register(MODULE_ID, key, { scope: "client", config: false, type: Object, default: def });
  clientHidden(SETTINGS.dockPos, {});
  clientHidden(SETTINGS.dockExpanded, []);
  clientHidden(SETTINGS.dockHidden, []);
  game.settings.register(MODULE_ID, SETTINGS.dockCollapsed, { scope: "client", config: false, type: Boolean, default: false });

  Hooks.once("ready", () => {
    game.socket.on(CHANNEL, async (data) => {
      if (data?.type === "questOp") {
        if (!game.users.activeGM?.isSelf) return;
        const user = game.users.get(data.userId);
        if (!user) return;
        let result;
        try {
          result = await applyQuestOp(user, data.op);
        } catch (err) {
          console.error(`${MODULE_ID} | Quests: operation from ${user.name} failed`, err);
          result = fail(String(err?.message ?? err));
        }
        game.socket.emit(CHANNEL, { type: "questResult", userId: user.id, requestId: data.requestId, result });
      } else if (data?.type === "questResult" && data.userId === game.user.id) {
        const resolve = pending.get(data.requestId);
        if (resolve) {
          pending.delete(data.requestId);
          resolve(data.result);
        }
      }
    });
  });
}
