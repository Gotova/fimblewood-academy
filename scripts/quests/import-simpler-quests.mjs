/**
 * Fimblewood Academy — Quests: import from Simpler Quests
 *
 * Mythic's Simpler Quests keeps every quest in the world setting
 * "simpler-quests.questDB" ({ quests: [...] }). The raw setting is read from
 * the world's settings, so the import also works with that module disabled.
 * Each imported quest remembers the Simpler Quests id, so importing twice
 * does not create duplicates.
 */

import { MODULE_ID, t, tf, getQuests, questData, createQuestEntry, cleanObjective } from "./data.mjs";

const KEY = "simpler-quests.questDB";

/** The Simpler Quests quests, or null if there are none. */
export function simplerQuestsData() {
  try {
    const stored = game.settings.storage.get("world").getSetting?.(KEY)
      ?? game.settings.storage.get("world").find((s) => s.key === KEY);
    let value = stored?.value;
    if (typeof value === "string") value = JSON.parse(value);
    const quests = value?.quests;
    return Array.isArray(quests) && quests.length ? quests : null;
  } catch (err) {
    console.warn(`${MODULE_ID} | Quests: reading Simpler Quests data failed`, err);
    return null;
  }
}

const STATE = { 1: "done", "-1": "failed" };

/** Nested objectives with sub-objectives become one flat list with depths. */
function flatten(objectives = [], depth = 0, out = []) {
  for (const o of objectives) {
    out.push(cleanObjective({ text: o.text, state: STATE[o.state] ?? "open", secret: o.secret, depth }));
    flatten(o.subs, depth + 1, out);
  }
  return out;
}

export async function importSimplerQuests() {
  if (!game.user.isGM) return;
  const quests = simplerQuestsData() ?? [];
  const done = new Set(getQuests().map((e) => questData(e).importedFrom).filter(Boolean));
  let count = 0;
  for (const sq of quests) {
    if (!sq?.id || done.has(sq.id)) continue;
    await createQuestEntry(game.user, {
      name: sq.title || t("NewQuest"),
      quest: {
        status: sq.visible ? "active" : "draft",
        objectives: flatten(sq.objectives),
        importedFrom: sq.id
      }
    });
    count++;
  }
  ui.notifications.info(tf("Log.Imported", { count }));
}
