/**
 * Fimblewood Academy — Scene Music
 *
 * Every scene can name a Jukebox track as its main music, heard by everyone
 * viewing the scene whether or not they have a token on it. A "Replace Music"
 * Region Behavior swaps that for another Jukebox track while one of a client's
 * listener tokens stands inside the region. The playback itself is the
 * Jukebox's local player (see refreshLocalJukebox in jukebox.mjs), which decides
 * between region, record player and scene music.
 */

import { buildTrackPickerHtml, getRegistry, handleTrackPickerChange, refreshLocalJukeboxThrottled } from "./jukebox.mjs";

const MODULE_ID = "fimblewood-academy";
const BEHAVIOR_TYPE = `${MODULE_ID}.replaceMusic`;
const SCENE_TRACK_FLAG = "musicTrackId";

const i18n = (key) => game.i18n.localize(`FIMBLEWOOD.SceneMusic.${key}`);

/** Registered Jukebox tracks as select choices, sorted by name. */
function trackChoices() {
  const entries = Object.entries(getRegistry()).sort(([, a], [, b]) => a.name.localeCompare(b.name));
  return Object.fromEntries(entries.map(([id, track]) => [id, track.name]));
}

class ReplaceMusicBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
  static LOCALIZATION_PREFIXES = ["FIMBLEWOOD.SceneMusic.Region"];

  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      track: new fields.StringField({ required: true, blank: true, choices: trackChoices })
    };
  }
}

/* -------------------------------------------- */

/** The Jukebox track a scene plays as its main music, if any. */
export function getSceneTrackId(scene) {
  return scene?.getFlag(MODULE_ID, SCENE_TRACK_FLAG) || null;
}

/**
 * The track of the first enabled "Replace Music" behavior whose region contains
 * one of the given points ({x, y, elevation}), if any.
 */
export function getRegionTrackId(scene, points) {
  if (!scene || !points.length) return null;
  for (const region of scene.regions) {
    for (const behavior of region.behaviors) {
      if (behavior.type !== BEHAVIOR_TYPE || behavior.disabled || !behavior.system.track) continue;
      if (points.some(p => region.testPoint(p))) return behavior.system.track;
    }
  }
  return null;
}

/* -------------------------------------------- */

/** Adds the main-music picker to the basic subtab of the scene's Ambience tab. */
function injectSceneMusicPicker(app, html) {
  if (!game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html[0];
  const tab = root?.querySelector('.tab[data-group="ambience"][data-tab="basic"]');
  if (!tab || tab.querySelector(".fimblewood-scene-music-field")) return; // guard against AppV2 partial re-renders

  const scene = app.document;
  const wrap = document.createElement("fieldset");
  wrap.className = "fimblewood-scene-music-field";
  wrap.innerHTML = `
    <legend>${i18n("Scene.Legend")}</legend>
    <div class="form-group">
      <label>${i18n("Scene.TrackLabel")}</label>
      <div class="form-fields">${buildTrackPickerHtml(getSceneTrackId(scene) ?? "")}</div>
      <p class="hint">${i18n("Scene.TrackHint")}</p>
    </div>`;
  tab.appendChild(wrap);

  // No name attribute, so core's own form submit ignores it; saved as a flag here.
  wrap.querySelector("select").addEventListener("change", (event) => {
    handleTrackPickerChange(event.currentTarget, async (trackId) => {
      if (trackId) await scene.setFlag(MODULE_ID, SCENE_TRACK_FLAG, trackId);
      else await scene.unsetFlag(MODULE_ID, SCENE_TRACK_FLAG);
    });
  });
}

/* -------------------------------------------- */

export function registerSceneMusic() {
  CONFIG.RegionBehavior.dataModels[BEHAVIOR_TYPE] = ReplaceMusicBehaviorType;
  CONFIG.RegionBehavior.typeLabels[BEHAVIOR_TYPE] = "FIMBLEWOOD.SceneMusic.Region.Label";
  CONFIG.RegionBehavior.typeIcons[BEHAVIOR_TYPE] = "fa-solid fa-music";

  Hooks.on("renderSceneConfig", injectSceneMusicPicker);

  // Re-decide what this client hears whenever the music it could hear changes.
  Hooks.on("updateScene", (scene, changes) => {
    if (scene === canvas.scene && foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)) refreshLocalJukeboxThrottled();
  });
  for (const hook of ["createRegion", "updateRegion", "deleteRegion",
    "createRegionBehavior", "updateRegionBehavior", "deleteRegionBehavior"]) {
    Hooks.on(hook, () => refreshLocalJukeboxThrottled());
  }
}
