/**
 * Fimblewood Academy — Botany Club ("Mein Garten")
 *
 * Entry point: registers the settings, the members menu, the "Seed" loot
 * type, the plant picker on seed item sheets, and the "Mein Garten" tool in
 * the Fimblewood control category (draw.mjs creates the category first).
 *
 * The tool is only added for club members and the GM — left out for everyone
 * else rather than hidden, for the same reason as the Jukebox tool.
 */

import { CONTROL_GROUP } from "../draw.mjs";
import { MODULE_ID, PLANTS, PLANT_BY_ID } from "./plants.mjs";
import { registerBotanyData, isMember } from "./data.mjs";
import { BotanyMembersApp } from "./members-app.mjs";
import { GrowthApp } from "./growth-app.mjs";
import { GARDEN_EFFECTS, effectName, cleanFactor, FACTOR_MIN, FACTOR_MAX } from "./modifiers.mjs";

let _garden = null;

export async function openGarden() {
  if (!game.user.isGM && !isMember()) return;
  const { GardenApp } = await import("./garden-app.mjs");
  if (!_garden || !_garden.rendered) {
    _garden = new GardenApp();
    _garden.render(true);
  } else {
    _garden.bringToTop();
  }
}

let _wasMember = null;

function refresh() {
  if (_garden?.rendered) _garden.render();
  // The tool only exists for members, so rebuild the controls when this user's membership flips.
  const member = isMember();
  if (_wasMember !== null && member !== _wasMember) ui.controls?.render({ reset: true });
  _wasMember = member;
}

/**
 * Adds the garden fields to item sheets (GM only): which plant a seed grows,
 * which garden effect a potion has, and the growth factor of a fertilizer.
 */
function injectGardenFields(app, html) {
  if (!game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html[0];
  if (!root) return;
  root.querySelector(".fw-botany-seed-field")?.remove();

  const item = app.document ?? app.item;
  const i18n = (k) => game.i18n.localize(`FIMBLEWOOD.Botany.${k}`);
  const esc = foundry.utils.escapeHTML;
  let legend;
  let control;
  let onChange;

  if (item?.type === "loot" && item.system.type?.value === "seed") {
    const current = item.getFlag(MODULE_ID, "plantId") ?? "";
    legend = i18n("SeedField.Legend");
    control = `<select class="fw-botany-seed-picker">
      <option value="">${i18n("SeedField.None")}</option>
      ${PLANTS.map((p) => `<option value="${p.id}" ${p.id === current ? "selected" : ""}>${esc(p.name)}</option>`).join("")}
    </select>`;
    onChange = async (value) => {
      if (value && PLANT_BY_ID.has(value)) await item.setFlag(MODULE_ID, "plantId", value);
      else await item.unsetFlag(MODULE_ID, "plantId");
    };
  } else if (item?.type === "consumable" && item.system.type?.value === "potion") {
    const current = item.getFlag(MODULE_ID, "potionEffect") ?? "";
    legend = i18n("PotionField.Legend");
    control = `<select class="fw-botany-seed-picker">
      <option value="" ${current === "" ? "selected" : ""}>${i18n("PotionField.Auto")}</option>
      <option value="none" ${current === "none" ? "selected" : ""}>${i18n("PotionField.None")}</option>
      ${Object.entries(GARDEN_EFFECTS).map(([id, e]) => {
        const note = e.kind === "growth" ? `×${e.factor}` : i18n("PotionField.Harm");
        return `<option value="${id}" ${id === current ? "selected" : ""}>${esc(effectName(id))} (${note})</option>`;
      }).join("")}
    </select>`;
    onChange = async (value) => {
      if (value) await item.setFlag(MODULE_ID, "potionEffect", value);
      else await item.unsetFlag(MODULE_ID, "potionEffect");
    };
  } else if (item?.type === "loot") {
    const current = item.getFlag(MODULE_ID, "fertilizer") ?? "";
    legend = i18n("FertilizerField.Legend");
    control = `<label>${i18n("FertilizerField.Label")}
      <input type="number" class="fw-botany-seed-picker" min="${FACTOR_MIN}" max="${FACTOR_MAX}" step="0.1" value="${esc(current)}"></label>`;
    onChange = async (value) => {
      const factor = cleanFactor(value);
      if (value !== "" && factor != null) await item.setFlag(MODULE_ID, "fertilizer", factor);
      else await item.unsetFlag(MODULE_ID, "fertilizer");
    };
  } else {
    return;
  }

  const wrap = document.createElement("fieldset");
  wrap.className = "fimblewood-jukebox-source-field fw-botany-seed-field";
  wrap.innerHTML = `<legend>${legend}</legend>${control}`;
  (root.querySelector("form") ?? root).appendChild(wrap);
  wrap.querySelector(".fw-botany-seed-picker").addEventListener("change", (event) => onChange(event.currentTarget.value));
}

export function registerBotany() {
  registerBotanyData(refresh, BotanyMembersApp, GrowthApp);

  // The "Seed" entry of the loot item's type dropdown. i18nInit, so the label is
  // already translatable and still early enough for the sheets.
  Hooks.once("i18nInit", () => {
    const loot = CONFIG.DND5E?.lootTypes;
    if (loot && !loot.seed) loot.seed = { label: game.i18n.localize("FIMBLEWOOD.Botany.LootType.Seed") };
  });

  Hooks.on("getSceneControlButtons", (controls) => {
    const gm = game.user.isGM;
    if (!gm && !isMember()) return;
    const group = controls[CONTROL_GROUP];
    if (!group) return;
    group.tools.garden = {
      name: "garden",
      title: gm ? "FIMBLEWOOD.Botany.GmButtonTitle" : "FIMBLEWOOD.Botany.ButtonTitle",
      icon: "fas fa-seedling",
      button: true,
      visible: true,
      order: 7,
      onChange: () => openGarden()
    };
  });

  Hooks.once("ready", () => { _wasMember = isMember(); });
  Hooks.on("renderItemSheet5e", injectGardenFields);
}
