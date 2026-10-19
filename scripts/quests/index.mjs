/**
 * Fimblewood Academy — Quests
 *
 * Entry point: registers the settings and the GM relay (data.mjs), the dock
 * (dock.mjs), the notifications (notify.mjs) and the "Quests" tool in the
 * Fimblewood control category. Open quest windows, the quest log and the dock
 * are refreshed whenever a quest journal or one of its pages changes.
 */

import { CONTROL_GROUP } from "../draw.mjs";
import { MODULE_ID, isQuest, getQuest, canSee, canCreate, requestQuestOp, registerQuestData } from "./data.mjs";
import { registerDock, renderDock } from "./dock.mjs";
import { registerQuestNotifications } from "./notify.mjs";

const sheets = new Map();
let _log = null;

export async function openQuest(id) {
  const entry = getQuest(id);
  if (!entry || !canSee(entry)) return null;
  const { QuestSheet } = await import("./quest-sheet.mjs");
  let sheet = sheets.get(id);
  if (!sheet?.rendered) {
    sheet = new QuestSheet(id);
    sheets.set(id, sheet);
    sheet.addEventListener?.("close", () => sheets.delete(id));
    sheet.render(true);
  } else {
    sheet.bringToTop();
  }
  return sheet;
}

export async function openQuestLog() {
  const { QuestLog } = await import("./quest-log.mjs");
  if (!_log?.rendered) {
    _log = new QuestLog();
    _log.render(true);
  } else {
    _log.bringToTop();
  }
  return _log;
}

/** Creates a quest (through the GM) and opens it. */
export async function createQuest(data = {}) {
  if (!canCreate()) return null;
  const result = await requestQuestOp({ type: "create", data });
  if (!result?.ok) return null;
  return openQuest(result.id);
}

let _refreshQueued = false;

/** Re-renders everything that shows quests, once per burst of changes. */
function refresh() {
  if (_refreshQueued) return;
  _refreshQueued = true;
  requestAnimationFrame(() => {
    _refreshQueued = false;
    renderDock();
    if (_log?.rendered) _log.render();
    for (const [id, sheet] of sheets) {
      if (!sheet.rendered) continue;
      const entry = getQuest(id);
      if (!entry || !canSee(entry)) sheet.close();
      else sheet.render();
    }
  });
}

export function registerQuests() {
  registerQuestData({ onDockChange: () => renderDock() });
  registerDock();
  registerQuestNotifications();

  for (const hook of ["createJournalEntry", "updateJournalEntry", "deleteJournalEntry"]) {
    Hooks.on(hook, (entry) => { if (isQuest(entry)) refresh(); });
  }
  for (const hook of ["createJournalEntryPage", "updateJournalEntryPage", "deleteJournalEntryPage"]) {
    Hooks.on(hook, (page) => { if (isQuest(page.parent)) refresh(); });
  }
  Hooks.on("updateUser", () => refresh());

  Hooks.on("getSceneControlButtons", (controls) => {
    const group = controls[CONTROL_GROUP];
    if (!group) return;
    group.tools.quests = {
      name: "quests",
      title: "FIMBLEWOOD.Quests.ButtonTitle",
      icon: "fas fa-scroll",
      button: true,
      visible: true,
      order: 9,
      onChange: () => openQuestLog()
    };
  });

  Hooks.once("ready", () => {
    // Who else is typing in a quest's notes, shown above the editor.
    game.socket.on("pm.usersEditing", (uuid, userIds) => {
      for (const sheet of sheets.values()) {
        if (!sheet.rendered) continue;
        const notes = sheet.entry?.pages.find((p) => p.getFlag(MODULE_ID, "role") === "notes");
        if (notes && uuid === `${notes.uuid}#text.content`) sheet.setEditingUsers(userIds ?? []);
      }
    });
  });
}
