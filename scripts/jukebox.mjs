/**
 * Fimblewood Academy — Hideout Jukebox
 *
 * Players collect music tracks (Ambient Sound proximity, GM-given items, or map
 * pickups) and play any collected track together on a physical record-player prop,
 * in sync for the whole table via a module-managed Foundry Playlist.
 */

import { CONTROL_GROUP } from "./draw.mjs";

const MODULE_ID = "fimblewood-academy";
const REGISTRY_SETTING = "jukeboxRegistry";
const REWARD_SOUND_SETTING = "jukeboxRewardSound";
const COLLECTION_ENABLED_SETTING = "jukeboxCollectionEnabled";
const JUKEBOX_PLAYLIST_NAME = "Fimblewood Hideout Jukebox";

/** Escapes a value for interpolation into the hand-built HTML strings below. */
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

/* -------------------------------------------- */
/*  Track registry (GM-authored, world-shared)   */
/* -------------------------------------------- */

function getRegistry() {
  return foundry.utils.deepClone(game.settings.get(MODULE_ID, REGISTRY_SETTING));
}

async function setRegistry(registry) {
  if (!game.user.isGM) return;
  await game.settings.set(MODULE_ID, REGISTRY_SETTING, registry);
}

async function ensureTrackRegistered(trackId, { name, path, img }) {
  if (!game.user.isGM) return;
  const registry = getRegistry();
  registry[trackId] = { ...registry[trackId], name, path, img: img || "" };
  await setRegistry(registry);
}

async function removeTrackFromRegistry(trackId) {
  if (!game.user.isGM) return;
  const registry = getRegistry();
  delete registry[trackId];
  await setRegistry(registry);
}

/* -------------------------------------------- */
/*  Per-user collected-tracks flag               */
/* -------------------------------------------- */

/**
 * Master switch for in-world collecting. While off, none of the player-facing
 * sources (ambient-sound proximity, map pickups, item grants) hand out records —
 * only the GM's manual toggles in the manager can change collection state.
 */
function isCollectionEnabled() {
  return game.settings.get(MODULE_ID, COLLECTION_ENABLED_SETTING) !== false;
}

function getCollectedTracks() {
  return foundry.utils.deepClone(game.user.getFlag(MODULE_ID, "collectedTracks") ?? []);
}

async function addCollectedTrack(trackId) {
  if (!isCollectionEnabled()) return false;
  const list = getCollectedTracks();
  if (list.includes(trackId)) return false;
  list.push(trackId);
  await game.user.setFlag(MODULE_ID, "collectedTracks", list);
  return true;
}

function getPartyCollectedTrackIds() {
  const ids = new Set();
  for (const u of game.users.contents) {
    for (const id of (u.getFlag(MODULE_ID, "collectedTracks") ?? [])) ids.add(id);
  }
  return ids;
}

/**
 * GM override of the party's collection state for one track: granting writes the
 * track onto every non-GM user (the same audience an item grant reaches), while
 * revoking clears it from every user — GMs included — so the track really does
 * vanish from `getPartyCollectedTrackIds`.
 */
async function setTrackCollectedForParty(trackId, collected) {
  if (!game.user.isGM) return;
  const targets = collected ? game.users.filter(u => !u.isGM) : game.users.contents;
  for (const u of targets) {
    const list = foundry.utils.deepClone(u.getFlag(MODULE_ID, "collectedTracks") ?? []);
    const has = list.includes(trackId);
    if (collected === has) continue;
    const next = collected ? [...list, trackId] : list.filter(id => id !== trackId);
    await u.setFlag(MODULE_ID, "collectedTracks", next);
  }
}

async function setAllTracksCollectedForParty(collected) {
  if (!game.user.isGM) return;
  for (const trackId of Object.keys(getRegistry())) {
    await setTrackCollectedForParty(trackId, collected);
  }
}

/* -------------------------------------------- */
/*  Party-wide collection announcement           */
/* -------------------------------------------- */

function showCollectionBanner(name) {
  ui.notifications.info(game.i18n.format("FIMBLEWOOD.Jukebox.Notify.Broadcast", { name }));
  const sfx = game.settings.get(MODULE_ID, REWARD_SOUND_SETTING);
  if (sfx) {
    foundry.audio.AudioHelper.play({ src: sfx, volume: 0.8, autoplay: true, loop: false });
  }
}

function announceTrackCollected(trackId) {
  const name = getRegistry()[trackId]?.name ?? trackId;
  showCollectionBanner(name);
  game.socket.emit(`module.${MODULE_ID}`, { type: "trackCollected", name });
}

/* -------------------------------------------- */
/*  Module-managed Playlist                      */
/* -------------------------------------------- */

function findJukeboxPlaylist() {
  return game.playlists?.find(p => p.getFlag(MODULE_ID, "isJukeboxPlaylist")) ?? null;
}

async function ensureJukeboxPlaylist() {
  if (!game.user.isGM) return;
  let playlist = findJukeboxPlaylist();
  if (!playlist) {
    playlist = await Playlist.create({
      name: JUKEBOX_PLAYLIST_NAME,
      mode: CONST.PLAYLIST_MODES.SOUNDBOARD,
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
      flags: { [MODULE_ID]: { isJukeboxPlaylist: true } }
    });
  }
  await syncPlaylistWithRegistry(playlist);
}

async function syncPlaylistWithRegistry(playlist = findJukeboxPlaylist()) {
  if (!game.user.isGM || !playlist) return;
  const registry = getRegistry();
  const soundByTrackId = new Map(
    playlist.sounds.map(s => [s.getFlag(MODULE_ID, "trackId"), s]).filter(([id]) => id)
  );

  const toCreate = [];
  for (const [trackId, track] of Object.entries(registry)) {
    const existing = soundByTrackId.get(trackId);
    if (!existing) {
      toCreate.push({
        name: track.name, path: track.path, repeat: true,
        flags: { [MODULE_ID]: { trackId } }
      });
    } else if (existing.name !== track.name || existing.path !== track.path) {
      await existing.update({ name: track.name, path: track.path });
    }
  }
  if (toCreate.length) await playlist.createEmbeddedDocuments("PlaylistSound", toCreate);

  const toDelete = playlist.sounds
    .filter(s => {
      const trackId = s.getFlag(MODULE_ID, "trackId");
      return trackId && !(trackId in registry);
    })
    .map(s => s.id);
  if (toDelete.length) await playlist.deleteEmbeddedDocuments("PlaylistSound", toDelete);
}

function findPlaylistSound(trackId) {
  const playlist = findJukeboxPlaylist();
  const sound = playlist?.sounds.find(s => s.getFlag(MODULE_ID, "trackId") === trackId);
  return sound ? { playlist, sound } : null;
}

/* -------------------------------------------- */
/*  Scene-scoped audibility                      */
/* -------------------------------------------- */

/** True if this scene has the record-player prop standing on it. */
function isJukeboxScene(scene) {
  return !!scene?.tokens.some(t => t.getFlag(MODULE_ID, "recordPlayer"));
}

function anySceneHasJukebox() {
  return game.scenes.some(s => isJukeboxScene(s));
}

/**
 * Keeps the jukebox audible only on the scene its prop stands on, per client:
 * playback stays shared and in sync (the Playlist is untouched), but each client
 * silences it locally while looking at a different scene. Walk out of the hideout
 * and the music stops for you; walk back and you rejoin the song already in
 * progress, while everyone still in the hideout keeps hearing it throughout.
 */
function applyJukeboxSceneAudio() {
  const playlist = findJukeboxPlaylist();
  if (!playlist) return;
  // Before the prop is placed anywhere there is no hideout to be scoped to, so
  // muting every scene would just make the jukebox silent everywhere.
  const audible = !anySceneHasJukebox() || isJukeboxScene(canvas.scene);
  for (const playlistSound of playlist.sounds) {
    if (!playlistSound.getFlag(MODULE_ID, "trackId")) continue;
    const sound = playlistSound.sound;
    if (!sound?.playing) continue;
    const target = audible ? (playlistSound.effectiveVolume ?? playlistSound.volume ?? 1) : 0;
    if (sound.volume === target) continue;
    if (typeof sound.fade === "function") sound.fade(target, { duration: 400 });
    else sound.volume = target;
  }
}

/**
 * A sound that has only just been told to play may not have its audio buffer yet,
 * and there is nothing to set a volume on until it does — so the mute is applied
 * again shortly after, once playback has actually started.
 */
function applyJukeboxSceneAudioSoon() {
  applyJukeboxSceneAudio();
  setTimeout(applyJukeboxSceneAudio, 300);
}

/**
 * True from the moment a scene starts loading until shortly after it finishes
 * drawing. Foundry can auto-control a token during this window — most notably
 * the lone token a user owns on a scene, which is exactly what the record-player
 * prop and record pickups become once their actor's ownership is opened up to
 * every player — with no click involved, so onControlToken uses this to tell
 * that apart from a real one.
 */
let _canvasSettling = false;

export async function playTrack(trackId) {
  const found = findPlaylistSound(trackId);
  if (!found) return;
  await found.playlist.playSound(found.sound);
  applyJukeboxSceneAudioSoon();
}

function isCanvasSettling() {
  return _canvasSettling;
}

export async function stopTrack(trackId) {
  const found = findPlaylistSound(trackId);
  if (!found) return;
  await found.playlist.stopSound(found.sound);
}

/* -------------------------------------------- */
/*  Ambient Sound proximity → auto-collect       */
/* -------------------------------------------- */

/**
 * Distance in grid units between a token and an ambient sound. Measured from the
 * token *document's* position rather than the placeable's, so a check that runs
 * from the updateToken hook sees where the token just landed and not where its
 * animation currently is.
 */
function distanceToSound(tokenDoc, sound) {
  const gridSize = canvas.grid.size;
  const center = {
    x: tokenDoc.x + (tokenDoc.width * gridSize) / 2,
    y: tokenDoc.y + (tokenDoc.height * gridSize) / 2
  };
  return canvas.grid.measurePath([center, { x: sound.x, y: sound.y }]).distance;
}

async function checkAmbientSoundProximity() {
  if (game.user.isGM || !canvas.ready || !isCollectionEnabled()) return;
  const ownedTokens = canvas.tokens.placeables.filter(t => t.actor?.isOwner);
  if (!ownedTokens.length) return;
  for (const sound of canvas.scene.sounds) {
    const trackId = sound.getFlag(MODULE_ID, "trackId");
    if (!trackId) continue;
    const inRange = ownedTokens.some(t => {
      try {
        return distanceToSound(t.document, sound) <= sound.radius;
      } catch (err) {
        // Swallowing this silently would leave proximity collection permanently
        // dead with no clue as to why, so it gets logged every time.
        console.error(`${MODULE_ID} | Jukebox proximity measurement failed:`, err);
        return false;
      }
    });
    if (inRange && await addCollectedTrack(trackId)) announceTrackCollected(trackId);
  }
}

/**
 * Reports, for the client it runs on, every reason proximity collection could be
 * failing: the master switch, whether this client owns a token on the canvas, and
 * for each tagged ambient sound its radius against the measured distance. Exposed
 * on the module API because the collection paths are deliberately silent — there
 * is otherwise nothing to look at when a record doesn't drop.
 */
export function diagnoseJukebox() {
  const registry = getRegistry();
  const report = {
    user: game.user.name,
    isGM: game.user.isGM,
    collectingEnabled: isCollectionEnabled(),
    note: game.user.isGM ? "GM clients never auto-collect — run this as a player." : "",
    registeredTracks: Object.keys(registry).length,
    jukeboxScenes: game.scenes.filter(s => isJukeboxScene(s)).map(s => s.name),
    viewingJukeboxScene: canvas.ready ? isJukeboxScene(canvas.scene) : "canvas not ready",
    myCollectedTracks: getCollectedTracks().map(id => registry[id]?.name ?? `${id} (not in registry)`),
    ownedTokensOnCanvas: canvas.ready
      ? canvas.tokens.placeables.filter(t => t.actor?.isOwner).map(t => t.name)
      : "canvas not ready",
    taggedSounds: []
  };

  if (canvas.ready) {
    const ownedTokens = canvas.tokens.placeables.filter(t => t.actor?.isOwner);
    for (const sound of canvas.scene.sounds) {
      const trackId = sound.getFlag(MODULE_ID, "trackId");
      if (!trackId) continue;
      report.taggedSounds.push({
        track: registry[trackId]?.name ?? `${trackId} (NOT IN REGISTRY)`,
        radius: sound.radius,
        alreadyCollected: getCollectedTracks().includes(trackId),
        distances: ownedTokens.map(t => {
          try {
            return `${t.name}: ${distanceToSound(t.document, sound).toFixed(1)}`;
          } catch (err) {
            return `${t.name}: MEASUREMENT FAILED (${err.message})`;
          }
        })
      });
    }
  }

  console.log(`${MODULE_ID} | Jukebox diagnostics`, report);
  return report;
}

/* -------------------------------------------- */
/*  Token flags: pickups + the record-player prop */
/* -------------------------------------------- */

async function forceJukeboxTokenOwnership(tokenDoc) {
  if (!game.user.isGM) return;
  const flags = tokenDoc.flags?.[MODULE_ID];
  if (!flags?.recordPickup && !flags?.recordPlayer) return;
  // TokenDocument has no ownership field of its own — control permission is
  // inherited entirely from the Actor it represents (linked or unlinked), so
  // the grant has to land on the actor, not the token.
  const actor = tokenDoc.actor;
  if (!actor) return;
  if (actor.ownership?.default === CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER) return;
  await actor.update({ "ownership.default": CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER });
}

/**
 * One-time catch-up for tokens that got a recordPickup/recordPlayer flag before
 * a fix to forceJukeboxTokenOwnership (or before this feature existed at all) —
 * re-applies the ownership grant across every scene without requiring the GM to
 * re-toggle each token's config by hand.
 */
async function reapplyJukeboxTokenOwnership() {
  if (!game.user.isGM) return;
  for (const scene of game.scenes) {
    for (const tokenDoc of scene.tokens) {
      const flags = tokenDoc.flags?.[MODULE_ID];
      if (flags?.recordPickup || flags?.recordPlayer) await forceJukeboxTokenOwnership(tokenDoc);
    }
  }
}

async function onControlToken(token, controlled) {
  if (!controlled) return;
  // Foundry auto-controls a lone owned token while the canvas is still settling
  // in (e.g. right after login/scene load, before the player has clicked
  // anything) — see isCanvasSettling(). Both the pickup and record-player flags
  // read "controlled" as a stand-in for a deliberate click, so an auto-control
  // here must be ignored rather than treated as one.
  if (isCanvasSettling()) {
    token.release();
    return;
  }
  const pickupTrackId = token.document.getFlag(MODULE_ID, "recordPickup");
  if (pickupTrackId) {
    token.release();
    // Collecting is switched off: leave the pickup sitting on the map untouched
    // so it is still there once the GM opens collecting back up.
    if (!isCollectionEnabled()) return;
    if (await addCollectedTrack(pickupTrackId)) announceTrackCollected(pickupTrackId);
    try {
      await token.document.delete();
    } catch (err) {
      console.warn(`${MODULE_ID} | Couldn't delete collected record pickup token:`, err);
    }
    return;
  }
  if (token.document.getFlag(MODULE_ID, "recordPlayer")) {
    token.release();
    openJukeboxWindow();
  }
}

/* -------------------------------------------- */
/*  Track details dialog (create + edit)         */
/* -------------------------------------------- */

/**
 * Prompts for a track's name, audio file and cover art. Used both for creating a
 * brand new track (no `track`) and for editing an existing one, so the fields the
 * GM sees when adding a record are exactly the ones they can change later.
 */
async function promptTrackDetails(track = null) {
  const i18n = (k) => game.i18n.localize(`FIMBLEWOOD.Jukebox.${k}`);
  const editing = !!track;
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: i18n(editing ? "EditTrackDialog.Title" : "NewTrackDialog.Title") },
    content: `
      <div style="display:flex;flex-direction:column;gap:8px;">
        <label>${i18n("NewTrackDialog.NameLabel")}
          <input type="text" name="name" value="${esc(track?.name ?? "")}" required>
        </label>
        <label>${i18n("NewTrackDialog.AudioLabel")}
          <file-picker name="path" type="audio" value="${esc(track?.path ?? "")}" required></file-picker>
        </label>
        <label>${i18n("NewTrackDialog.ArtLabel")}
          <file-picker name="img" type="image" value="${esc(track?.img ?? "")}"></file-picker>
        </label>
      </div>`,
    buttons: [
      {
        action: "ok",
        label: i18n(editing ? "EditTrackDialog.Confirm" : "NewTrackDialog.Confirm"),
        default: true, type: "button",
        callback: (event, button) => {
          const form = button.form;
          const name = form.elements.name.value?.trim();
          const path = form.elements.path.value?.trim();
          const img = form.elements.img.value?.trim();
          if (!name || !path) return false;
          return { name, path, img };
        }
      },
      { action: "cancel", label: i18n("NewTrackDialog.Cancel"), type: "button", callback: () => false }
    ],
    rejectClose: false
  });
  return result || null;
}

/**
 * Shared entry point for every config-sheet track picker: resolves an existing
 * trackId unchanged, or — when the "create new" option was chosen — prompts for a
 * new track, registers it, and syncs the managed Playlist.
 */
async function resolveOrCreateTrackId(selectedValue) {
  if (!game.user.isGM) return null;
  if (selectedValue !== "__new__") return selectedValue || null;
  const data = await promptTrackDetails();
  if (!data) return null;
  const trackId = foundry.utils.randomID();
  await ensureTrackRegistered(trackId, data);
  await syncPlaylistWithRegistry();
  return trackId;
}

/* -------------------------------------------- */
/*  Config-sheet injections                      */
/* -------------------------------------------- */

function buildTrackPickerHtml(selectedTrackId, { includeNone = true } = {}) {
  const i18n = (k) => game.i18n.localize(`FIMBLEWOOD.Jukebox.${k}`);
  const registry = getRegistry();
  const options = Object.entries(registry)
    .map(([id, t]) => `<option value="${id}" ${id === selectedTrackId ? "selected" : ""}>${t.name}</option>`)
    .join("");
  const noneOption = includeNone
    ? `<option value="" ${!selectedTrackId ? "selected" : ""}>${i18n("SourceConfig.TrackNone")}</option>`
    : "";
  return `<select class="fw-jukebox-track-picker">${noneOption}${options}<option value="__new__">${i18n("SourceConfig.TrackNew")}</option></select>`;
}

async function handleTrackPickerChange(select, onResolved) {
  const value = select.value;
  if (value === "__new__") {
    const trackId = await resolveOrCreateTrackId("__new__");
    if (!trackId) { select.value = ""; return; }
    await onResolved(trackId);
  } else {
    await onResolved(value || null);
  }
}

function injectAmbientSoundTrackPicker(app, html) {
  if (!game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html[0];
  if (!root || root.querySelector(".fimblewood-jukebox-source-field")) return; // guard against AppV2 partial re-renders

  const currentTrackId = app.document.getFlag(MODULE_ID, "trackId") ?? "";
  const i18n = (k) => game.i18n.localize(`FIMBLEWOOD.Jukebox.${k}`);
  const wrap = document.createElement("fieldset");
  wrap.className = "fimblewood-jukebox-source-field";
  wrap.innerHTML = `<legend>${i18n("SourceConfig.TrackLabel")}</legend>${buildTrackPickerHtml(currentTrackId)}`;
  root.querySelector("form")?.appendChild(wrap) ?? root.appendChild(wrap);

  wrap.querySelector("select").addEventListener("change", (event) => {
    handleTrackPickerChange(event.currentTarget, async (trackId) => {
      if (trackId) await app.document.setFlag(MODULE_ID, "trackId", trackId);
      else await app.document.unsetFlag(MODULE_ID, "trackId");
    });
  });
}

function injectItemTrackPicker(app, html) {
  if (!game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html[0];
  if (!root || root.querySelector(".fimblewood-jukebox-source-field")) return;

  const item = app.document ?? app.item;
  const currentTrackId = item?.getFlag(MODULE_ID, "recordTrackId") ?? "";
  const i18n = (k) => game.i18n.localize(`FIMBLEWOOD.Jukebox.${k}`);

  const wrap = document.createElement("fieldset");
  wrap.className = "fimblewood-jukebox-source-field";
  wrap.innerHTML = `
    <legend>${i18n("SourceConfig.ItemGrantsTrack")}</legend>
    <label><input type="checkbox" class="fw-jukebox-item-toggle" ${currentTrackId ? "checked" : ""}> ${i18n("SourceConfig.ItemGrantsTrack")}</label>
    <div class="fw-jukebox-item-picker" style="display:${currentTrackId ? "block" : "none"}">
      ${buildTrackPickerHtml(currentTrackId, { includeNone: false })}
    </div>`;
  root.querySelector("form")?.appendChild(wrap) ?? root.appendChild(wrap);

  const pickerWrap = wrap.querySelector(".fw-jukebox-item-picker");
  wrap.querySelector(".fw-jukebox-item-toggle").addEventListener("change", async (event) => {
    if (event.currentTarget.checked) {
      pickerWrap.style.display = "block";
    } else {
      pickerWrap.style.display = "none";
      await item.unsetFlag(MODULE_ID, "recordTrackId");
    }
  });
  wrap.querySelector("select").addEventListener("change", (event) => {
    handleTrackPickerChange(event.currentTarget, async (trackId) => {
      if (trackId) await item.setFlag(MODULE_ID, "recordTrackId", trackId);
      else await item.unsetFlag(MODULE_ID, "recordTrackId");
    });
  });
}

function injectTokenTrackPicker(app, html) {
  if (!game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html[0];
  if (!root || root.querySelector(".fimblewood-jukebox-source-field")) return;

  const tokenDoc = app.document ?? app.token;
  const currentPickup = tokenDoc?.getFlag(MODULE_ID, "recordPickup") ?? "";
  const isPlayer = !!tokenDoc?.getFlag(MODULE_ID, "recordPlayer");
  const i18n = (k) => game.i18n.localize(`FIMBLEWOOD.Jukebox.${k}`);

  const wrap = document.createElement("fieldset");
  wrap.className = "fimblewood-jukebox-source-field";
  wrap.innerHTML = `
    <legend>${game.i18n.localize("FIMBLEWOOD.ModuleTitle")}</legend>
    <label><input type="radio" name="fw-jukebox-role" value="pickup" ${currentPickup ? "checked" : ""}> ${i18n("SourceConfig.TokenIsPickup")}</label>
    <div class="fw-jukebox-pickup-picker" style="display:${currentPickup ? "block" : "none"}">
      ${buildTrackPickerHtml(currentPickup, { includeNone: false })}
    </div>
    <label><input type="radio" name="fw-jukebox-role" value="player" ${isPlayer ? "checked" : ""}> ${i18n("SourceConfig.TokenIsPlayer")}</label>
    <label><input type="radio" name="fw-jukebox-role" value="none" ${!currentPickup && !isPlayer ? "checked" : ""}> ${i18n("SourceConfig.TrackNone")}</label>`;
  root.querySelector("form")?.appendChild(wrap) ?? root.appendChild(wrap);

  const pickerWrap = wrap.querySelector(".fw-jukebox-pickup-picker");
  const radios = wrap.querySelectorAll('input[name="fw-jukebox-role"]');
  for (const radio of radios) {
    radio.addEventListener("change", async (event) => {
      const value = event.currentTarget.value;
      pickerWrap.style.display = value === "pickup" ? "block" : "none";
      if (value === "player") {
        await tokenDoc.update({ [`flags.${MODULE_ID}.recordPlayer`]: true, [`flags.${MODULE_ID}.-=recordPickup`]: null });
      } else if (value === "none") {
        await tokenDoc.update({ [`flags.${MODULE_ID}.-=recordPlayer`]: null, [`flags.${MODULE_ID}.-=recordPickup`]: null });
      }
    });
  }
  wrap.querySelector("select").addEventListener("change", (event) => {
    handleTrackPickerChange(event.currentTarget, async (trackId) => {
      if (!trackId) return;
      await tokenDoc.update({ [`flags.${MODULE_ID}.recordPickup`]: trackId, [`flags.${MODULE_ID}.-=recordPlayer`]: null });
    });
  });
}

/* -------------------------------------------- */
/*  Item-based grant                             */
/* -------------------------------------------- */

async function onCreateItem(item) {
  if (!game.user.isGM || !isCollectionEnabled()) return;
  const trackId = item.getFlag(MODULE_ID, "recordTrackId");
  if (!trackId || !item.actor?.hasPlayerOwner) return;
  let anyNew = false;
  for (const u of game.users.filter(u => !u.isGM)) {
    const list = foundry.utils.deepClone(u.getFlag(MODULE_ID, "collectedTracks") ?? []);
    if (!list.includes(trackId)) {
      list.push(trackId);
      await u.setFlag(MODULE_ID, "collectedTracks", list);
      anyNew = true;
    }
  }
  if (anyNew) announceTrackCollected(trackId);
}

/* -------------------------------------------- */
/*  Jukebox window                               */
/* -------------------------------------------- */

class JukeboxApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "fimblewood-jukebox",
    tag: "div",
    window: { title: "FIMBLEWOOD.Jukebox.WindowTitle", icon: "fas fa-record-vinyl" },
    position: { width: 480, height: 560 },
    classes: ["fimblewood-jukebox-app"]
  };

  // action name -> instance method. Dispatched manually (see _replaceHTML) rather
  // than via DEFAULT_OPTIONS.actions/data-action, which did not reliably fire.
  static #ACTIONS = { play: "_onPlay", stop: "_onStop", art: "_onShowArt", rename: "_onRename", delete: "_onDelete" };

  async _renderHTML() {
    const i18n = (k) => game.i18n.localize(`FIMBLEWOOD.Jukebox.${k}`);
    const registry = getRegistry();
    const trackIds = [...getPartyCollectedTrackIds()].filter(id => registry[id]);

    let rows;
    if (!trackIds.length) {
      rows = `<p class="fw-jukebox-empty">${i18n("TrackList.Empty")}</p>`;
    } else {
      const playlist = findJukeboxPlaylist();
      rows = trackIds.map(id => {
        const track = registry[id];
        const sound = playlist?.sounds.find(s => s.getFlag(MODULE_ID, "trackId") === id);
        const isPlaying = !!sound?.playing;
        // Only real cover art is clickable — the fallback vinyl icon has nothing
        // worth blowing up to full size.
        const art = track.img
          ? `<img class="fw-jukebox-track-art is-clickable" src="${esc(track.img)}" alt="" data-action="art" data-track-id="${id}" title="${i18n("TrackList.ShowArt")}">`
          : `<i class="fw-jukebox-track-art fas fa-record-vinyl"></i>`;
        const gmActions = game.user.isGM ? `
          <button type="button" class="fw-jukebox-icon-btn" data-action="rename" data-track-id="${id}" title="${i18n("GM.Rename")}"><i class="fas fa-i-cursor"></i></button>
          <button type="button" class="fw-jukebox-icon-btn" data-action="delete" data-track-id="${id}" title="${i18n("GM.Delete")}"><i class="fas fa-trash"></i></button>` : "";
        return `
          <div class="fw-jukebox-track-row" data-track-id="${id}">
            ${art}
            <span class="fw-jukebox-track-name">${track.name}</span>
            <button type="button" class="fw-jukebox-icon-btn" data-action="${isPlaying ? "stop" : "play"}" data-track-id="${id}" title="${isPlaying ? i18n("TrackList.Stop") : i18n("TrackList.Play")}">
              <i class="fas fa-${isPlaying ? "stop" : "play"}"></i>
            </button>
            <div class="fw-jukebox-gm-actions">${gmActions}</div>
          </div>`;
      }).join("");
    }

    return `<div class="fw-jukebox-track-list">${rows}</div>`;
  }

  async _replaceHTML(result, content) {
    content.innerHTML = result;
    // Content is destroyed/recreated on every render (innerHTML replacement), but
    // `content` itself is the same stable node Foundry hands back each time, so a
    // delegated listener attached to it once (guarded by the dataset flag) keeps
    // catching clicks on freshly-rendered buttons via normal event bubbling.
    if (!content.dataset.fwJukeboxWired) {
      content.dataset.fwJukeboxWired = "1";
      content.addEventListener("click", (event) => {
        const target = event.target.closest("[data-action]");
        if (!target) return;
        const handlerName = JukeboxApp.#ACTIONS[target.dataset.action];
        if (handlerName) this[handlerName](event, target);
      });
    }
    return content;
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    // _onRender fires on every render, but each of these handlers calls render()
    // in turn — registering them more than once would stack duplicate listeners.
    if (this._hooksWired) return;
    this._hooksWired = true;
    this._soundUpdateHandler = () => this.render();
    Hooks.on("updatePlaylistSound", this._soundUpdateHandler);
    // Collection state lives on user flags, so a GM granting or revoking a record
    // from the manager has to redraw this list on every client that has it open.
    this._userUpdateHandler = (user, changes) => {
      if (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.collectedTracks`)) this.render();
    };
    Hooks.on("updateUser", this._userUpdateHandler);
  }

  async close(options) {
    if (this._soundUpdateHandler) Hooks.off("updatePlaylistSound", this._soundUpdateHandler);
    if (this._userUpdateHandler) Hooks.off("updateUser", this._userUpdateHandler);
    this._hooksWired = false;
    return super.close(options);
  }

  async _onPlay(event, target) {
    await playTrack(target.dataset.trackId);
    this.render();
  }

  async _onStop(event, target) {
    await stopTrack(target.dataset.trackId);
    this.render();
  }

  _onShowArt(event, target) {
    const track = getRegistry()[target.dataset.trackId];
    if (!track?.img) return;
    // shareable lets the GM push the sleeve to everyone from the popout itself.
    new ImagePopout(track.img, {
      window: { title: track.name },
      shareable: game.user.isGM
    }).render(true);
  }

  async _onRename(event, target) {
    const trackId = target.dataset.trackId;
    const i18n = (k) => game.i18n.localize(`FIMBLEWOOD.Jukebox.${k}`);
    const registry = getRegistry();
    const current = registry[trackId];
    if (!current) return;
    const newName = await foundry.applications.api.DialogV2.prompt({
      window: { title: i18n("GM.RenameTitle") },
      content: `<input type="text" name="name" value="${current.name}">`,
      ok: {
        label: i18n("GM.Confirm"),
        callback: (event, button) => button.form.elements.name.value?.trim()
      },
      rejectClose: false
    }).catch(() => null);
    if (!newName) return;
    await ensureTrackRegistered(trackId, { ...current, name: newName });
    await syncPlaylistWithRegistry();
    this.render();
  }

  async _onDelete(event, target) {
    const trackId = target.dataset.trackId;
    const i18n = (k) => game.i18n.localize(`FIMBLEWOOD.Jukebox.${k}`);
    const registry = getRegistry();
    const name = registry[trackId]?.name ?? trackId;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: i18n("GM.DeleteConfirmTitle") },
      content: `<p>${game.i18n.format("FIMBLEWOOD.Jukebox.GM.DeleteConfirmBody", { name })}</p>`,
      rejectClose: false
    });
    if (!confirmed) return;
    await removeTrackFromRegistry(trackId);
    await syncPlaylistWithRegistry();
    this.render();
  }
}

let _jukeboxInstance = null;

export function openJukeboxWindow() {
  if (!_jukeboxInstance || !_jukeboxInstance.rendered) {
    _jukeboxInstance = new JukeboxApp();
    _jukeboxInstance.render(true);
  } else {
    _jukeboxInstance.bringToTop();
  }
}

/* -------------------------------------------- */
/*  GM track manager window                      */
/* -------------------------------------------- */

/**
 * GM-only console over the whole track registry: every registered record is
 * listed whether or not the party found it, with its collection state as a
 * one-click toggle so a test run can be reset before the real session.
 */
class JukeboxManagerApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "fimblewood-jukebox-manager",
    tag: "div",
    window: { title: "FIMBLEWOOD.Jukebox.Manager.WindowTitle", icon: "fas fa-compact-disc" },
    position: { width: 620, height: 620 },
    classes: ["fimblewood-jukebox-app", "fimblewood-jukebox-manager-app"]
  };

  // Same manual dispatch as JukeboxApp — see its #ACTIONS note.
  static #ACTIONS = {
    add: "_onAdd", collectAll: "_onCollectAll", resetAll: "_onResetAll",
    toggleCollecting: "_onToggleCollecting",
    toggleCollected: "_onToggleCollected", play: "_onPlay", stop: "_onStop",
    edit: "_onEdit", delete: "_onDelete"
  };

  async _renderHTML() {
    const i18n = (k) => game.i18n.localize(`FIMBLEWOOD.Jukebox.${k}`);
    const registry = getRegistry();
    const collectedIds = getPartyCollectedTrackIds();
    const playlist = findJukeboxPlaylist();

    const entries = Object.entries(registry)
      .sort(([, a], [, b]) => (a.name ?? "").localeCompare(b.name ?? ""));
    const collectedCount = entries.filter(([id]) => collectedIds.has(id)).length;

    const rows = entries.length
      ? entries.map(([id, track]) => {
        const isCollected = collectedIds.has(id);
        const isPlaying = !!playlist?.sounds.find(s => s.getFlag(MODULE_ID, "trackId") === id)?.playing;
        const art = track.img
          ? `<img class="fw-jukebox-track-art" src="${esc(track.img)}" alt="">`
          : `<i class="fw-jukebox-track-art fas fa-record-vinyl"></i>`;
        return `
          <div class="fw-jukebox-track-row fw-jukebox-manager-row" data-track-id="${id}">
            ${art}
            <div class="fw-jukebox-manager-info">
              <span class="fw-jukebox-track-name">${esc(track.name ?? id)}</span>
              <span class="fw-jukebox-track-path">${esc(track.path || i18n("Manager.NoAudio"))}</span>
            </div>
            <button type="button" class="fw-jukebox-status-pill ${isCollected ? "is-collected" : "is-uncollected"}"
                    data-action="toggleCollected" data-track-id="${id}"
                    title="${i18n(isCollected ? "Manager.MarkUncollected" : "Manager.MarkCollected")}">
              <i class="fas fa-${isCollected ? "check" : "lock"}"></i>
              ${i18n(isCollected ? "Manager.Collected" : "Manager.Uncollected")}
            </button>
            <div class="fw-jukebox-gm-actions">
              <button type="button" class="fw-jukebox-icon-btn" data-action="${isPlaying ? "stop" : "play"}" data-track-id="${id}"
                      title="${i18n(isPlaying ? "TrackList.Stop" : "TrackList.Play")}"><i class="fas fa-${isPlaying ? "stop" : "play"}"></i></button>
              <button type="button" class="fw-jukebox-icon-btn" data-action="edit" data-track-id="${id}"
                      title="${i18n("Manager.Edit")}"><i class="fas fa-pen-to-square"></i></button>
              <button type="button" class="fw-jukebox-icon-btn" data-action="delete" data-track-id="${id}"
                      title="${i18n("GM.Delete")}"><i class="fas fa-trash"></i></button>
            </div>
          </div>`;
      }).join("")
      : `<p class="fw-jukebox-empty">${i18n("Manager.Empty")}</p>`;

    const collecting = isCollectionEnabled();
    return `
      <div class="fw-jukebox-manager-collecting ${collecting ? "is-on" : "is-off"}">
        <button type="button" class="fw-jukebox-toggle-btn" data-action="toggleCollecting"
                title="${i18n(collecting ? "Manager.CollectingDisableHint" : "Manager.CollectingEnableHint")}">
          <i class="fas fa-toggle-${collecting ? "on" : "off"}"></i>
          ${i18n(collecting ? "Manager.CollectingOn" : "Manager.CollectingOff")}
        </button>
        <span class="fw-jukebox-manager-hint">${i18n(collecting ? "Manager.CollectingOnHint" : "Manager.CollectingOffHint")}</span>
      </div>
      <div class="fw-jukebox-manager-toolbar">
        <button type="button" class="fw-jukebox-text-btn" data-action="add"><i class="fas fa-plus"></i> ${i18n("Manager.AddTrack")}</button>
        <button type="button" class="fw-jukebox-text-btn" data-action="collectAll"><i class="fas fa-check-double"></i> ${i18n("Manager.CollectAll")}</button>
        <button type="button" class="fw-jukebox-text-btn" data-action="resetAll"><i class="fas fa-rotate-left"></i> ${i18n("Manager.ResetAll")}</button>
        <span class="fw-jukebox-manager-count">${game.i18n.format("FIMBLEWOOD.Jukebox.Manager.CountSummary", { collected: collectedCount, total: entries.length })}</span>
      </div>
      <div class="fw-jukebox-track-list">${rows}</div>`;
  }

  async _replaceHTML(result, content) {
    content.innerHTML = result;
    if (!content.dataset.fwJukeboxWired) {
      content.dataset.fwJukeboxWired = "1";
      content.addEventListener("click", (event) => {
        const target = event.target.closest("[data-action]");
        if (!target) return;
        const handlerName = JukeboxManagerApp.#ACTIONS[target.dataset.action];
        if (handlerName) this[handlerName](event, target);
      });
    }
    return content;
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    if (this._hooksWired) return;
    this._hooksWired = true;
    this._refresh = () => this.render();
    Hooks.on("updatePlaylistSound", this._refresh);
    Hooks.on("updateUser", this._refresh);
  }

  async close(options) {
    if (this._refresh) {
      Hooks.off("updatePlaylistSound", this._refresh);
      Hooks.off("updateUser", this._refresh);
    }
    this._hooksWired = false;
    return super.close(options);
  }

  async _onAdd() {
    const data = await promptTrackDetails();
    if (!data) return;
    await ensureTrackRegistered(foundry.utils.randomID(), data);
    await syncPlaylistWithRegistry();
    this.render();
  }

  async _onToggleCollecting() {
    await game.settings.set(MODULE_ID, COLLECTION_ENABLED_SETTING, !isCollectionEnabled());
    this.render();
  }

  async _onCollectAll() {
    await setAllTracksCollectedForParty(true);
    this.render();
  }

  async _onResetAll() {
    const i18n = (k) => game.i18n.localize(`FIMBLEWOOD.Jukebox.${k}`);
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: i18n("Manager.ResetAllConfirmTitle") },
      content: `<p>${i18n("Manager.ResetAllConfirmBody")}</p>`,
      rejectClose: false
    });
    if (!confirmed) return;
    await setAllTracksCollectedForParty(false);
    this.render();
  }

  async _onToggleCollected(event, target) {
    const trackId = target.dataset.trackId;
    await setTrackCollectedForParty(trackId, !getPartyCollectedTrackIds().has(trackId));
    this.render();
  }

  async _onPlay(event, target) {
    await playTrack(target.dataset.trackId);
    this.render();
  }

  async _onStop(event, target) {
    await stopTrack(target.dataset.trackId);
    this.render();
  }

  async _onEdit(event, target) {
    const trackId = target.dataset.trackId;
    const current = getRegistry()[trackId];
    if (!current) return;
    const data = await promptTrackDetails(current);
    if (!data) return;
    await ensureTrackRegistered(trackId, data);
    await syncPlaylistWithRegistry();
    this.render();
  }

  async _onDelete(event, target) {
    const trackId = target.dataset.trackId;
    const i18n = (k) => game.i18n.localize(`FIMBLEWOOD.Jukebox.${k}`);
    const name = getRegistry()[trackId]?.name ?? trackId;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: i18n("GM.DeleteConfirmTitle") },
      content: `<p>${game.i18n.format("FIMBLEWOOD.Jukebox.GM.DeleteConfirmBody", { name })}</p>`,
      rejectClose: false
    });
    if (!confirmed) return;
    await setTrackCollectedForParty(trackId, false);
    await removeTrackFromRegistry(trackId);
    await syncPlaylistWithRegistry();
    this.render();
  }
}

let _jukeboxManagerInstance = null;

export function openJukeboxManager() {
  if (!game.user.isGM) return;
  if (!_jukeboxManagerInstance || !_jukeboxManagerInstance.rendered) {
    _jukeboxManagerInstance = new JukeboxManagerApp();
    _jukeboxManagerInstance.render(true);
  } else {
    _jukeboxManagerInstance.bringToTop();
  }
}

/* -------------------------------------------- */
/*  Registration                                 */
/* -------------------------------------------- */

export function registerJukebox() {
  game.settings.register(MODULE_ID, REGISTRY_SETTING, {
    scope: "world", config: false, type: Object, default: {}
  });
  game.settings.register(MODULE_ID, COLLECTION_ENABLED_SETTING, {
    scope: "world", config: true, type: Boolean, default: true,
    name: "FIMBLEWOOD.Jukebox.Settings.CollectionEnabledName",
    hint: "FIMBLEWOOD.Jukebox.Settings.CollectionEnabledHint",
    onChange: (enabled) => {
      if (_jukeboxManagerInstance?.rendered) _jukeboxManagerInstance.render();
      // Re-open collecting and a character already parked inside a tagged sound's
      // radius should get its record now, without having to walk out and back in.
      if (enabled) checkAmbientSoundProximity();
    }
  });
  game.settings.register(MODULE_ID, REWARD_SOUND_SETTING, {
    scope: "world", config: true, type: String,
    filePicker: "audio", default: "",
    name: "FIMBLEWOOD.Jukebox.Settings.RewardSoundName",
    hint: "FIMBLEWOOD.Jukebox.Settings.RewardSoundHint"
  });

  Hooks.once("ready", async () => {
    await ensureJukeboxPlaylist();
    await reapplyJukeboxTokenOwnership();
    game.socket.on(`module.${MODULE_ID}`, (data) => {
      if (data.type === "trackCollected") showCollectionBanner(data.name);
    });
  });

  // Brackets the whole scene load: canvasInit fires before layers (including
  // tokens) draw, canvasReady only once drawing is done — so any auto-control
  // Foundry performs along the way falls inside this window. The flag lingers a
  // little past canvasReady since it can take a beat for that auto-control to
  // actually land on the client.
  Hooks.on("canvasInit", () => { _canvasSettling = true; });
  Hooks.on("canvasReady", () => {
    checkAmbientSoundProximity();
    // The client just changed scene — re-decide whether the jukebox is audible here.
    applyJukeboxSceneAudioSoon();
    setTimeout(() => { _canvasSettling = false; }, 500);
  });
  // Core re-syncs a sound's volume whenever it updates (play, stop, volume
  // change), which would undo the local mute, so it is re-applied afterwards.
  Hooks.on("updatePlaylistSound", () => applyJukeboxSceneAudioSoon());
  Hooks.on("updateToken", (tokenDoc, changes) => {
    if (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)) {
      forceJukeboxTokenOwnership(tokenDoc);
      // The prop may have just been placed on, or cleared from, this scene.
      applyJukeboxSceneAudio();
    }
    if ("x" in changes || "y" in changes || "elevation" in changes) checkAmbientSoundProximity();
  });
  Hooks.on("createToken", (tokenDoc) => forceJukeboxTokenOwnership(tokenDoc));
  Hooks.on("controlToken", onControlToken);
  Hooks.on("createItem", onCreateItem);

  // Slots the GM track manager into the Fimblewood control category created by
  // registerDrawPad — which runs first at init, so the category already exists
  // by the time this listener fires.
  Hooks.on("getSceneControlButtons", (controls) => {
    // Left out of the tool list entirely for players rather than added with
    // visible:false — an invisible entry is still a real tool as far as core's
    // control activation is concerned, and there is nothing here players need.
    if (!game.user.isGM) return;
    const group = controls[CONTROL_GROUP];
    if (!group) return;
    group.tools.jukebox = {
      name: "jukebox",
      title: "FIMBLEWOOD.Jukebox.Manager.ButtonTitle",
      icon: "fas fa-compact-disc",
      button: true,
      visible: true,
      order: 2,
      onChange: () => openJukeboxManager()
    };
  });

  Hooks.on("renderAmbientSoundConfig", injectAmbientSoundTrackPicker);
  Hooks.on("renderItemSheet5e", injectItemTrackPicker);
  Hooks.on("renderTokenConfig", injectTokenTrackPicker);
}
