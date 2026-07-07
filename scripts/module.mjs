import { registerUnbloodedSorcery, hasUnbloodedSorcery, getResonanceValue, getResonanceMax, addResonance } from "./unblooded-sorcery.mjs";

const MODULE_ID = "fimblewood-academy";

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing Fimblewood Academy`);

  registerUnbloodedSorcery();

  game.modules.get(MODULE_ID).api = {
    id: MODULE_ID,
    unbloodedSorcery: { hasUnbloodedSorcery, getResonanceValue, getResonanceMax, addResonance }
  };
});

Hooks.once("ready", () => {
  if (game.system.id !== "dnd5e") {
    ui.notifications.warn(
      "Fimblewood Academy is built for the dnd5e system and may not function correctly with the currently active system."
    );
  }
});
