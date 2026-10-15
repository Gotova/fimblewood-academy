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

/** Adds a plant picker to seed items, so the GM can say which plant a seed grows. */
function injectSeedPlantPicker(app, html) {
  if (!game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html[0];
  if (!root) return;
  root.querySelector(".fw-botany-seed-field")?.remove();

  const item = app.document ?? app.item;
  if (item?.type !== "loot" || item.system.type?.value !== "seed") return;

  const current = item.getFlag(MODULE_ID, "plantId") ?? "";
  const i18n = (k) => game.i18n.localize(`FIMBLEWOOD.Botany.${k}`);
  const options = PLANTS.map((p) =>
    `<option value="${p.id}" ${p.id === current ? "selected" : ""}>${foundry.utils.escapeHTML(p.name)}</option>`
  ).join("");

  const wrap = document.createElement("fieldset");
  wrap.className = "fimblewood-jukebox-source-field fw-botany-seed-field";
  wrap.innerHTML = `
    <legend>${i18n("SeedField.Legend")}</legend>
    <select class="fw-botany-seed-picker">
      <option value="">${i18n("SeedField.None")}</option>
      ${options}
    </select>`;
  (root.querySelector("form") ?? root).appendChild(wrap);

  wrap.querySelector("select").addEventListener("change", async (event) => {
    const plantId = event.currentTarget.value;
    if (plantId && PLANT_BY_ID.has(plantId)) await item.setFlag(MODULE_ID, "plantId", plantId);
    else await item.unsetFlag(MODULE_ID, "plantId");
  });
}

export function registerBotany() {
  registerBotanyData(refresh, BotanyMembersApp);

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
  Hooks.on("renderItemSheet5e", injectSeedPlantPicker);
}
