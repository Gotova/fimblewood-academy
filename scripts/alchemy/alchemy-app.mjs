/**
 * Fimblewood Academy — Alchemy window
 *
 * Shows only the tools a character can use right now: portable ones from the
 * inventory (Reisekessel, Kelle, Mörser) and stationary ones from the Region
 * its token stands in (Braukessel, Destillierapparat, Athanor, Ölbad), plus the
 * character's recipe book. Clicking a tool opens its view on the right.
 *
 * Like the garden, it renders an HTML string and wires delegated listeners
 * itself. Action names are prefixed "fw" (a plain "close" is ApplicationV2's
 * window close), and no form field is called "item" (it shadows the form's
 * built-in `elements.item()`).
 */

import { EFFECTS, EFFECT_BY_ID } from "./effects.mjs";
import { INGREDIENT_BY_ID } from "./ingredients.mjs";
import { ALL_RECIPES, parseRecipeKey, recipeInputs, recipeKey } from "./brewing.mjs";
import { MODULE_ID, PORTABLE_TOOLS, TOOL_IMG, toolsFor } from "./tools.mjs";
import { ingredientItems, knownRecipes, liquidTotal, requestAlchemyOp } from "./alchemy-data.mjs";
import { playerCharacters } from "../timetable/afternoon.mjs";

const TIER_LABEL = ["I", "II", "III"];
const t = (key, data) => (data ? game.i18n.format(`FIMBLEWOOD.Alchemy.${key}`, data) : game.i18n.localize(`FIMBLEWOOD.Alchemy.${key}`));

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

const emptyDraft = () => ({ items: {}, water: 0, oil: 0, mondtau: 0 });
const draftIsEmpty = (d) => !Object.values(d.items).some((q) => q > 0) && !d.water && !d.oil && !d.mondtau;

export function recipeTitle(effectId, tier, variant) {
  const effect = EFFECT_BY_ID.get(effectId);
  const parts = [effect?.name ?? effectId];
  if (effect?.maxTier > 1) parts.push(t("TierN", { tier: TIER_LABEL[tier - 1] }));
  if (effect?.variants.length > 1) parts.push(t("VariantN", { n: variant + 1 }));
  return parts.join(" · ");
}

/** "2× Erdwurz (gemahlen) + 1× Sumpfling + 1× Manastaub; 2 Becher Wasser" */
export function recipeText(effectId, tier, variant) {
  const r = recipeInputs(EFFECT_BY_ID.get(effectId), tier, variant);
  const parts = [...r.items].map(([k, qty]) => {
    const [id, prep] = k.split("|");
    const ing = INGREDIENT_BY_ID.get(id);
    return `${qty}× ${prep === "g" ? ing?.groundName : ing?.name}`;
  });
  const cups = ["water", "oil", "mondtau"].filter((l) => r[l]).map((l) => t("Cups", { n: r[l], liquid: t(`Liquid.${l}`) }));
  return parts.join(" + ") + (cups.length ? `; ${cups.join(", ")}` : "");
}

export class AlchemyApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "fimblewood-alchemy",
    tag: "div",
    window: { title: "FIMBLEWOOD.Alchemy.WindowTitle", icon: "fas fa-flask-vial", resizable: true },
    position: { width: 720, height: 600 },
    classes: ["fimblewood-alchemy-app"]
  };

  actorId = null;
  view = "book";
  /** Kettle view key -> {slots: draft[], active: index}. */
  drafts = new Map();
  /** Kettle view key -> results of the last brew. */
  lastResults = new Map();
  busy = false;

  /* ---------------- Helpers ---------------- */

  #actors() {
    if (game.user.isGM) return playerCharacters();
    return game.actors.filter((a) => a.type === "character" && a.isOwner).sort((a, b) => a.name.localeCompare(b.name));
  }

  #actor() {
    const actors = this.#actors();
    if (!actors.some((a) => a.id === this.actorId)) this.actorId = (game.user.character?.isOwner ? game.user.character.id : null) ?? actors[0]?.id ?? null;
    return game.actors.get(this.actorId) ?? null;
  }

  /** The tool entries for the menu, in a fixed order. */
  #entries(tools) {
    const list = [];
    for (const type of PORTABLE_TOOLS) if (tools.portable.has(type)) list.push({ key: type === "reisekessel" ? "kettle:portable" : type, type });
    const brauKessel = tools.stations.filter((s) => s.type === "braukessel");
    for (const s of brauKessel) list.push({ key: `kettle:region:${s.regionKey}`, type: "braukessel", label: brauKessel.length > 1 ? `${t("Tool.braukessel")} (${s.regionName})` : null, slots: s.slots });
    for (const type of ["destille", "athanor", "oelbad"]) if (tools.stations.some((s) => s.type === type)) list.push({ key: type, type });
    return list;
  }

  #capacity(viewKey, tools) {
    if (viewKey === "kettle:portable") return tools.portable.has("reisekessel") ? 1 : 0;
    const regionKey = viewKey.replace("kettle:region:", "");
    return tools.stations.find((s) => s.type === "braukessel" && s.regionKey === regionKey)?.slots ?? 0;
  }

  #drafts(viewKey, capacity) {
    let d = this.drafts.get(viewKey);
    if (!d) this.drafts.set(viewKey, (d = { slots: [], active: 0 }));
    while (d.slots.length < capacity) d.slots.push(emptyDraft());
    d.slots.length = Math.max(1, capacity);
    d.active = Math.min(d.active, d.slots.length - 1);
    return d;
  }

  /** Amount of an item already put into the other slots of the kettle. */
  #usedElsewhere(drafts, itemId) {
    return drafts.slots.reduce((sum, s, i) => (i === drafts.active ? sum : sum + (s.items[itemId] ?? 0)), 0);
  }

  /* ---------------- Rendering ---------------- */

  async _renderHTML() {
    const actor = this.#actor();
    if (!actor) return `<p class="fw-alch-empty">${t(game.user.isGM ? "NoCharacters" : "NoCharacter")}</p>`;
    const tools = toolsFor(actor);
    const entries = this.#entries(tools);
    if (this.view !== "book" && !entries.some((e) => e.key === this.view)) this.view = "book";

    const actors = this.#actors();
    const picker = actors.length > 1 ? `
      <div class="fw-alch-toolbar">
        <select data-action="fwActor">${actors.map((a) => `<option value="${a.id}" ${a.id === actor.id ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select>
      </div>` : "";

    const nav = [...entries.map((e) => `
        <button type="button" class="fw-alch-nav-btn ${this.view === e.key ? "is-active" : ""}" data-action="fwView" data-view="${e.key}">
          <img src="${TOOL_IMG[e.type]}" alt=""><span>${esc(e.label ?? t(`Tool.${e.type}`))}</span>
        </button>`),
      `<button type="button" class="fw-alch-nav-btn ${this.view === "book" ? "is-active" : ""}" data-action="fwView" data-view="book">
          <i class="fas fa-book"></i><span>${t("Book.Title")}</span>
        </button>`].join("");

    let main;
    if (this.view === "book") main = this.#bookView(actor);
    else if (this.view.startsWith("kettle:")) main = this.#kettleView(actor, tools);
    else if (this.view === "moerser") main = this.#mortarView(actor);
    else main = this.#infoView(this.view);

    const noTools = entries.length ? "" : `<p class="fw-alch-hint">${t("NoTools")}</p>`;
    return `${picker}
      <div class="fw-alch-layout">
        <nav class="fw-alch-nav">${nav}</nav>
        <section class="fw-alch-main">${noTools}${main}</section>
      </div>`;
  }

  #infoView(type) {
    return `
      <div class="fw-alch-info">
        <img src="${TOOL_IMG[type]}" alt="">
        <h3>${t(`Tool.${type}`)}</h3>
        <p>${t(`ToolInfo.${type}`)}</p>
      </div>`;
  }

  #kettleView(actor, tools) {
    const capacity = this.#capacity(this.view, tools);
    const drafts = this.#drafts(this.view, capacity);
    const draft = drafts.slots[drafts.active];

    const slotTabs = capacity > 1 ? `
      <div class="fw-alch-slots">${drafts.slots.map((s, i) => `
        <button type="button" class="fw-alch-slot ${i === drafts.active ? "is-active" : ""} ${draftIsEmpty(s) ? "" : "is-filled"}" data-action="fwSlot" data-slot="${i}">
          ${t("SlotN", { n: i + 1 })}
        </button>`).join("")}
      </div>` : "";

    const rows = ingredientItems(actor).map((item) => {
      const have = (item.system.quantity ?? 1) - this.#usedElsewhere(drafts, item.id);
      const put = draft.items[item.id] ?? 0;
      return `
        <li class="fw-alch-row ${put ? "is-used" : ""}">
          <img src="${esc(item.img)}" alt="">
          <span class="fw-alch-name">${esc(item.name)} <em>(${Math.max(0, have - put)})</em></span>
          <button type="button" data-action="fwDec" data-id="${item.id}" ${put ? "" : "disabled"}>−</button>
          <span class="fw-alch-count">${put}</span>
          <button type="button" data-action="fwInc" data-id="${item.id}" ${put < have ? "" : "disabled"}>+</button>
        </li>`;
    }).join("");

    const kelle = tools.portable.has("kelle");
    const liquidRow = (liquid, max) => `
      <li class="fw-alch-row ${draft[liquid] ? "is-used" : ""}">
        <i class="fas fa-${liquid === "water" ? "droplet" : liquid === "oil" ? "oil-can" : "moon"}"></i>
        <span class="fw-alch-name">${t(`Liquid.${liquid}`)}${max == null ? "" : ` <em>(${Math.max(0, max - draft[liquid])})</em>`}</span>
        <button type="button" data-action="fwDecLiquid" data-liquid="${liquid}" ${draft[liquid] ? "" : "disabled"}>−</button>
        <span class="fw-alch-count">${draft[liquid]}</span>
        <button type="button" data-action="fwIncLiquid" data-liquid="${liquid}" ${max == null || draft[liquid] < max ? "" : "disabled"}>+</button>
      </li>`;
    const otherSlots = (liquid) => drafts.slots.reduce((sum, s, i) => (i === drafts.active ? sum : sum + s[liquid]), 0);
    let liquids = "";
    if (kelle) {
      liquids += liquidRow("water", null);
      if (tools.has("oelbad")) liquids += liquidRow("oil", liquidTotal(actor, "oil") - otherSlots("oil"));
      if (tools.has("athanor")) liquids += liquidRow("mondtau", liquidTotal(actor, "mondtau") - otherSlots("mondtau"));
    }

    const results = (this.lastResults.get(this.view) ?? []).map((r) => r.fail
      ? `<li class="is-fail"><i class="fas fa-skull-crossbones"></i> ${t("Result.Fail")}${r.hintKey ? ` — <em>${esc(this.#hint(r))}</em>` : ""}</li>`
      : `<li class="is-ok"><i class="fas fa-check"></i> ${esc(r.name)}</li>`).join("");

    return `
      <h3>${t(this.view === "kettle:portable" ? "Tool.reisekessel" : "Tool.braukessel")}</h3>
      ${slotTabs}
      <div class="fw-alch-columns">
        <div>
          <h4>${t("Ingredients")}</h4>
          <ul class="fw-alch-list">${rows || `<li class="fw-alch-hint">${t("NoIngredients")}</li>`}</ul>
        </div>
        <div>
          <h4>${t("Liquids")}</h4>
          <ul class="fw-alch-list">${liquids || `<li class="fw-alch-hint">${t("NoLadle")}</li>`}</ul>
        </div>
      </div>
      <div class="fw-alch-actions">
        <button type="button" data-action="fwClear">${t("Clear")}</button>
        <button type="button" class="fw-alch-primary" data-action="fwBrew" ${this.busy ? "disabled" : ""}>${t(capacity > 1 ? "BrewAll" : "Brew")}</button>
      </div>
      ${results ? `<ul class="fw-alch-results">${results}</ul>` : ""}`;
  }

  #hint(result) {
    const data = { ...(result.hintData ?? {}) };
    if (data.liquid) data.liquid = t(`Liquid.${data.liquid}`);
    if (data.element) data.element = t(`Element.${data.element}`);
    return t(`Hint.${result.hintKey}`, data);
  }

  #mortarView(actor) {
    const raw = ingredientItems(actor).filter((i) => i.getFlag(MODULE_ID, "role") === "harvest");
    const rows = raw.map((item) => `
      <li class="fw-alch-row">
        <img src="${esc(item.img)}" alt="">
        <span class="fw-alch-name">${esc(item.name)} <em>(${item.system.quantity ?? 1})</em></span>
        <input type="number" name="grind-${item.id}" min="1" max="${item.system.quantity ?? 1}" value="1">
        <button type="button" data-action="fwGrind" data-id="${item.id}" ${this.busy ? "disabled" : ""}>${t("Grind")}</button>
      </li>`).join("");
    return `
      <h3>${t("Tool.moerser")}</h3>
      <p class="fw-alch-hint">${t("ToolInfo.moerser")}</p>
      <ul class="fw-alch-list">${rows || `<li class="fw-alch-hint">${t("NothingToGrind")}</li>`}</ul>`;
  }

  #bookView(actor) {
    const known = knownRecipes(actor);
    const isGM = game.user.isGM;
    const recipes = isGM ? ALL_RECIPES.map((r) => recipeKey(r.effectId, r.tier, r.variant)) : [...known];
    const order = new Map(EFFECTS.map((e, i) => [e.id, i]));
    const parsed = recipes.map((k) => ({ key: k, ...parseRecipeKey(k) }))
      .filter((r) => EFFECT_BY_ID.has(r.effectId))
      .sort((a, b) => (order.get(a.effectId) - order.get(b.effectId)) || a.tier - b.tier || a.variant - b.variant);
    const rows = parsed.map((r) => `
      <li class="fw-alch-recipe ${known.has(r.key) ? "" : "is-unknown"}">
        ${isGM ? `<input type="checkbox" data-learn="${r.key}" ${known.has(r.key) ? "checked" : ""} title="${esc(t("Book.Known"))}">` : ""}
        <div class="fw-alch-recipe-text">
          <strong>${esc(recipeTitle(r.effectId, r.tier, r.variant))}</strong>
          <small>${esc(recipeText(r.effectId, r.tier, r.variant))}</small>
        </div>
        <button type="button" data-action="fwFill" data-key="${r.key}" title="${esc(t("Book.FillHint"))}"><i class="fas fa-hand-holding-droplet"></i></button>
      </li>`).join("");
    return `
      <h3>${t("Book.Title")}</h3>
      <p class="fw-alch-hint">${t(isGM ? "Book.GmHint" : "Book.Hint")}</p>
      <ul class="fw-alch-list">${rows || `<li class="fw-alch-hint">${t("Book.Empty")}</li>`}</ul>`;
  }

  /* ---------------- Events ---------------- */

  async _replaceHTML(result, content) {
    content.innerHTML = result;
    if (!content.dataset.fwAlchWired) {
      content.dataset.fwAlchWired = "1";
      content.addEventListener("click", (event) => {
        const el = event.target.closest("[data-action]");
        if (!el || el.tagName === "SELECT" || el.disabled) return;
        this.#onAction(el.dataset.action, el);
      });
      content.addEventListener("change", (event) => {
        const el = event.target;
        if (el.matches('select[data-action="fwActor"]')) {
          this.actorId = el.value;
          this.drafts.clear();
          this.lastResults.clear();
          this.render();
        } else if (el.matches("[data-learn]")) {
          requestAlchemyOp({ type: "gmLearn", actorId: this.actorId, key: el.dataset.learn, known: el.checked });
        }
      });
    }
    return content;
  }

  #currentDraft() {
    const actor = this.#actor();
    const tools = toolsFor(actor);
    const drafts = this.#drafts(this.view, this.#capacity(this.view, tools));
    return drafts.slots[drafts.active];
  }

  async #onAction(action, el) {
    switch (action) {
      case "fwView":
        this.view = el.dataset.view;
        return this.render();
      case "fwSlot": {
        const d = this.drafts.get(this.view);
        if (d) d.active = Number(el.dataset.slot);
        return this.render();
      }
      case "fwInc":
      case "fwDec": {
        const draft = this.#currentDraft();
        const next = (draft.items[el.dataset.id] ?? 0) + (action === "fwInc" ? 1 : -1);
        if (next > 0) draft.items[el.dataset.id] = next;
        else delete draft.items[el.dataset.id];
        return this.render();
      }
      case "fwIncLiquid":
      case "fwDecLiquid": {
        const draft = this.#currentDraft();
        draft[el.dataset.liquid] = Math.max(0, draft[el.dataset.liquid] + (action === "fwIncLiquid" ? 1 : -1));
        return this.render();
      }
      case "fwClear": {
        const d = this.drafts.get(this.view);
        if (d) d.slots[d.active] = emptyDraft();
        return this.render();
      }
      case "fwBrew":
        return this.#brew();
      case "fwGrind":
        return this.#grind(el.dataset.id);
      case "fwFill":
        return this.#fill(el.dataset.key);
    }
  }

  async #brew() {
    const d = this.drafts.get(this.view);
    if (!d) return;
    const slots = d.slots.filter((s) => !draftIsEmpty(s)).map((s) => ({
      ingredients: Object.entries(s.items).map(([itemId, qty]) => ({ itemId, qty })),
      water: s.water, oil: s.oil, mondtau: s.mondtau
    }));
    if (!slots.length) return ui.notifications.info(t("Notice.Empty"));
    const kettle = this.view.replace("kettle:", "");
    this.busy = true;
    this.render();
    const result = await requestAlchemyOp({ type: "brew", actorId: this.actorId, kettle, slots });
    this.busy = false;
    if (result?.ok) {
      this.lastResults.set(this.view, result.results ?? []);
      d.slots = d.slots.map(() => emptyDraft());
    } else if (result?.message) {
      ui.notifications.warn(result.message);
    }
    this.render();
  }

  async #grind(itemId) {
    const input = this.element.querySelector(`input[name="grind-${itemId}"]`);
    this.busy = true;
    this.render();
    const result = await requestAlchemyOp({ type: "grind", actorId: this.actorId, itemId, qty: Number(input?.value) || 1 });
    this.busy = false;
    if (result?.message) ui.notifications[result.ok ? "info" : "warn"](result.message);
    this.render();
  }

  /** Puts everything a recipe needs into a kettle, if the character has it all. */
  #fill(key) {
    const actor = this.#actor();
    const tools = toolsFor(actor);
    const { effectId, tier, variant } = parseRecipeKey(key);
    const recipe = recipeInputs(EFFECT_BY_ID.get(effectId), tier, variant);

    const kettles = this.#entries(tools).filter((e) => e.key.startsWith("kettle:"));
    const target = kettles.find((e) => e.key === this.view) ?? kettles[0];
    if (!target) return ui.notifications.warn(t("Notice.NoKettle"));

    const missing = [];
    const needTool = (type) => { if (!tools.has(type)) missing.push(t(`Tool.${type}`)); };
    if (recipe.water || recipe.oil || recipe.mondtau) needTool("kelle");
    if (recipe.oil) needTool("oelbad");
    if (recipe.mondtau) needTool("athanor");

    const drafts = this.#drafts(target.key, this.#capacity(target.key, tools));
    const draft = emptyDraft();
    const items = ingredientItems(actor);
    for (const [k, qty] of recipe.items) {
      const [id, prep] = k.split("|");
      const role = prep === "g" ? "ground" : "harvest";
      const item = items.find((i) => i.getFlag(MODULE_ID, "ingredientId") === id && i.getFlag(MODULE_ID, "role") === role);
      const have = item ? (item.system.quantity ?? 1) - this.#usedElsewhere(drafts, item.id) : 0;
      const ing = INGREDIENT_BY_ID.get(id);
      const name = prep === "g" ? ing?.groundName : ing?.name;
      if (have < qty) missing.push(`${qty - Math.max(0, have)}× ${name}`);
      else draft.items[item.id] = qty;
    }
    for (const liquid of ["oil", "mondtau"]) {
      if (recipe[liquid] && liquidTotal(actor, liquid) < recipe[liquid]) missing.push(`${recipe[liquid]}× ${t(`Liquid.${liquid}`)}`);
    }
    if (missing.length) return ui.notifications.warn(t("Notice.Missing", { list: missing.join(", ") }));

    draft.water = recipe.water;
    draft.oil = recipe.oil;
    draft.mondtau = recipe.mondtau;
    drafts.slots[drafts.active] = draft;
    this.view = target.key;
    this.render();
  }
}

