/**
 * Fimblewood Academy — Botany Club growth times (GM settings menu)
 *
 * One number per plant: the days it needs to reach 100 % maturity. The
 * defaults come from the plant's rarity (5 / 8 / 12 / 30 days). Only values
 * that differ from the default are stored, so changing a default later
 * still reaches every plant the GM left alone.
 */

import { PLANTS } from "./plants.mjs";
import { growthDays, saveGrowthDays } from "./data.mjs";
import { KIND_LABELS } from "../alchemy/ingredients.mjs";

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

const t = (key) => game.i18n.localize(`FIMBLEWOOD.Botany.${key}`);

export class GrowthApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "fimblewood-botany-growth",
    tag: "div",
    window: { title: "FIMBLEWOOD.Botany.Growth.Title", icon: "fas fa-hourglass-half", resizable: true },
    position: { width: 440, height: 560 },
    classes: ["fimblewood-garden-app", "is-growth"]
  };

  async _renderHTML() {
    const groups = ["herb", "mushroom", "food", "flower"].map((kind) => {
      const rows = PLANTS.filter((p) => p.kind === kind).map((p) => `
        <li class="fw-garden-member-row">
          <label for="fw-growth-${p.id}">${esc(p.name)} <em>(${t(`Rarity.${p.rarity}`)})</em></label>
          <span class="fw-garden-growth-field">
            <input id="fw-growth-${p.id}" type="number" name="days" data-plant="${p.id}" min="1" max="365" step="1" value="${growthDays(p)}">
            <small>${t("Growth.Default")} ${p.defaultGrowthDays}</small>
          </span>
        </li>`).join("");
      return `<h4 class="fw-garden-group">${esc(KIND_LABELS[kind])}</h4><ul class="fw-garden-member-list">${rows}</ul>`;
    }).join("");

    return `
      <div class="fw-garden-members-body fw-garden-growth-body">
        <p class="fw-garden-hint">${t("Growth.Hint")}</p>
        <div class="fw-garden-growth-scroll">${groups}</div>
        <div class="fw-garden-actions">
          <button type="button" data-action="fwSave" class="fw-garden-primary">${t("Growth.Save")}</button>
          <button type="button" data-action="fwReset">${t("Growth.Reset")}</button>
          <button type="button" data-action="fwCancel">${t("Growth.Cancel")}</button>
        </div>
      </div>`;
  }

  async _replaceHTML(result, content) {
    content.innerHTML = result;
    if (!content.dataset.fwGardenWired) {
      content.dataset.fwGardenWired = "1";
      content.addEventListener("click", (event) => {
        const action = event.target.closest("[data-action]")?.dataset.action;
        if (action === "fwSave") this.#save();
        else if (action === "fwReset") this.#reset();
        else if (action === "fwCancel") this.close();
      });
    }
    return content;
  }

  /** Puts the default of every plant back into the fields (saving is still up to the GM). */
  #reset() {
    for (const input of this.element.querySelectorAll('input[name="days"]')) {
      input.value = PLANTS.find((p) => p.id === input.dataset.plant)?.defaultGrowthDays ?? input.value;
    }
  }

  async #save() {
    const overrides = {};
    for (const input of this.element.querySelectorAll('input[name="days"]')) {
      const plant = PLANTS.find((p) => p.id === input.dataset.plant);
      const days = Math.round(Number(input.value));
      if (plant && Number.isFinite(days) && days >= 1 && days !== plant.defaultGrowthDays) overrides[plant.id] = Math.min(days, 365);
    }
    await saveGrowthDays(overrides);
    this.close();
  }
}
