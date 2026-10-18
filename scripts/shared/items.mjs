/**
 * Fimblewood Academy — Shared helpers for stacks of items in inventories
 *
 * Used by the Botany Club garden and the alchemy workshop, which both take
 * items out of an inventory and put items from the module's compendiums in.
 */

const MODULE_ID = "fimblewood-academy";

/** Uses up `qty` of an item: a smaller stack, or gone if nothing is left. */
export async function consumeQty(item, qty = 1) {
  const have = item.system.quantity ?? 1;
  if (have > qty) await item.update({ "system.quantity": have - qty });
  else await item.delete();
}

export const consumeOne = (item) => consumeQty(item, 1);

/**
 * Adds `quantity` to the actor's stack of items for which `matches(item)` is
 * true, or creates a new stack from the item source `data`.
 */
export async function addToStack(actor, matches, data, quantity) {
  const existing = actor.items.find(matches);
  if (existing) {
    await existing.update({ "system.quantity": (existing.system.quantity ?? 0) + quantity });
    return existing;
  }
  const copy = foundry.utils.deepClone(data);
  delete copy._id;
  copy.system.quantity = quantity;
  const [created] = await actor.createEmbeddedDocuments("Item", [copy]);
  return created;
}

/** The source data of an item in one of this module's compendiums, found by its module flags. */
export async function packItemData(packName, matchFlags) {
  const pack = game.packs.get(`${MODULE_ID}.${packName}`);
  if (!pack) return null;
  const index = await pack.getIndex({ fields: [`flags.${MODULE_ID}`] });
  const entry = index.find((e) => matchFlags(e.flags?.[MODULE_ID] ?? {}));
  if (!entry) return null;
  return (await pack.getDocument(entry._id))?.toObject() ?? null;
}
