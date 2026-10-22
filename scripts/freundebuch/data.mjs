/**
 * Fimblewood Academy — Amans Freundebuch: data and transformations
 *
 * The book is an item (flag `isFreundebuch`); whoever carries it is "Aman".
 * The people in it live on the item as flag `friends`, each a snapshot of
 * the token the GM added (name, portrait, token image), so unlinked NPC
 * tokens work too.
 *
 * Two kinds of change:
 *  - Animal forms (actors in the folder "Aman Formen") use dnd5e's own
 *    transformation with the Wild Shape preset (Chaotic Wild Shape).
 *  - People only change the look: portrait, prototype token and every
 *    placed token (image and name). The original look is kept in the actor
 *    flag `freundebuchDisguise` until he changes back.
 *
 * Everything runs on the client that clicks: dnd5e swaps the tokens on that
 * client's canvas. A player's revert cannot delete the temporary Wild Shape
 * actor, so the active GM is asked over the socket to delete it.
 */

export const MODULE_ID = "fimblewood-academy";
export const FORMS_FOLDER = "Aman Formen";
const CHANNEL = `module.${MODULE_ID}`;
const DISGUISE = "freundebuchDisguise";
const FORM = "freundebuchForm";

const t = (key, data) => data
  ? game.i18n.format(`FIMBLEWOOD.Freundebuch.${key}`, data)
  : game.i18n.localize(`FIMBLEWOOD.Freundebuch.${key}`);

export const isBook = (item) => !!item?.flags?.[MODULE_ID]?.isFreundebuch;

/** The book, from the world's actors (not the temporary Wild Shape copies). */
export function findBook() {
  for (const actor of game.actors) {
    if (actor.isPolymorphed) continue;
    const book = actor.items.find(isBook);
    if (book) return book;
  }
  return null;
}

export const bookOwner = () => findBook()?.parent ?? null;

/** Whether the current user may open the book: the GM, or a player owning Aman. */
export function canOpen() {
  if (game.user.isGM) return true;
  return !!bookOwner()?.isOwner;
}

/* -------------------------------------------- */
/*  Entries                                      */
/* -------------------------------------------- */

export function getFriends(book = findBook()) {
  return book?.getFlag(MODULE_ID, "friends") ?? [];
}

async function saveFriends(book, friends) {
  await book.setFlag(MODULE_ID, "friends", friends);
}

/** The actors in the folder "Aman Formen" (with its subfolders), by name. */
export function animalForms() {
  const folder = game.folders.find((f) => f.type === "Actor" && f.name === FORMS_FOLDER);
  if (!folder) return [];
  const ids = new Set([folder.id, ...folder.getSubfolders(true).map((f) => f.id)]);
  return game.actors
    .filter((a) => a.folder && ids.has(a.folder.id) && !a.isPolymorphed)
    .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
}

/** Whether a token belongs to Aman himself (or one of his forms). */
export function isAmanToken(tokenDoc) {
  const aman = bookOwner();
  const actor = tokenDoc?.actor;
  if (!aman || !actor) return false;
  if (tokenDoc.actorId === aman.id) return true;
  if (actor.getFlag("dnd5e", "originalActor") === aman.id) return true;
  return animalForms().some((f) => f.id === tokenDoc.actorId);
}

export async function addFriend(tokenDoc) {
  const book = findBook();
  if (!book) return ui.notifications.warn(t("NoBook"));
  if (isAmanToken(tokenDoc)) return ui.notifications.warn(t("NotAman"));
  const friends = getFriends(book);
  const src = tokenDoc.texture.src;
  if (friends.some((f) => f.name === tokenDoc.name && f.token.src === src)) {
    return ui.notifications.info(t("AlreadyIn", { name: tokenDoc.name }));
  }
  friends.push({
    id: foundry.utils.randomID(),
    actorUuid: tokenDoc.actor?.uuid ?? null,
    name: tokenDoc.name,
    img: tokenDoc.actor?.img || src,
    token: { src, scaleX: tokenDoc.texture.scaleX ?? 1, scaleY: tokenDoc.texture.scaleY ?? 1 }
  });
  await saveFriends(book, friends);
  ui.notifications.info(t("Added", { name: tokenDoc.name }));
}

export async function removeFriend(id) {
  const book = findBook();
  if (!book) return;
  await saveFriends(book, getFriends(book).filter((f) => f.id !== id));
}

/* -------------------------------------------- */
/*  Current form                                 */
/* -------------------------------------------- */

/** The temporary Wild Shape actor Aman is in right now, if any. */
function polymorphOf(aman) {
  return polymorphsOf(aman)[0] ?? null;
}

/** All of them: normally one, but a failed change back can leave more. */
function polymorphsOf(aman) {
  return game.actors.filter((a) => a.isPolymorphed && a.getFlag("dnd5e", "originalActor") === aman.id);
}

/** @returns {{kind: "animal", id: string, name: string} | {kind: "person", id: string, name: string} | null} */
export function currentForm(aman = bookOwner()) {
  if (!aman) return null;
  const poly = polymorphOf(aman);
  if (poly) {
    const formId = poly.getFlag(MODULE_ID, FORM);
    return { kind: "animal", id: formId, name: game.actors.get(formId)?.name ?? poly.name };
  }
  const disguise = aman.getFlag(MODULE_ID, DISGUISE);
  if (disguise) return { kind: "person", id: disguise.entryId, name: disguise.name };
  return null;
}

/* -------------------------------------------- */
/*  Looks (people)                               */
/* -------------------------------------------- */

/** Aman's linked tokens in every scene. */
function amanTokens(aman) {
  return game.scenes.contents.flatMap((scene) => scene.tokens.filter((tk) => tk.actorId === aman.id && tk.actorLink));
}

/** Flag keys must not contain dots (an update would split them), so no UUIDs. */
const tokenKey = (tk) => `${tk.parent.id}_${tk.id}`;

const lookOf = (tk) => ({ name: tk.name, src: tk.texture.src, scaleX: tk.texture.scaleX, scaleY: tk.texture.scaleY });

async function applyTokenLooks(aman, lookFor) {
  const byScene = new Map();
  for (const tk of amanTokens(aman)) {
    const look = lookFor(tk);
    if (!look) continue;
    if (!byScene.has(tk.parent)) byScene.set(tk.parent, []);
    byScene.get(tk.parent).push({
      _id: tk.id, name: look.name,
      "texture.src": look.src, "texture.scaleX": look.scaleX, "texture.scaleY": look.scaleY
    });
  }
  for (const [scene, updates] of byScene) await scene.updateEmbeddedDocuments("Token", updates);
}

async function disguiseAs(aman, entry) {
  const saved = aman.getFlag(MODULE_ID, DISGUISE);
  const original = saved?.original ?? {
    img: aman.img,
    proto: lookOf(aman.prototypeToken),
    tokens: Object.fromEntries(amanTokens(aman).map((tk) => [tokenKey(tk), lookOf(tk)]))
  };
  const look = { name: entry.name, ...entry.token };
  await aman.update({
    img: entry.img,
    "prototypeToken.name": look.name,
    "prototypeToken.texture.src": look.src,
    "prototypeToken.texture.scaleX": look.scaleX,
    "prototypeToken.texture.scaleY": look.scaleY,
    [`flags.${MODULE_ID}.${DISGUISE}`]: { entryId: entry.id, name: entry.name, original }
  });
  await applyTokenLooks(aman, () => look);
}

async function dropDisguise(aman) {
  const saved = aman.getFlag(MODULE_ID, DISGUISE);
  if (!saved) return;
  const original = saved.original ?? {};
  const tokens = original.tokens ?? {};
  // 0.48.0 saved the prototype under "prototype", which Foundry drops from flags; fall back to a saved token.
  const proto = original.proto ?? firstLook(tokens) ?? { name: aman.name, src: aman.prototypeToken.texture.src, scaleX: 1, scaleY: 1 };
  await aman.update({
    img: original.img ?? aman.img,
    "prototypeToken.name": proto.name,
    "prototypeToken.texture.src": proto.src,
    "prototypeToken.texture.scaleX": proto.scaleX ?? 1,
    "prototypeToken.texture.scaleY": proto.scaleY ?? 1,
    [`flags.${MODULE_ID}.-=${DISGUISE}`]: null
  });
  // Tokens placed while disguised get the original look of the prototype.
  await applyTokenLooks(aman, (tk) => tokens[tokenKey(tk)] ?? proto);
}

/** The first saved token look anywhere in an object (0.48.0 keyed them by UUID, which nests). */
function firstLook(obj) {
  if (!obj || typeof obj !== "object") return null;
  if (typeof obj.src === "string") return obj;
  for (const value of Object.values(obj)) {
    const look = firstLook(value);
    if (look) return look;
  }
  return null;
}

/* -------------------------------------------- */
/*  Animal forms                                 */
/* -------------------------------------------- */

function wildShapeSettings() {
  const Setting = dnd5e.dataModels.settings.TransformationSetting;
  const preset = CONFIG.DND5E.transformation.presets.wildshape.settings;
  const data = { preset: "wildshape" };
  for (const [key, value] of Object.entries(preset)) data[key] = value instanceof Set ? [...value] : value;
  return new Setting(data);
}

function canTransform() {
  if (game.user.isGM) return true;
  if (!game.settings.get("dnd5e", "allowPolymorphing")) {
    ui.notifications.warn(t("NeedPolymorphSetting"));
    return false;
  }
  if (!game.user.can("ACTOR_CREATE")) {
    ui.notifications.warn(t("NeedCreateActor"));
    return false;
  }
  return true;
}

/**
 * Gives every token of Aman or of his Wild Shape copies, in every scene, Aman's own
 * token back. dnd5e's revert only touches the scene on the clicking client's canvas
 * and restores the look the token had before the *first* transformation it
 * remembers, which can be an earlier animal form.
 */
async function restoreAmanTokens(aman, polyIds) {
  const base = (await aman.getTokenDocument()).toObject();
  const own = {
    name: base.name, width: base.width, height: base.height, alpha: base.alpha,
    lockRotation: base.lockRotation, texture: base.texture, ring: base.ring,
    sight: base.sight, detectionModes: base.detectionModes
  };
  const ids = new Set([aman.id, ...polyIds]);
  for (const scene of game.scenes) {
    const updates = scene.tokens
      .filter((tk) => ids.has(tk.actorId) && (tk.actorLink || tk.actorId !== aman.id))
      .map((tk) => ({
        _id: tk.id, actorId: aman.id, actorLink: true, ...foundry.utils.deepClone(own),
        "flags.dnd5e.-=previousTokenData": null, "flags.dnd5e.-=isPolymorphed": null, "flags.dnd5e.-=originalActor": null
      }));
    if (updates.length) await scene.updateEmbeddedDocuments("Token", updates);
  }
}

async function dropAnimalForm(aman) {
  const polys = polymorphsOf(aman);
  if (!polys.length) return;
  await restoreAmanTokens(aman, polys.map((p) => p.id));
  for (const poly of polys) {
    // A GM's revert also deletes the forms chained before it.
    if (!game.actors.get(poly.id)?.isPolymorphed) continue;
    await poly.revertOriginalForm({ renderSheet: false });
    // A player's revert only strips the flags; the GM deletes the leftover actor.
    if (!game.user.isGM && game.actors.get(poly.id)) {
      game.socket.emit(CHANNEL, { type: "freundebuchCleanup", actorId: poly.id });
    }
  }
}

async function becomeAnimal(aman, form) {
  const before = new Set(game.actors.map((a) => a.id));
  await aman.transformInto(form, wildShapeSettings(), { renderSheet: false });
  const created = game.actors.find((a) => !before.has(a.id) && a.getFlag("dnd5e", "originalActor") === aman.id);
  await created?.setFlag(MODULE_ID, FORM, form.id);
}

/* -------------------------------------------- */
/*  Public actions                               */
/* -------------------------------------------- */

let _busy = false;

async function guarded(fn) {
  if (_busy) return;
  _busy = true;
  try {
    await fn();
  } catch (err) {
    console.error(`${MODULE_ID} | Freundebuch:`, err);
    ui.notifications.error(t("Failed"));
  } finally {
    _busy = false;
  }
}

export function transformToAnimal(formId) {
  return guarded(async () => {
    const aman = bookOwner();
    const form = game.actors.get(formId);
    if (!aman || !form || !canTransform()) return;
    await dropDisguise(aman);
    await dropAnimalForm(aman);
    await becomeAnimal(aman, form);
  });
}

export function transformToFriend(entryId) {
  return guarded(async () => {
    const aman = bookOwner();
    const entry = getFriends().find((f) => f.id === entryId);
    if (!aman || !entry) return;
    await dropAnimalForm(aman);
    await disguiseAs(aman, entry);
  });
}

export function revert() {
  return guarded(async () => {
    const aman = bookOwner();
    if (!aman) return;
    const disguised = !!aman.getFlag(MODULE_ID, DISGUISE);
    await dropAnimalForm(aman);
    await dropDisguise(aman);
    // Also mends tokens left in an old form (e.g. after a change back in 0.48.0).
    if (!disguised) await restoreAmanTokens(aman, []);
  });
}

/* -------------------------------------------- */
/*  Socket                                       */
/* -------------------------------------------- */

export function registerFreundebuchSocket() {
  Hooks.once("ready", () => {
    game.socket.on(CHANNEL, async (data) => {
      if (data?.type !== "freundebuchCleanup" || game.users.activeGM !== game.user) return;
      const actor = game.actors.get(data.actorId);
      // Only a reverted Wild Shape copy of Aman: still points at him, no longer polymorphed.
      if (!actor || actor.isPolymorphed || actor.getFlag("dnd5e", "originalActor") !== bookOwner()?.id) return;
      await actor.delete();
    });
  });
}
