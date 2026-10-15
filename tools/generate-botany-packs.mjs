/**
 * Generates the Botany Club compendium sources under packs/_source from the
 * catalogues in scripts/ (the single source of truth):
 *
 *   packs/_source/botany          seed + harvest items for every plant
 *   packs/_source/botany-journal  the "Kräuterkunde" recipe book
 *
 * Run `node tools/generate-botany-packs.mjs`, then `npm run build:packs`.
 * Ids are derived from the plant/effect ids, so reruns overwrite in place.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { INGREDIENTS, INGREDIENT_BY_ID, KIND_LABELS } from "../scripts/alchemy/ingredients.mjs";
import { EFFECTS, tierRecipe, MANA_INGREDIENT } from "../scripts/alchemy/effects.mjs";
import { PLANTS } from "../scripts/botany/plants.mjs";

const MODULE_ID = "fimblewood-academy";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ITEM_DIR = path.join(ROOT, "packs", "_source", "botany");
const JOURNAL_DIR = path.join(ROOT, "packs", "_source", "botany-journal");
const SEED_IMG = "icons/consumables/plants/sprout-seed-yellow-green.webp";

const RARITY_LABEL = { common: "Gewöhnlich", uncommon: "Ungewöhnlich", rare: "Selten", veryRare: "Sehr selten" };
const KIND_USE = {
  herb: "Trankkraut", mushroom: "Trankpilz", food: "Nahrung", flower: "Zierpflanze", crystal: "Kristall"
};

function stableId(key) {
  return createHash("sha1").update(`${MODULE_ID}:${key}`).digest("hex").slice(0, 16);
}

function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function price(gp) {
  if (gp >= 1) return { value: Number(gp.toFixed(2)), denomination: "gp" };
  const sp = Math.round(gp * 10 * 100) / 100;
  if (Number.isInteger(sp) && sp >= 1) return { value: sp, denomination: "sp" };
  return { value: Math.max(1, Math.round(gp * 100)), denomination: "cp" };
}

function item({ id, name, img, description, gp, rarity, lootType, flags, sort }) {
  return {
    _id: id,
    name,
    type: "loot",
    img,
    system: {
      description: { value: description, chat: "" },
      quantity: 1,
      weight: { value: 0, units: "lb" },
      price: price(gp),
      rarity,
      type: { value: lootType, subtype: "" },
      source: { custom: "Fimblewood Academy Botanikclub" }
    },
    effects: [],
    folder: null,
    sort,
    ownership: { default: 0 },
    flags: { [MODULE_ID]: flags },
    _key: `!items!${id}`
  };
}

function seedItem(plant, ing, sort) {
  const [min, max] = plant.yield;
  const desc = `<p>Samen: <strong>${esc(plant.name)}</strong> (${KIND_USE[ing.kind]}).</p>
<p>Im Botanikclub-Garten („Mein Garten“) einpflanzen. Wie lange sie braucht, bis sie reif ist, weiß die Spielleitung. Bei der Ernte bringt sie ${min}–${max} Stück.</p>`;
  return item({
    id: stableId(`seed:${plant.id}`),
    name: `${plant.name}-Samen`,
    img: SEED_IMG,
    description: desc,
    gp: plant.seedGp,
    rarity: "common",
    lootType: "seed",
    flags: { plantId: plant.id, role: "seed" },
    sort
  });
}

function harvestItem(ing, sort) {
  const desc = `<p><strong>${esc(ing.name)}</strong> — ${KIND_USE[ing.kind] ?? ing.kind}, ${RARITY_LABEL[ing.rarity]}.</p>`;
  return item({
    id: stableId(`harvest:${ing.id}`),
    name: ing.name,
    img: ing.img,
    description: desc,
    gp: ing.gp,
    rarity: ing.rarity,
    lootType: "material",
    flags: { ingredientId: ing.id, role: "harvest" },
    sort
  });
}

function clearDir(dir) {
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (f.endsWith(".json")) rmSync(path.join(dir, f));
}

function writeJson(dir, doc) {
  writeFileSync(path.join(dir, `${doc._id}.json`), `${JSON.stringify(doc, null, 2)}\n`, "utf8");
}

/* -------------------------------------------- */
/*  Items                                        */
/* -------------------------------------------- */

clearDir(ITEM_DIR);
let sort = 0;
let count = 0;
for (const plant of PLANTS) {
  const ing = INGREDIENT_BY_ID.get(plant.ingredientId);
  writeJson(ITEM_DIR, seedItem(plant, ing, (sort += 100)));
  writeJson(ITEM_DIR, harvestItem(ing, (sort += 100)));
  count += 2;
}
// Crystals cannot be planted, but they are ingredients: ship them as loot too.
for (const ing of INGREDIENTS.filter((i) => !i.growable)) {
  writeJson(ITEM_DIR, harvestItem(ing, (sort += 100)));
  count += 1;
}
console.log(`Wrote ${count} items to ${path.relative(ROOT, ITEM_DIR)}`);

/* -------------------------------------------- */
/*  Journal                                      */
/* -------------------------------------------- */

function page(key, name, content, sortValue) {
  return {
    _id: stableId(`page:${key}`),
    name,
    type: "text",
    title: { show: true, level: 1 },
    text: { format: 1, content },
    sort: sortValue,
    ownership: { default: -1 },
    flags: {}
  };
}

function plantTable(kind) {
  const rows = PLANTS.filter((p) => p.kind === kind).map((p) =>
    `<tr><td>${esc(p.name)}</td><td>${RARITY_LABEL[p.rarity]}</td><td>${p.defaultGrowthDays} Tage</td><td>${p.yield[0]}–${p.yield[1]}</td></tr>`
  ).join("");
  return `<table><thead><tr><th>Pflanze</th><th>Seltenheit</th><th>Reifezeit (Standard)</th><th>Ertrag</th></tr></thead><tbody>${rows}</tbody></table>`;
}

const overview = `
<p><strong>Nur für die Spielleitung.</strong> Die Spieler sollen die Rezepte selbst herausfinden. Dieses Journal ist deshalb für sie unsichtbar, und die Items im Kompendium verraten keine Rezepte.</p>
<ul>
<li><strong>Reifezeit:</strong> Standard sind 5 Tage (gewöhnlich), 8 (ungewöhnlich), 12 (selten) und 30 (sehr selten). Du änderst sie pro Pflanze unter Moduleinstellungen → Fimblewood Academy → „Reifezeiten der Pflanzen“.</li>
<li><strong>Rezepte:</strong> Die Stufe verändert das Rezept. Stufe II braucht eine zusätzliche, seltenere Zutat, Stufe III zwei. Dazu kommen Becher Wasser und Öl (je Stufe einer mehr) und bei magischen Tränken pulverisierte Manakristalle: 1, 3 und 6 für Stufe I bis III.</li>
<li><strong>Nicht magisch</strong> sind nur Gift, Säure und Explosion. Sie brauchen keinen Manastaub.</li>
</ul>`;

const pages = [page("overview", "Hinweise für die Spielleitung", overview, 100)];
let pageSort = 100;
for (const kind of ["herb", "mushroom", "food", "flower"]) {
  pages.push(page(`plants:${kind}`, KIND_LABELS[kind], plantTable(kind), (pageSort += 100)));
}

const ingName = (id) => esc(INGREDIENT_BY_ID.get(id)?.name ?? id);
const cups = (n, label) => (n > 0 ? `${n} Becher ${label}` : "");
function recipeHtml(e) {
  const variants = e.variants.length > 1;
  const items = [];
  for (let tier = 1; tier <= e.maxTier; tier++) {
    for (let v = 0; v < e.variants.length; v++) {
      const r = tierRecipe(e, tier, v);
      const parts = r.ingredients.map((x) => `${x.qty}× ${ingName(x.ingredient)}`);
      if (r.mana) parts.push(`${r.mana}× ${ingName(MANA_INGREDIENT)}`);
      const liquids = [cups(r.water, "Wasser"), cups(r.oil, "Öl")].filter(Boolean).join(", ");
      const label = `Stufe ${["I", "II", "III"][tier - 1]} (${RARITY_LABEL[e.rarities[tier - 1]]})${variants ? `, Variante ${v + 1}` : ""}`;
      items.push(`<li><strong>${label}:</strong> ${parts.join(" + ")}; ${liquids}</li>`);
    }
  }
  return `<h3>${esc(e.name)}${e.magical ? "" : " <small>(nicht magisch)</small>"}</h3><ul>${items.join("")}</ul>`;
}
pages.push(page("recipes", "Trankrezepte",
  `<p>Alle Rezepte für die Spielleitung. Mengen in Bechern; die Werte sind Richtwerte und noch nicht ausbalanciert.</p>${EFFECTS.map(recipeHtml).join("")}`,
  (pageSort += 100)));

const journal = {
  _id: stableId("journal:kraeuterkunde"),
  name: "Botanikclub: Rezepte (nur Spielleitung)",
  pages,
  folder: null,
  sort: 0,
  ownership: { default: 0 },
  flags: {}
};
journal._key = `!journal!${journal._id}`;
for (const p of pages) p._key = `!journal.pages!${journal._id}.${p._id}`;

clearDir(JOURNAL_DIR);
writeJson(JOURNAL_DIR, journal);
console.log(`Wrote the journal (${pages.length} pages) to ${path.relative(ROOT, JOURNAL_DIR)}`);
