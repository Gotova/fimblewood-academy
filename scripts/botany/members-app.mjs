/**
 * Fimblewood Academy — Botany Club members (GM settings menu)
 *
 * Lists every player character with a "member" checkbox and a garden size. The players owning a member get
 * the "Mein Garten" tool in the Fimblewood controls. Shrinking a garden
 * keeps the plants of the hidden slots in the data, so growing it back
 * restores them.
 */

import { GARDEN_SIZES, DEFAULT_SIZE } from "./plants.mjs";
import { getMembers, saveMembers } from "./data.mjs";
import { playerCharacters } from "../timetable/afternoon.mjs";

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

const t = (key) => game.i18n.localize(`FIMBLEWOOD.Botany.${key}`);

export class BotanyMembersApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "fimblewood-botany-members",
    tag: "div",
    window: { title: "FIMBLEWOOD.Botany.Members.Title", icon: "fas fa-seedling", resizable: true },
    position: { width: 420, height: "auto" },
    classes: ["fimblewood-garden-app", "is-members"]
  };

  async _renderHTML() {
    const members = getMembers();
    const rows = playerCharacters().map((actor) => {
      const member = members[actor.id];
      const players = game.users.filter((u) => !u.isGM && actor.testUserPermission(u, "OWNER")).map((u) => u.name);
      const options = Object.keys(GARDEN_SIZES).map((size) =>
        `<option value="${size}" ${(member?.size ?? DEFAULT_SIZE) === size ? "selected" : ""}>${size}</option>`
      ).join("");
      return `
        <li class="fw-garden-member-row">
          <label class="fw-garden-member-toggle">
            <input type="checkbox" name="member" value="${actor.id}" ${member ? "checked" : ""}>
            <span>${esc(actor.name)}${players.length ? ` <em>(${esc(players.join(", "))})</em>` : ""}</span>
          </label>
          <select name="size-${actor.id}" title="${esc(t("Members.Size"))}">${options}</select>
        </li>`;
    }).join("");

    return `
      <div class="fw-garden-members-body">
        <p class="fw-garden-hint">${t("Members.Hint")}</p>
        <ul class="fw-garden-member-list">${rows || `<li>${t("Members.NoPlayers")}</li>`}</ul>
        <div class="fw-garden-actions">
          <button type="button" data-action="save" class="fw-garden-primary">${t("Members.Save")}</button>
          <button type="button" data-action="cancel">${t("Members.Cancel")}</button>
        </div>
      </div>`;
  }

  async _replaceHTML(result, content) {
    content.innerHTML = result;
    if (!content.dataset.fwGardenWired) {
      content.dataset.fwGardenWired = "1";
      content.addEventListener("click", (event) => {
        const action = event.target.closest("[data-action]")?.dataset.action;
        if (action === "save") this.#save();
        else if (action === "cancel") this.close();
      });
    }
    return content;
  }

  async #save() {
    // Keep members that are not listed right now (e.g. temporarily without a player owner).
    const listed = new Set(playerCharacters().map((a) => a.id));
    const members = {};
    for (const [id, value] of Object.entries(getMembers())) if (!listed.has(id)) members[id] = value;
    for (const box of this.element.querySelectorAll('input[name="member"]')) {
      if (!box.checked) continue;
      const size = this.element.querySelector(`select[name="size-${box.value}"]`)?.value;
      members[box.value] = { size: GARDEN_SIZES[size] ? size : DEFAULT_SIZE };
    }
    await saveMembers(members);
    this.close();
  }
}
