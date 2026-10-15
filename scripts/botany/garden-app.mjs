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
import { potionsOf, fertilizersOf, modBadge } from "./modifiers.mjs";
import { getMembers, getGarden, plantState, seedsOf, requestGardenOp, today, memberActors } from "./data.mjs";

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
    position: { width: 560, height: "auto" },
    classes: ["fimblewood-garden-app"]
  };

  /** The character whose garden is shown. */
  actorId = null;

  /** Index of the bed whose card is open. */
  selected = null;

  /** An item or GM tool waiting for the player to pick a bed: {kind, itemId?, label, harm?, growth?, yield?, clear?}. */
  applying = null;

  #viewedActor() {
    const ids = memberActors().map((a) => a.id);
    return ids.includes(this.actorId) ? this.actorId : (ids[0] ?? null);
  }

  async _renderHTML() {
    const actorId = this.#viewedActor();
    const member = actorId ? getMembers()[actorId] : null;
    if (!member) return `<p class="fw-garden-empty">${t(game.user.isGM ? "NoMembers" : "NotMember")}</p>`;

    this.actorId = actorId;
    const size = member.size;
    const [cols, rows] = GARDEN_SIZES[size];
    const layout = BOARD_LAYOUT[size];
    const garden = getGarden(actorId);
    const total = slotCount(size);
    if (this.selected != null && (this.selected >= total || !garden.slots[this.selected])) this.selected = null;

    let beds = "";
    const target = this.applying ? "is-target" : "";
    for (let i = 0; i < total; i++) {
      const state = plantState(garden.slots[i]);
      if (!state) {
        beds += `<button type="button" class="fw-garden-slot is-empty ${target}" data-action="fwSlot" data-slot="${i}" title="${esc(t("Plant"))}"><span class="fw-garden-plus">+</span>${modBadge(garden.mods[i])}</button>`;
        continue;
      }
      const img = INGREDIENT_BY_ID.get(state.plant.ingredientId)?.img;
      const cls = state.dead ? "is-dead" : state.ripe ? "is-ripe" : "";
      beds += `
        <button type="button" class="fw-garden-slot ${cls} ${target} ${this.selected === i ? "is-selected" : ""}" data-action="fwSlot" data-slot="${i}"
                style="--m:${state.maturity / 100}" title="${esc(state.plant.name)}">
          <img src="${esc(img)}" alt="">
          <span class="fw-garden-pct">${Math.floor(state.maturity)} %</span>${modBadge(garden.mods[i])}
        </button>`;
    }

    const board = `
      <div class="fw-garden-board" style="--cols:${cols};--rows:${rows};--pad:${layout.pad}cqw;--gap:${layout.gap}cqw;
           --bg:url('modules/${MODULE_ID}/assets/garden/garden-${size}.webp')">
        <div class="fw-garden-grid">${beds}</div>
        ${this.#card(garden)}
      </div>`;

    return `
      <div class="fw-garden-layout">
        ${this.#side()}
        <div class="fw-garden-main">${this.#toolbar(actorId)}${this.#banner()}${board}</div>
      </div>`;
  }

  /** The menu on the left: potions and fertilizer for the players, the modifier tool for the GM. */
  #side() {
    const button = (action, icon, label) =>
      `<button type="button" class="fw-garden-side-btn" data-action="${action}" title="${esc(label)}"><i class="fas fa-${icon}"></i><span>${esc(label)}</span></button>`;
    if (game.user.isGM) return `<nav class="fw-garden-side">${button("fwMod", "sliders", t("Side.Mod"))}</nav>`;
    return `<nav class="fw-garden-side">${button("fwPotion", "flask", t("Side.Potion"))}${button("fwFertilizer", "leaf", t("Side.Fertilizer"))}</nav>`;
  }

  /** The hint shown while an item waits for a bed. */
  #banner() {
    if (!this.applying) return "";
    return `
      <div class="fw-garden-banner">
        <span>${t("ApplyHint", { what: esc(this.applying.label) })}</span>
        <button type="button" data-action="fwCancelApply">${t("Cancel")}</button>
      </div>`;
  }

  #toolbar(actorId) {
    const isGM = game.user.isGM;
    const actors = memberActors();
    if (!isGM && actors.length < 2) return "";
    const members = getMembers();
    const options = actors.map((a) =>
      `<option value="${a.id}" ${a.id === actorId ? "selected" : ""}>${esc(a.name)} (${members[a.id].size})</option>`
    ).join("");
    const day = today();
    const gmTools = isGM ? `
        <button type="button" data-action="fwAdvance" title="${esc(t("AdvanceHint"))}">${t("Advance")}</button>
        ${day != null ? `<span class="fw-garden-day">${t("Day", { day })}</span>` : ""}` : "";
    return `
      <div class="fw-garden-toolbar">
        <select data-action="fwOwner">${options}</select>${gmTools}
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
        ${modBadge(garden.mods[i])}
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
          this.actorId = el.value;
          this.selected = null;
          this.render();
        } else if (el.matches("[data-gm]")) {
          requestGardenOp({ type: "gmSet", actorId: this.actorId, slot: this.selected, [el.dataset.gm]: Number(el.value) });
        }
      });
    }
    return content;
  }

  async #onAction(action, el) {
    const slot = Number(el.dataset.slot);
    switch (action) {
      case "fwSlot": {
        if (this.applying) {
          this.#applyTo(slot);
          break;
        }
        const garden = getGarden(this.actorId);
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
        requestGardenOp({ type: "gmRemove", actorId: this.actorId, slot: this.selected });
        this.selected = null;
        break;
      case "fwAdvance":
        requestGardenOp({ type: "advance", days: 1 });
        break;
      case "fwPotion":
        this.#pickPotion();
        break;
      case "fwFertilizer":
        this.#pickFertilizer();
        break;
      case "fwMod":
        this.#pickGmMod();
        break;
      case "fwCancelApply":
        this.applying = null;
        this.render();
        break;
    }
  }

  /** A radio list of items in a dialog; resolves to the chosen item id, or null. */
  async #chooseItem(title, icon, rows) {
    const list = rows.map(({ item, usable, note }) => `
      <label class="fw-garden-seed ${usable ? "" : "is-disabled"}">
        <input type="radio" name="choice" value="${item.id}" ${usable ? "" : "disabled"}>
        <img src="${esc(item.img)}" alt="">
        <span>${esc(item.name)} <em>×${item.system.quantity ?? 1}</em> <small>${esc(note)}</small></span>
      </label>`).join("");
    return foundry.applications.api.DialogV2.prompt({
      window: { title, icon },
      content: `<div class="fw-garden-seed-list">${list}</div>`,
      ok: { label: t("Choose"), callback: (event, button) => button.form.elements.choice?.value || null },
      rejectClose: false,
      position: { width: 380 }
    });
  }

  async #pickPotion() {
    const actor = game.actors.get(this.actorId);
    const potions = potionsOf(actor);
    if (!potions.length) return ui.notifications.info(t("NoPotions"));
    const rows = potions.map(({ item, info }) => {
      const effect = info.effect;
      const note = !effect ? t("Note.None") : effect.kind === "growth" ? t("Note.Growth", { factor: info.factor }) : t("Note.Harm");
      return { item, usable: !!effect, note };
    });
    const itemId = await this.#chooseItem(t("PotionTitle"), "fas fa-flask", rows);
    if (!itemId) return;
    const picked = potions.find((p) => p.item.id === itemId);
    this.applying = { kind: "potion", itemId, label: picked.item.name, harm: picked.info.effect.kind === "harm", effectId: picked.info.effectId };
    this.render();
  }

  async #pickFertilizer() {
    const actor = game.actors.get(this.actorId);
    const fertilizers = fertilizersOf(actor);
    if (!fertilizers.length) return ui.notifications.info(t("NoFertilizers"));
    const rows = fertilizers.map(({ item, factor }) => ({ item, usable: true, note: t("Note.Growth", { factor }) }));
    const itemId = await this.#chooseItem(t("FertilizerTitle"), "fas fa-leaf", rows);
    if (!itemId) return;
    const picked = fertilizers.find((f) => f.item.id === itemId);
    this.applying = { kind: "fertilizer", itemId, label: picked.item.name };
    this.render();
  }

  /** GM: sets growth/yield factors (or clears a bed), then waits for a bed to put them on. */
  async #pickGmMod() {
    const mod = await foundry.applications.api.DialogV2.prompt({
      window: { title: t("ModTitle"), icon: "fas fa-sliders" },
      content: `
        <div class="fw-garden-modform">
          <p class="fw-garden-hint">${t("ModHint")}</p>
          <label>${t("ModGrowth")} <input type="number" name="growth" min="0.1" max="10" step="0.1" placeholder="${esc(t("ModUnchanged"))}"></label>
          <label>${t("ModYield")} <input type="number" name="yield" min="0.1" max="10" step="0.1" placeholder="${esc(t("ModUnchanged"))}"></label>
          <label class="checkbox"><input type="checkbox" name="clear"> ${t("ModClear")}</label>
        </div>`,
      ok: {
        label: t("Choose"),
        callback: (event, button) => {
          const f = button.form.elements;
          const num = (el) => (el.value === "" ? null : Number(el.value));
          return { growth: num(f.growth), yield: num(f.yield), clear: f.clear.checked };
        }
      },
      rejectClose: false,
      position: { width: 380 }
    });
    if (!mod || (!mod.clear && mod.growth == null && mod.yield == null)) return;
    const parts = [];
    if (mod.clear) parts.push(t("ModClearShort"));
    if (mod.growth != null) parts.push(`${t("ModGrowth")}${mod.growth}`);
    if (mod.yield != null) parts.push(`${t("ModYield")}${mod.yield}`);
    this.applying = { kind: "gmMod", label: parts.join(", "), ...mod };
    this.render();
  }

  /** Puts the waiting item or GM tool on a bed. */
  async #applyTo(slot) {
    const a = this.applying;
    if (!a) return;
    const state = plantState(getGarden(this.actorId).slots[slot]);
    // A harmful potion needs a plant; no confirmation, players are meant to experiment.
    if (a.kind === "potion" && a.harm && !state) return ui.notifications.warn(t("Notice.NeedsPlant"));
    const base = { actorId: this.actorId, slot };
    if (a.kind === "potion") requestGardenOp({ ...base, type: "usePotion", itemId: a.itemId });
    else if (a.kind === "fertilizer") requestGardenOp({ ...base, type: "useFertilizer", itemId: a.itemId });
    else requestGardenOp({ ...base, type: "gmMod", growth: a.growth, yield: a.yield, clear: a.clear });
    this.applying = null;
    this.render();
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
      const actor = game.actors.get(this.actorId);
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
    if (isGM) requestGardenOp({ type: "gmPlant", actorId: this.actorId, slot, plantId: choice });
    else requestGardenOp({ type: "plant", actorId: this.actorId, slot, itemId: choice });
  }

  async #harvest() {
    const slot = this.selected;
    const state = plantState(getGarden(this.actorId).slots[slot]);
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
    requestGardenOp({ type: "harvest", actorId: this.actorId, slot });
  }
}

