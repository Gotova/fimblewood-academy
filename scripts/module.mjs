import {
  registerUnbloodedSorcery, hasUnbloodedSorcery, getResonanceValue, getResonanceMax, addResonance, cleanupStaleResonance
} from "./unblooded-sorcery.mjs";
import { registerDrawPad, openDrawApp, openGallery } from "./draw.mjs";
import { registerJukebox, openJukeboxWindow, openJukeboxManager, diagnoseJukebox, playTrack, stopTrack } from "./jukebox.mjs";

const MODULE_ID = "fimblewood-academy";

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing Fimblewood Academy`);

  registerUnbloodedSorcery();
  registerDrawPad();
  registerJukebox();

  game.modules.get(MODULE_ID).api = {
    id: MODULE_ID,
    unbloodedSorcery: { hasUnbloodedSorcery, getResonanceValue, getResonanceMax, addResonance },
    draw: { openDrawApp, openGallery },
    jukebox: { openJukeboxWindow, openJukeboxManager, diagnoseJukebox, playTrack, stopTrack }
  };
});

Hooks.once("ready", () => {
  if (game.system.id !== "dnd5e") {
    ui.notifications.warn(
      "Fimblewood Academy is built for the dnd5e system and may not function correctly with the currently active system."
    );
  }
  if (game.modules.get("foundrydraw")?.active) {
    ui.notifications.warn(
      "Fimblewood Academy now includes its own Magic Circle Draw Pad. Disable the separate FoundryDraw module to avoid duplicate buttons and galleries."
    );
  }
  cleanupStaleResonance();
});
