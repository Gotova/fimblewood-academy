/**
 * Fimblewood Academy — Timetable relevant characters (GM settings menu)
 *
 * Lists every player-owned character with a checkbox. Unticked ones (utility
 * or test characters) are stored as excluded and left out of the
 * timetable's character pickers: "Plan for", the invite list, and the
 * course editor's attendee dropdown. Characters are relevant by default,
 * so a new PC shows up without visiting this menu.
 */

import { playerCharacters, excludedActorIds, setExcludedActorIds } from "./afternoon.mjs";

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

export class RelevantCharactersApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "fimblewood-timetable-characters",
    tag: "div",
    window: { title: "FIMBLEWOOD.Timetable.Characters.Title", icon: "fas fa-user-check", resizable: true },
    position: { width: 400, height: "auto" },
    classes: ["fimblewood-timetable-app", "is-course-edit"]
  };

  async _renderHTML() {
    const excluded = excludedActorIds();
    const rows = playerCharacters().map((actor) => {
      const players = game.users.filter((u) => !u.isGM && actor.testUserPermission(u, "OWNER")).map((u) => u.name);
      return `
        <li class="fw-tt-attendee-row">
          <label class="fw-tt-character-toggle">
            <input type="checkbox" name="relevant" value="${actor.id}" ${excluded.has(actor.id) ? "" : "checked"}>
            <span>${esc(actor.name)}</span>
          </label>
          <span class="fw-tt-character-players">${esc(players.join(", "))}</span>
        </li>`;
    }).join("");

    return `
      <div class="fw-tt-course-edit-body">
        <p class="fw-tt-drop-hint">${game.i18n.localize("FIMBLEWOOD.Timetable.Characters.Hint")}</p>
        <ul class="fw-tt-attendee-list">${rows || `<li class="fw-tt-empty-list">${game.i18n.localize("FIMBLEWOOD.Timetable.NoActors")}</li>`}</ul>
        <div class="fw-tt-course-edit-actions">
          <button type="button" data-action="save" class="fw-tt-btn-primary">${game.i18n.localize("FIMBLEWOOD.Timetable.Save")}</button>
          <button type="button" data-action="cancel">${game.i18n.localize("FIMBLEWOOD.Timetable.Cancel")}</button>
        </div>
      </div>`;
  }

  async _replaceHTML(result, content) {
    content.innerHTML = result;
    if (!content.dataset.fwTtWired) {
      content.dataset.fwTtWired = "1";
      content.addEventListener("click", (event) => {
        const action = event.target.closest("[data-action]")?.dataset.action;
        if (action === "save") this.#save();
        else if (action === "cancel") this.close();
      });
    }
    return content;
  }

  async #save() {
    // Keep exclusions of characters not listed right now (e.g. temporarily without a player owner).
    const listed = new Set(playerCharacters().map((a) => a.id));
    const excluded = [...excludedActorIds()].filter((id) => !listed.has(id) && game.actors.has(id));
    for (const box of this.element.querySelectorAll('input[name="relevant"]')) {
      if (!box.checked) excluded.push(box.value);
    }
    await setExcludedActorIds(excluded);
    this.close();
  }
}
