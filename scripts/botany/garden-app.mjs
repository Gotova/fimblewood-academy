/**
 * Fimblewood Academy — "Mein Garten"
 *
 * A member sees their own garden: a top-down background picture
 * (assets/garden/garden-{size}.webp) with a grid of beds laid over it.
 * An empty bed has a plant button that lists the character's seeds. A
 * planted bed shows the plant growing; clicking it opens a small card with
 * maturity, HP and a harvest button. The GM sees the same view for any
 * member, with extra controls to edit maturity/HP and to advance the days.
 *
 * Like the other apps this renders an HTML string and wires one delegated
 * listener per kind of event (see JukeboxApp for why not DEFAULT_OPTIONS.actions).
 */

import { INGREDIENT_BY_ID } from "../alchemy/ingredients.mjs";
import { MODULE_ID, PLANTS, GARDEN_SIZES, slotCount } from "./plants.mjs";
import { getMembers, getGarden, plantState, seedsOf, requestGardenOp, today, ownedCharacter } from "./data.mjs";

/** Where the beds sit on each background picture, as % of the board width: the margin on every side, and the gap between beds. The beds are square. */
const BOARD_LAYOUT = {
  "2x2": { pad: 18, gap: 6 },
  "3x2": { pad: 14, gap: 5 },
  "3x3": { pad: 12, gap: 4 },
  "3x4": { pad: 10, gap: 4 },
  "4x4": { pad: 10, gap: 3 }
};

const t = (key, data) => (data ? game.i18n.format(`FIMBLEWOOD.Botany.${key}`, data) : game.i18n.localize(`FIMBLEWOOD.Botany.${key}`));

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}


export class GardenApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "fimblewood-garden",
    tag: "div",
    window: { title: "FIMBLEWOOD.Botany.WindowTitle", icon: "fas fa-seedling", resizable: false },
    position: { width: 460, height: "auto" },
    classes: ["fimblewood-garden-app"]
  };

  /** GM: the member whose garden is shown. */
  ownerId = null;

  /** Index of the bed whose card is open. */
  selected = null;

  #viewedOwner() {
    const members = getMembers();
    if (!game.user.isGM) return members[game.user.id] ? game.user.id : null;
    const ids = Object.keys(members);
    return ids.includes(this.ownerId) ? this.ownerId : (ids[0] ?? null);
  }

  async _renderHTML() {
    const ownerId = this.#viewedOwner();
    const member = ownerId ? getMembers()[ownerId] : null;
    if (!member) return `<p class="fw-garden-empty">${t(game.user.isGM ? "NoMembers" : "NotMember")}</p>`;

    this.ownerId = ownerId;
    const size = member.size;
    const [cols, rows] = GARDEN_SIZES[size];
    const layout = BOARD_LAYOUT[size];
    const garden = getGarden(ownerId);
    const total = slotCount(size);
    if (this.selected != null && (this.selected >= total || !garden.slots[this.selected])) this.selected = null;

    let beds = "";
    for (let i = 0; i < total; i++) {
      const state = plantState(garden.slots[i]);
      if (!state) {
        beds += `<button type="button" class="fw-garden-slot is-empty" data-action="fwSlot" data-slot="${i}" title="${esc(t("Plant"))}"><span class="fw-garden-plus">+</span></button>`;
        continue;
      }
      const img = INGREDIENT_BY_ID.get(state.plant.ingredientId)?.img;
      const cls = state.dead ? "is-dead" : state.ripe ? "is-ripe" : "";
      beds += `
        <button type="button" class="fw-garden-slot ${cls} ${this.selected === i ? "is-selected" : ""}" data-action="fwSlot" data-slot="${i}"
                style="--m:${state.maturity / 100}" title="${esc(state.plant.name)}">
          <img src="${esc(img)}" alt="">
          <span class="fw-garden-pct">${Math.floor(state.maturity)} %</span>
        </button>`;
    }

    const board = `
      <div class="fw-garden-board" style="--cols:${cols};--rows:${rows};--pad:${layout.pad}cqw;--gap:${layout.gap}cqw;
           --bg:url('modules/${MODULE_ID}/assets/garden/garden-${size}.webp')">
        <div class="fw-garden-grid">${beds}</div>
        ${this.#card(garden)}
      </div>`;

    return `${this.#toolbar(ownerId, size)}${board}`;
  }

  #toolbar(ownerId, size) {
    if (!game.user.isGM) return "";
    const members = getMembers();
    const options = Object.keys(members).map((id) =>
      `<option value="${id}" ${id === ownerId ? "selected" : ""}>${esc(game.users.get(id)?.name)} (${members[id].size})</option>`
    ).join("");
    const day = today();
    return `
      <div class="fw-garden-toolbar">
        <select data-action="fwOwner">${options}</select>
        <button type="button" data-action="fwAdvance" title="${esc(t("AdvanceHint"))}">${t("Advance")}</button>
        ${day != null ? `<span class="fw-garden-day">${t("Day", { day })}</span>` : ""}
      </div>`;
  }

  #card(garden) {
    const i = this.selected;
    const state = i != null ? plantState(garden.slots[i]) : null;
    if (!state) return "";
    const { plant, maturity, hp } = state;
    const isGM = game.user.isGM;
    const status = state.dead ? t("StatusDead") : state.ripe ? t("StatusRipe") : t("StatusGrowing");
    const gmFields = isGM ? `
      <div class="fw-garden-gm">
        <label>${t("Maturity")} <input type="number" data-gm="maturity" min="0" max="100" step="1" value="${Math.round(maturity)}"></label>
        <label>${t("Hp")} <input type="number" data-gm="hp" min="0" max="${plant.maxHp}" step="1" value="${hp}"></label>
        <button type="button" data-action="fwRemove">${t("Remove")}</button>
      </div>` : "";
    return `
      <div class="fw-garden-card">
        <button type="button" class="fw-garden-close" data-action="fwCardClose" title="${esc(t("Close"))}">×</button>
        <h3>${esc(plant.name)}</h3>
        <div class="fw-garden-status">${status}</div>
        <div class="fw-garden-stat"><span>${t("Maturity")}</span><span>${Math.floor(maturity)} %</span></div>
        <div class="fw-garden-bar is-maturity"><span style="width:${maturity}%"></span></div>
        <div class="fw-garden-stat"><span>${t("Hp")}</span><span>${hp} / ${plant.maxHp}</span></div>
        <div class="fw-garden-bar is-hp"><span style="width:${(hp / plant.maxHp) * 100}%"></span></div>
        <button type="button" class="fw-garden-primary" data-action="fwHarvest">${t("Harvest")}</button>
        ${gmFields}
      </div>`;
  }

  async _replaceHTML(result, content) {
    content.innerHTML = result;
    if (!content.dataset.fwGardenWired) {
      content.dataset.fwGardenWired = "1";
      content.addEventListener("click", (event) => {
        const el = event.target.closest("[data-action]");
        if (!el || el.tagName === "SELECT") return;
        this.#onAction(el.dataset.action, el);
      });
      content.addEventListener("change", (event) => {
        const el = event.target;
        if (el.matches('select[data-action="fwOwner"]')) {
          this.ownerId = el.value;
          this.selected = null;
          this.render();
        } else if (el.matches("[data-gm]")) {
          requestGardenOp({ type: "gmSet", ownerId: this.ownerId, slot: this.selected, [el.dataset.gm]: Number(el.value) });
        }
      });
    }
    return content;
  }

  async #onAction(action, el) {
    const slot = Number(el.dataset.slot);
    switch (action) {
      case "fwSlot": {
        const garden = getGarden(this.ownerId);
        if (garden.slots[slot]) {
          this.selected = this.selected === slot ? null : slot;
          this.render();
        } else {
          this.selected = null;
          this.#plant(slot);
        }
        break;
      }
      case "fwCardClose":
        this.selected = null;
        this.render();
        break;
      case "fwHarvest":
        this.#harvest();
        break;
      case "fwRemove":
        requestGardenOp({ type: "gmRemove", ownerId: this.ownerId, slot: this.selected });
        this.selected = null;
        break;
      case "fwAdvance":
        requestGardenOp({ type: "advance", days: 1 });
        break;
    }
  }

  async #plant(slot) {
    const DialogV2 = foundry.applications.api.DialogV2;
    const isGM = game.user.isGM;
    let options = "";
    if (isGM) {
      options = PLANTS.map((p) =>
        `<label class="fw-garden-seed"><input type="radio" name="seed" value="${p.id}"><img src="${esc(INGREDIENT_BY_ID.get(p.ingredientId)?.img)}" alt=""><span>${esc(p.name)}</span></label>`
      ).join("");
    } else {
      const actor = ownedCharacter(game.user);
      if (!actor) return ui.notifications.warn(t("Notice.NoCharacter"));
      const seeds = seedsOf(actor);
      if (!seeds.length) return ui.notifications.info(t("NoSeeds"));
      options = seeds.map(({ item, plant }) => `
        <label class="fw-garden-seed ${plant ? "" : "is-disabled"}">
          <input type="radio" name="seed" value="${item.id}" ${plant ? "" : "disabled"}>
          <img src="${esc(item.img)}" alt="">
          <span>${esc(item.name)} <em>×${item.system.quantity ?? 1}</em>${plant ? "" : ` <small>${t("SeedUnassigned")}</small>`}</span>
        </label>`).join("");
    }

    const choice = await DialogV2.prompt({
      window: { title: t("PlantTitle"), icon: "fas fa-seedling" },
      content: `<div class="fw-garden-seed-list">${options}</div>`,
      ok: {
        label: t("Plant"),
        callback: (event, button) => button.form.elements.seed?.value || null
      },
      rejectClose: false,
      position: { width: 360 }
    });
    if (!choice) return;
    if (isGM) requestGardenOp({ type: "gmPlant", ownerId: this.ownerId, slot, plantId: choice });
    else requestGardenOp({ type: "plant", slot, itemId: choice });
  }

  async #harvest() {
    const slot = this.selected;
    const state = plantState(getGarden(this.ownerId).slots[slot]);
    if (!state) return;
    if (!state.ripe) {
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: t("HarvestTitle") },
        content: `<p>${t(state.dead ? "ConfirmDead" : "ConfirmUnripe", { plant: esc(state.plant.name) })}</p>`,
        rejectClose: false
      });
      if (!ok) return;
    }
    this.selected = null;
    requestGardenOp({ type: "harvest", ownerId: this.ownerId, slot });
  }
}

