/**
 * Fimblewood Academy — Hideout Jukebox
 *
 * Players collect music tracks (Ambient Sound proximity, GM-given items, or map
 * pickups) and play any collected track together on a physical record-player prop,
 * in sync for the whole table via a module-managed Foundry Playlist.
 */

const MODULE_ID = "fimblewood-academy";
const REGISTRY_SETTING = "jukeboxRegistry";
const REWARD_SOUND_SETTING = "jukeboxRewardSound";
const JUKEBOX_PLAYLIST_NAME = "Fimblewood Hideout Jukebox";

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

function getCollectedTracks() {
  return foundry.utils.deepClone(game.user.getFlag(MODULE_ID, "collectedTracks") ?? []);
}

async function addCollectedTrack(trackId) {
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

export async function playTrack(trackId) {
  const found = findPlaylistSound(trackId);
  if (!found) return;
  await found.playlist.playSound(found.sound);
}

export async function stopTrack(trackId) {
  const found = findPlaylistSound(trackId);
  if (!found) return;
  await found.playlist.stopSound(found.sound);
}

/* -------------------------------------------- */
/*  Ambient Sound proximity → auto-collect       */
/* -------------------------------------------- */

async function checkAmbientSoundProximity() {
  if (game.user.isGM || !canvas.ready) return;
  const ownedTokens = canvas.tokens.placeables.filter(t => t.actor?.isOwner);
  if (!ownedTokens.length) return;
  for (const sound of canvas.scene.sounds) {
    const trackId = sound.getFlag(MODULE_ID, "trackId");
    if (!trackId) continue;
    const inRange = ownedTokens.some(t => {
      try {
        const { distance } = canvas.grid.measurePath([t.center, { x: sound.x, y: sound.y }]);
        return distance <= sound.radius;
      } catch (err) {
        return false;
      }
    });
    if (inRange && await addCollectedTrack(trackId)) announceTrackCollected(trackId);
  }
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
  const pickupTrackId = token.document.getFlag(MODULE_ID, "recordPickup");
  if (pickupTrackId) {
    token.release();
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
/*  "Name this new track" dialog                 */
/* -------------------------------------------- */

async function promptNewTrack() {
  const i18n = (k) => game.i18n.localize(`FIMBLEWOOD.Jukebox.${k}`);
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: i18n("NewTrackDialog.Title") },
    content: `
      <div style="display:flex;flex-direction:column;gap:8px;">
        <label>${i18n("NewTrackDialog.NameLabel")}
          <input type="text" name="name" required>
        </label>
        <label>${i18n("NewTrackDialog.AudioLabel")}
          <file-picker name="path" type="audio" required></file-picker>
        </label>
        <label>${i18n("NewTrackDialog.ArtLabel")}
          <file-picker name="img" type="image"></file-picker>
        </label>
      </div>`,
    buttons: [
      {
        action: "ok", label: i18n("NewTrackDialog.Confirm"), default: true, type: "button",
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
  const data = await promptNewTrack();
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
  if (!game.user.isGM) return;
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
  static #ACTIONS = { play: "_onPlay", stop: "_onStop", rename: "_onRename", delete: "_onDelete" };

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
        const art = track.img
          ? `<img class="fw-jukebox-track-art" src="${track.img}" alt="">`
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
    this._soundUpdateHandler ??= () => this.render();
    Hooks.on("updatePlaylistSound", this._soundUpdateHandler);
  }

  async close(options) {
    if (this._soundUpdateHandler) Hooks.off("updatePlaylistSound", this._soundUpdateHandler);
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
/*  Registration                                 */
/* -------------------------------------------- */

export function registerJukebox() {
  game.settings.register(MODULE_ID, REGISTRY_SETTING, {
    scope: "world", config: false, type: Object, default: {}
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

  Hooks.on("canvasReady", () => checkAmbientSoundProximity());
  Hooks.on("updateToken", (tokenDoc, changes) => {
    if (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)) forceJukeboxTokenOwnership(tokenDoc);
    if ("x" in changes || "y" in changes || "elevation" in changes) checkAmbientSoundProximity();
  });
  Hooks.on("createToken", (tokenDoc) => forceJukeboxTokenOwnership(tokenDoc));
  Hooks.on("controlToken", onControlToken);
  Hooks.on("createItem", onCreateItem);

  Hooks.on("renderAmbientSoundConfig", injectAmbientSoundTrackPicker);
  Hooks.on("renderItemSheet5e", injectItemTrackPicker);
  Hooks.on("renderTokenConfig", injectTokenTrackPicker);
}
