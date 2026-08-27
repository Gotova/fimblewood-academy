/**
 * Fimblewood Academy — Dragonchess
 *
 * Wires the Dragonchess referee (game.mjs) into the rest of the module: the
 * scene-control buttons and the public API surface. See game.mjs for the
 * rules/socket/state-machine design notes.
 */

import { CONTROL_GROUP } from "../draw.mjs";
import {
  registerDragonchess as registerDragonchessCore,
  launchDragonchess, launchPvpChallenge, openBoardForCurrentUser, getGameRecord, selftest
} from "./game.mjs";

export { openBoardForCurrentUser, getGameRecord, selftest };

export function registerDragonchess() {
  registerDragonchessCore();

  // Slots into the Fimblewood control category created by registerDrawPad
  // (which runs first at init), the same way the Jukebox does.
  Hooks.on("getSceneControlButtons", (controls) => {
    const group = controls[CONTROL_GROUP];
    if (!group) return;

    if (game.user.isGM) {
      group.tools.dragonchess = {
        name: "dragonchess",
        title: "FIMBLEWOOD.Dragonchess.ButtonTitle",
        icon: "fas fa-chess-queen",
        button: true,
        visible: true,
        order: 3,
        onChange: () => launchDragonchess()
      };
    } else {
      // Control your own token, target the opponent's, then challenge them
      // directly — no GM click required (a GM must simply be logged in
      // somewhere, since only the GM can write the shared game state).
      group.tools.dragonchessChallenge = {
        name: "dragonchessChallenge",
        title: "FIMBLEWOOD.Dragonchess.ChallengeButtonTitle",
        icon: "fas fa-chess-knight",
        button: true,
        visible: true,
        order: 3,
        onChange: () => launchPvpChallenge()
      };
      // Always present; clicking it when no game is running just explains
      // that (see game.mjs openBoardForCurrentUser).
      group.tools.dragonchessWatch = {
        name: "dragonchessWatch",
        title: "FIMBLEWOOD.Dragonchess.WatchButtonTitle",
        icon: "fas fa-eye",
        button: true,
        visible: true,
        order: 4,
        onChange: () => openBoardForCurrentUser()
      };
    }
  });
}
