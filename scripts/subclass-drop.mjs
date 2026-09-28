/**
 * Dropping one of this module's subclasses on a character that does not have the parent class yet.
 *
 * dnd5e only grants a subclass's features up to the *class* level, so on an actor without the class
 * the subclass is created with no advancement at all. Instead, the parent class is added first with
 * its normal advancement dialogs (spells, proficiencies, ...), and the subclass follows as soon as
 * that flow completes, so its features are granted too. If the actor already has the class, the
 * drop is left to dnd5e.
 */

const MODULE_ID = "fimblewood-academy";
const SUBCLASS_PACK = `${MODULE_ID}.subclasses`;
const CLASS_PACKS = ["dnd5e.classes24", "dnd5e.classes"]; // 2024 rules first

const subclassClass = new Map(); // subclass uuid -> class identifier
const pending = new Map(); // actor id -> { uuid, classId }

const advancementManager = () => dnd5e.applications.advancement.AdvancementManager;

async function findClassData(classId) {
  for (const packId of CLASS_PACKS) {
    const pack = game.packs.get(packId);
    if (!pack) continue;
    const index = await pack.getIndex({ fields: ["system.identifier"] });
    const entry = index.find(e => e.type === "class" && e.system?.identifier === classId);
    if (entry) return game.items.fromCompendium(await pack.getDocument(entry._id));
  }
  return null;
}

/** Run dnd5e's advancement flow for a new item, or create it directly if it has nothing to ask. */
async function addWithAdvancement(actor, itemData) {
  const manager = advancementManager().forNewItem(actor, itemData);
  if (manager.steps.length) manager.render(true);
  else await actor.createEmbeddedDocuments("Item", [itemData]);
}

async function addClassThenSubclass(actor, uuid, classId) {
  const classData = await findClassData(classId);
  if (!classData) {
    ui.notifications.warn(game.i18n.format("FIMBLEWOOD.SubclassDrop.NoClass", { class: classId }));
    return;
  }
  pending.set(actor.id, { uuid, classId });
  await addWithAdvancement(actor, classData);
}

export function registerSubclassDrop() {
  Hooks.once("ready", async () => {
    const pack = game.packs.get(SUBCLASS_PACK);
    if (!pack) return;
    const index = await pack.getIndex({ fields: ["system.classIdentifier"] });
    for (const e of index) subclassClass.set(e.uuid, e.system?.classIdentifier);
  });

  Hooks.on("dropActorSheetData", (actor, sheet, data) => {
    if (data?.type !== "Item" || actor.type !== "character") return;
    if (game.settings.get("dnd5e", "disableAdvancements")) return;
    const classId = subclassClass.get(data.uuid);
    if (!classId || actor.classes?.[classId]) return;
    addClassThenSubclass(actor, data.uuid, classId)
      .catch(err => console.error(`${MODULE_ID} | Subclass drop failed:`, err));
    return false;
  });

  // Once the class flow is done, add the subclass the same way so its features are granted.
  Hooks.on("dnd5e.advancementManagerComplete", async (manager) => {
    const actor = manager.actor;
    const wanted = pending.get(actor?.id);
    if (!wanted || !actor.classes?.[wanted.classId]) return;
    pending.delete(actor.id);
    try {
      const sub = await fromUuid(wanted.uuid);
      if (sub) await addWithAdvancement(actor, game.items.fromCompendium(sub));
    } catch (err) {
      console.error(`${MODULE_ID} | Adding the subclass after its class failed:`, err);
    }
  });
}
