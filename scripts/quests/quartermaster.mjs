/**
 * Fimblewood Academy — Quests: Quartermaster adapter
 *
 * Quartermaster (module "quartermaster") preps loot as hidden items and
 * hidden currency on its backing actor, grouped into loot-prep folders. A
 * quest stores one folder id; awarding the quest reveals everything in that
 * folder into Quartermaster's party inventory.
 *
 * Quartermaster's API is pre-1.0 and exposes its internal modules as they
 * are, so every access to it lives in this file.
 */

import { MODULE_ID, FLAG, t, tf, questData } from "./data.mjs";

const QM_ID = "quartermaster";

function api() {
  const mod = game.modules.get(QM_ID);
  return mod?.active ? mod.api ?? null : null;
}

export function isAvailable() {
  const a = api();
  return !!(a?.lootPrepFolders?.getFolders && a?.hiddenItems?.getHiddenItems);
}

function backingActor() {
  return game.actors.find((a) => a.getFlag(QM_ID, "isQuartermasterBackingActor")) ?? null;
}

/** [{ id, name }] */
export function getFolders() {
  const actor = backingActor();
  if (!actor || !isAvailable()) return [];
  try {
    return (api().lootPrepFolders.getFolders(actor) ?? [])
      .slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((f) => ({ id: f.id, name: f.name }));
  } catch (err) {
    console.warn(`${MODULE_ID} | Quests: reading Quartermaster folders failed`, err);
    return [];
  }
}

function folderItems(actor, folderId) {
  return api().hiddenItems.getHiddenItems(actor).filter((i) => i.getFlag(QM_ID, "lootPrepFolder") === folderId);
}

function folderCurrency(actor, folderId) {
  return (api().hiddenCurrency?.getHiddenCurrency(actor) ?? []).filter((e) => e.folderId === folderId);
}

/** What a folder holds, as [{ name, img, qty }] for display. */
export function folderContents(folderId) {
  const actor = backingActor();
  if (!actor || !isAvailable()) return [];
  try {
    const items = folderItems(actor, folderId).map((i) => ({
      name: i.name, img: i.img, qty: Number(i.system?.quantity) || 1
    }));
    const coins = folderCurrency(actor, folderId).map((e) => ({
      name: `${e.amount} ${e.currencySymbol ?? e.currencyName ?? e.currencyId ?? e.type}`, img: null, qty: 1
    }));
    return [...items, ...coins];
  } catch (err) {
    console.warn(`${MODULE_ID} | Quests: reading Quartermaster loot failed`, err);
    return [];
  }
}

export function openLootPrep() {
  api()?.ui?.openLootPrep?.();
}

/** Reveals the quest's folder into the party inventory. GM only. */
export async function awardQuestLoot(entry) {
  const q = questData(entry);
  const fail = (message) => ({ ok: false, message });
  if (!game.user.isGM) return fail(t("Notice.NoPermission"));
  if (!isAvailable()) return fail(t("Rewards.QmMissing"));
  if (q.rewards.awarded) return fail(t("Rewards.Awarded"));
  const actor = backingActor();
  const folderId = q.rewards.qmFolderId;
  if (!actor || !folderId || !getFolders().some((f) => f.id === folderId)) return fail(t("Rewards.FolderMissing"));

  const contents = folderContents(folderId);
  const items = folderItems(actor, folderId);
  const currency = folderCurrency(actor, folderId);
  const failed = [];

  const res = await api().hiddenItems.revealItems(items.map((i) => i.id), { announce: false });
  for (const r of res?.results ?? []) if (r.status !== "success") failed.push(r.itemName ?? r.itemId);
  // One at a time: each reveal rewrites the whole hidden-currency list.
  for (const entryData of currency) {
    const r = await api().hiddenCurrency.revealHiddenCurrency(entryData.id);
    if (r?.status !== "success") failed.push(`${entryData.amount} ${entryData.currencySymbol ?? ""}`.trim());
  }

  const awardedItems = contents.filter((c) => !failed.includes(c.name));
  await entry.update({
    [`flags.${MODULE_ID}.${FLAG}.rewards.awarded`]: true,
    [`flags.${MODULE_ID}.${FLAG}.rewards.awardedItems`]: awardedItems
  });
  Hooks.callAll("fimblewoodQuestLootAwarded", entry, awardedItems);
  api().ui?.refreshInventory?.();

  if (failed.length) return fail(tf("Rewards.PartialFail", { items: failed.join(", ") }));
  ui.notifications.info(tf("Rewards.AwardedNotice", { name: entry.name }));
  return { ok: true };
}
