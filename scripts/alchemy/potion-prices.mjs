/**
 * Fimblewood Academy — Potion prices (GM settings menu)
 *
 * The compendium potions ship with default prices by tier (50 / 150 / 500 gp).
 * The GM can change the price of every potion and tier in one table, with
 * the three tiers of a potion side by side. Only prices that differ from the
 * default are stored (world setting `botanyPotionPrices`: {effectId: {tier: gp}}).
 *
 * Compendium data is fixed, so a custom price is applied when a potion is
 * created from the compendium (dragged onto an actor, imported into the
 * world), and, when asked, onto potions that already exist in the world and
 * in actor inventories.
 */

import { EFFECT_BY_ID } from "./effects.mjs";
import { POTION_EFFECTS, TIER_PRICE } from "./potions.mjs";

const MODULE_ID = "fimblewood-academy";
const SETTING = "botanyPotionPrices";
const TIER_LABEL = ["I", "II", "III"];
const RARITY_KEY = ["Common", "Uncommon", "Rare"];

const t = (key, data) => (data ? game.i18n.format(`FIMBLEWOOD.Botany.Prices.${key}`, data) : game.i18n.localize(`FIMBLEWOOD.Botany.Prices.${key}`));

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

/** The price in gp of a potion: the GM's value if set, else the default of its tier. */
export function potionPrice(effectId, tier) {
  const custom = Number(game.settings.get(MODULE_ID, SETTING)?.[effectId]?.[tier]);
  return Number.isFinite(custom) && custom >= 0 ? custom : (TIER_PRICE[tier - 1] ?? TIER_PRICE[0]);
}

/** The GM's price for a potion, or null when it is left at the default. */
function customPrice(effectId, tier) {
  const custom = game.settings.get(MODULE_ID, SETTING)?.[effectId]?.[tier];
  return Number.isFinite(Number(custom)) && custom !== "" && custom != null ? Number(custom) : null;
}

/** Flags of a potion made by this module, or null. */
function potionFlags(source) {
  const f = source?.flags?.[MODULE_ID];
  return f?.role === "potion" && f.potionEffect && EFFECT_BY_ID.has(f.potionEffect) ? f : null;
}

/** Puts the current price onto every existing potion of this module, in the world and in inventories. */
async function applyToExisting() {
  const worldUpdates = [];
  const priceUpdate = (item) => {
    const f = potionFlags(item);
    if (!f) return null;
    const tier = Math.max(1, Math.min(3, Number(f.potionTier) || 1));
    return { _id: item.id, "system.price.value": potionPrice(f.potionEffect, tier), "system.price.denomination": "gp" };
  };
  for (const item of game.items) {
    const u = priceUpdate(item);
    if (u) worldUpdates.push(u);
  }
  if (worldUpdates.length) await Item.updateDocuments(worldUpdates);
  let count = worldUpdates.length;
  for (const actor of game.actors) {
    const updates = actor.items.map(priceUpdate).filter(Boolean);
    if (updates.length) {
      await actor.updateEmbeddedDocuments("Item", updates);
      count += updates.length;
    }
  }
  return count;
}

export class PotionPricesApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "fimblewood-potion-prices",
    tag: "div",
    window: { title: "FIMBLEWOOD.Botany.Prices.Title", icon: "fas fa-coins", resizable: true },
    position: { width: 580, height: 640 },
    classes: ["fimblewood-garden-app", "is-prices"]
  };

  async _renderHTML() {
    const header = [0, 1, 2].map((i) => `<th>${t("Tier")} ${TIER_LABEL[i]}<br><small>${t(`Rarity.${RARITY_KEY[i]}`)}</small></th>`).join("");
    const rows = POTION_EFFECTS.map((effectId) => {
      const effect = EFFECT_BY_ID.get(effectId);
      const cells = [1, 2, 3].map((tier) => {
        if (tier > effect.maxTier) return "<td></td>";
        return `<td><input type="number" min="0" step="1" data-effect="${effectId}" data-tier="${tier}" value="${potionPrice(effectId, tier)}" placeholder="${TIER_PRICE[tier - 1]}"></td>`;
      }).join("");
      return `<tr><th scope="row">${esc(effect.name)}</th>${cells}</tr>`;
    }).join("");

    return `
      <div class="fw-garden-growth-body fw-garden-prices">
        <p class="fw-garden-hint">${t("Hint", { a: TIER_PRICE[0], b: TIER_PRICE[1], c: TIER_PRICE[2] })}</p>
        <div class="fw-garden-growth-scroll">
          <table class="fw-garden-price-table">
            <thead><tr><th>${t("Potion")}</th>${header}</tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <label class="fw-garden-price-apply"><input type="checkbox" name="apply"> ${t("ApplyExisting")}</label>
        <div class="fw-garden-actions">
          <button type="button" data-action="fwPricesSave" class="fw-garden-primary">${t("Save")}</button>
          <button type="button" data-action="fwPricesReset">${t("Reset")}</button>
          <button type="button" data-action="fwPricesCancel">${t("Cancel")}</button>
        </div>
      </div>`;
  }

  async _replaceHTML(result, content) {
    content.innerHTML = result;
    if (!content.dataset.fwGardenWired) {
      content.dataset.fwGardenWired = "1";
      content.addEventListener("click", (event) => {
        const action = event.target.closest("[data-action]")?.dataset.action;
        if (action === "fwPricesSave") this.#save();
        else if (action === "fwPricesReset") this.#reset();
        else if (action === "fwPricesCancel") this.close();
      });
    }
    return content;
  }

  /** Puts the default of every tier into the fields (saving is still up to the GM). */
  #reset() {
    for (const input of this.element.querySelectorAll("input[data-effect]")) {
      input.value = TIER_PRICE[Number(input.dataset.tier) - 1];
    }
  }

  async #save() {
    const overrides = {};
    for (const input of this.element.querySelectorAll("input[data-effect]")) {
      const tier = Number(input.dataset.tier);
      const price = Math.round(Number(input.value) * 100) / 100;
      if (input.value === "" || !Number.isFinite(price) || price < 0 || price === TIER_PRICE[tier - 1]) continue;
      (overrides[input.dataset.effect] ??= {})[tier] = price;
    }
    await game.settings.set(MODULE_ID, SETTING, overrides);
    if (this.element.querySelector('input[name="apply"]')?.checked) {
      const count = await applyToExisting();
      ui.notifications.info(t("Applied", { count }));
    }
    this.close();
  }
}

export function registerPotionPrices() {
  game.settings.register(MODULE_ID, SETTING, { scope: "world", config: false, type: Object, default: {} });
  game.settings.registerMenu(MODULE_ID, "botanyPotionPricesMenu", {
    name: "FIMBLEWOOD.Botany.Prices.MenuName",
    label: "FIMBLEWOOD.Botany.Prices.MenuLabel",
    hint: "FIMBLEWOOD.Botany.Prices.MenuHint",
    icon: "fas fa-coins",
    type: PotionPricesApp,
    restricted: true
  });

  // A potion created from the compendium takes the GM's price, if there is one.
  Hooks.on("preCreateItem", (item, data) => {
    const f = potionFlags(data) ?? potionFlags(item);
    if (!f) return;
    const tier = Math.max(1, Math.min(3, Number(f.potionTier) || 1));
    const price = customPrice(f.potionEffect, tier);
    if (price == null) return;
    item.updateSource({ "system.price.value": price, "system.price.denomination": "gp" });
  });
}
