/**
 * Fimblewood Academy — Ambient Sound Fade
 *
 * Core switches an ambient sound on and off almost instantly as a token walks
 * into or out of its radius: token movement refreshes the sounds layer through
 * the PerceptionManager with an explicit fade of 0 (250 for a few other
 * refreshes). This replaces the fade of every SoundsLayer#refresh with a
 * configurable duration so the music swells in and dies away instead.
 *
 * Only refresh() is wrapped, not _syncPositions: the GM's sound-preview tool
 * calls _syncPositions directly with its own short fade, which should stay
 * responsive. AmbientSound#sync is also wrapped to handle walking back in while
 * a sound is still fading out — see resumeAfterFadeOut.
 */

const MODULE_ID = "fimblewood-academy";
const FADE_SETTING = "ambientSoundFadeDuration";

/** The configured fade, also used by the jukebox for its own local playback. */
export function getAmbientFadeMs() {
  return game.settings.get(MODULE_ID, FADE_SETTING);
}

/** Sounds already waiting to resume once their current fade-out ends. */
const _pendingResume = new WeakSet();

/**
 * Core's Sound ignores play() while it is still STOPPING, so walking back into a
 * radius during a long fade-out would leave the music off until the token moved
 * again. Instead, once that fade-out has finished, the layer is refreshed so the
 * sound fades straight back in if a listener is still in range.
 */
function resumeAfterFadeOut(sound) {
  if (_pendingResume.has(sound)) return;
  _pendingResume.add(sound);
  sound.addEventListener("stop", () => {
    _pendingResume.delete(sound);
    canvas.sounds?.refresh();
  }, { once: true });
}

export function registerAmbientSoundFade() {
  game.settings.register(MODULE_ID, FADE_SETTING, {
    scope: "world", config: true, type: Number, default: 3500,
    range: { min: 0, max: 8000, step: 250 },
    name: "FIMBLEWOOD.AmbientSoundFade.Settings.FadeName",
    hint: "FIMBLEWOOD.AmbientSoundFade.Settings.FadeHint"
  });

  const SoundsLayer = foundry.canvas.layers.SoundsLayer;
  const originalRefresh = SoundsLayer.prototype.refresh;
  SoundsLayer.prototype.refresh = function (options = {}) {
    return originalRefresh.call(this, { ...options, fade: getAmbientFadeMs() });
  };

  const AmbientSound = foundry.canvas.placeables.AmbientSound;
  const originalSync = AmbientSound.prototype.sync;
  AmbientSound.prototype.sync = function (isAudible, ...rest) {
    const STOPPING = foundry.audio.Sound.STATES.STOPPING;
    if (isAudible && this.sound?._state === STOPPING) resumeAfterFadeOut(this.sound);
    return originalSync.call(this, isAudible, ...rest);
  };
}
