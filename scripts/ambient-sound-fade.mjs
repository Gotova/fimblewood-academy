/**
 * Fimblewood Academy — Ambient Sound Fade
 *
 * Core already cross-fades an ambient sound in and out as a token walks into or
 * out of its radius, but only over 250ms, which reads as the music switching on
 * and off abruptly. This lengthens that fade to a configurable duration by
 * filling in the `fade` option whenever the sounds layer re-syncs playback
 * without asking for a specific one. Explicit fades (e.g. 0 on scene teardown)
 * are left alone.
 */

const MODULE_ID = "fimblewood-academy";
const FADE_SETTING = "ambientSoundFadeMs";

function getFadeMs() {
  return game.settings.get(MODULE_ID, FADE_SETTING);
}

/** Wraps `method` on the prototype so a missing `options.fade` becomes the configured one. */
function wrapWithDefaultFade(proto, method, optionsIndex) {
  const original = proto[method];
  if (typeof original !== "function") return false;
  proto[method] = function (...args) {
    const options = args[optionsIndex];
    if (options?.fade === undefined) args[optionsIndex] = { ...options, fade: getFadeMs() };
    return original.apply(this, args);
  };
  return true;
}

export function registerAmbientSoundFade() {
  game.settings.register(MODULE_ID, FADE_SETTING, {
    scope: "world", config: true, type: Number, default: 1500,
    range: { min: 0, max: 5000, step: 250 },
    name: "FIMBLEWOOD.AmbientSoundFade.Settings.FadeName",
    hint: "FIMBLEWOOD.AmbientSoundFade.Settings.FadeHint"
  });

  const SoundsLayer = foundry.canvas?.layers?.SoundsLayer ?? globalThis.SoundsLayer;
  if (!SoundsLayer) {
    console.warn(`${MODULE_ID} | SoundsLayer not found — ambient sound fade not applied`);
    return;
  }
  // refresh(options) is the public entry point; _syncPositions(listeners, options)
  // is where the fade is actually consumed and is also called directly by core,
  // so both are covered. Only an undefined fade is filled in, so wrapping both
  // never double-applies anything.
  wrapWithDefaultFade(SoundsLayer.prototype, "refresh", 0);
  wrapWithDefaultFade(SoundsLayer.prototype, "_syncPositions", 1);
}
