/**
 * Fimblewood Academy — Simpler Quests compatibility
 *
 * Mythic's Simpler Quests stores its "Tracker Display Style" per browser and
 * defaults to "sidebar", a mode whose tracker class it no longer defines: on a
 * client that never picked a style, its ready hook throws and no tracker is
 * shown. Players rarely open module settings, so they never see the quests.
 * Before that ready hook runs, a client still on "sidebar" is switched to
 * "docked". A style the user picked themselves (docked or floating) is kept.
 */

const SQ_ID = "simpler-quests";
const STYLE_KEY = "trackerDisplayStyle";

export function registerSimplerQuestsCompat() {
  // setup runs after every module's init, so the setting is registered by now.
  Hooks.once("setup", () => {
    if (!game.modules.get(SQ_ID)?.active) return;
    if (!game.settings.settings.has(`${SQ_ID}.${STYLE_KEY}`)) return;
    if (game.settings.get(SQ_ID, STYLE_KEY) !== "sidebar") return;
    // Client settings are written to localStorage synchronously.
    game.settings.set(SQ_ID, STYLE_KEY, "docked");
    console.log("fimblewood-academy | Simpler Quests tracker switched from the broken sidebar style to docked");
  });
}
