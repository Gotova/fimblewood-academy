/**
 * Fimblewood Academy — Amans Freundebuch
 *
 * Entry point: using the book item opens the window; the "Freundebuch" tool
 * in the Fimblewood control category opens it from anywhere (for the GM and
 * for Aman's player — in an animal form the book is not on the active
 * actor); the GM's token HUD gets a book button that adds the token's
 * character to the book.
 */

import { CONTROL_GROUP } from "../draw.mjs";
import { addFriend, canOpen, isAmanToken, isBook, registerFreundebuchSocket } from "./data.mjs";

let _app = null;
let _couldOpen = false;

export async function openFreundebuch() {
  const { FreundebuchApp } = await import("./app.mjs");
  if (!_app || !_app.rendered) {
    _app = new FreundebuchApp();
    _app.render(true);
  } else {
    _app.bringToTop();
  }
}

const refresh = foundry.utils.debounce(() => {
  if (_app?.rendered && !_app.busy) _app.render();
}, 100);

/** Show or hide the control tool when the book changes hands. */
function refreshControls() {
  const now = canOpen();
  if (now !== _couldOpen) {
    _couldOpen = now;
    ui.controls?.render({ reset: true });
  }
}

export function registerFreundebuch() {
  registerFreundebuchSocket();

  Hooks.on("getSceneControlButtons", (controls) => {
    if (!canOpen()) return;
    const group = controls[CONTROL_GROUP];
    if (!group) return;
    group.tools.freundebuch = {
      name: "freundebuch",
      title: "FIMBLEWOOD.Freundebuch.ButtonTitle",
      icon: "fas fa-book",
      button: true,
      visible: true,
      order: 10,
      onChange: () => openFreundebuch()
    };
  });

  Hooks.on("dnd5e.preUseActivity", (activity) => {
    if (!isBook(activity.item)) return;
    openFreundebuch();
    return false;
  });

  Hooks.on("renderTokenHUD", (hud, html) => {
    if (!game.user.isGM) return;
    const tokenDoc = hud.object?.document;
    if (!tokenDoc || isAmanToken(tokenDoc)) return;
    const root = html instanceof HTMLElement ? html : html[0];
    const col = root.querySelector(".col.right");
    if (!col || col.querySelector(".fw-fb-hud")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "control-icon fw-fb-hud";
    btn.dataset.tooltip = game.i18n.localize("FIMBLEWOOD.Freundebuch.HudAdd");
    btn.innerHTML = '<i class="fa-solid fa-book"></i>';
    btn.addEventListener("click", () => addFriend(tokenDoc));
    col.appendChild(btn);
  });

  Hooks.once("ready", () => { _couldOpen = canOpen(); });
  for (const hook of ["createItem", "deleteItem"]) {
    Hooks.on(hook, (item) => {
      if (isBook(item)) refreshControls();
      refresh();
    });
  }
  for (const hook of ["updateItem", "updateActor", "createActor", "deleteActor", "updateToken"]) {
    Hooks.on(hook, () => refresh());
  }
}
