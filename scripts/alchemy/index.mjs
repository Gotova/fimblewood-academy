/**
 * Fimblewood Academy — Alchemy
 *
 * Entry point: the region behavior "Alchemie-Station", the alchemy settings
 * and socket, and the "Alchemie" tool in the Fimblewood control category
 * (for everyone; without tools the window only shows the recipe book).
 *
 * The window redraws itself whenever what it shows could have changed: the
 * character's items or recipe book, a token entering or leaving a region,
 * or a station behavior being edited.
 */

import { CONTROL_GROUP } from "../draw.mjs";
import { registerStationBehavior } from "./station-behavior.mjs";
import { registerAlchemyData } from "./alchemy-data.mjs";

let _app = null;

export async function openAlchemy() {
  const { AlchemyApp } = await import("./alchemy-app.mjs");
  if (!_app || !_app.rendered) {
    _app = new AlchemyApp();
    _app.render(true);
  } else {
    _app.bringToTop();
  }
}

const refresh = foundry.utils.debounce(() => {
  if (_app?.rendered && !_app.busy) _app.render();
}, 100);

export function registerAlchemy() {
  registerStationBehavior();
  registerAlchemyData();

  Hooks.on("getSceneControlButtons", (controls) => {
    const group = controls[CONTROL_GROUP];
    if (!group) return;
    group.tools.alchemy = {
      name: "alchemy",
      title: "FIMBLEWOOD.Alchemy.ButtonTitle",
      icon: "fas fa-flask-vial",
      button: true,
      visible: true,
      order: 8,
      onChange: () => openAlchemy()
    };
  });

  for (const hook of ["createItem", "updateItem", "deleteItem", "updateActor",
    "updateToken", "createToken", "deleteToken",
    "createRegionBehavior", "updateRegionBehavior", "deleteRegionBehavior", "deleteRegion",
    "updateScene", "updateUser"]) {
    Hooks.on(hook, () => refresh());
  }
}
