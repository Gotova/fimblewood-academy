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
import { EFFECTS } from "../scripts/alchemy/effects.mjs";
import { PLANTS } from "../scripts/botany/plants.mjs";

const MODULE_ID = "fimblewood-academy";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ITEM_DIR = path.join(ROOT, "packs", "_source", "botany");
const JOURNAL_DIR = path.join(ROOT, "packs", "_source", "botany-journal");
const SEED_IMG = "icons/consumables/plants/sprout-seed-yellow-green.webp";

const RARITY_LABEL = { common: "Gewöhnlich", uncommon: "Ungewöhnlich", rare: "Selten", veryRare: "Sehr selten" };
const KIND_USE = {
  herb: "Trankkraut", mushroom: "Trankpilz", food: "Nahrung", flower: "Zierpflanze"
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

/** Effects (and the recipes) an ingredient shows up in. */
function usedIn(ingredientId) {
  return EFFECTS.filter((e) => e.recipes.some((r) => r.some((x) => x.ingredient === ingredientId)));
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
<p>Im Botanikclub-Garten („Mein Garten“) einpflanzen. Reift in <strong>${plant.growthDays} Tagen</strong> und bringt bei der Ernte ${min}–${max} Stück.</p>`;
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
  const effects = usedIn(ing.id);
  const pc = ing.pc ? ` <em>(Vorbild: ${esc(ing.pc)})</em>` : "";
  const uses = effects.length
    ? `<p>Verwendung in Tränken: ${effects.map((e) => esc(e.name)).join(", ")}.</p>`
    : "";
  const desc = `<p><strong>${esc(ing.name)}</strong> — ${KIND_USE[ing.kind] ?? ing.kind}, ${RARITY_LABEL[ing.rarity]}.${pc}</p>${uses}`;
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
    `<tr><td>${esc(p.name)}</td><td>${RARITY_LABEL[p.rarity]}</td><td>${p.growthDays} Tage</td><td>${p.yield[0]}–${p.yield[1]}</td></tr>`
  ).join("");
  return `<table><thead><tr><th>Pflanze</th><th>Seltenheit</th><th>Reifezeit</th><th>Ertrag</th></tr></thead><tbody>${rows}</tbody></table>`;
}

const overview = `
<p>Willkommen im Botanikclub! In <strong>Mein Garten</strong> (Fimblewood-Steuerung, oben links) pflanzt du Samen aus deinem Inventar in dein Beet.</p>
<ul>
<li><strong>Reife:</strong> steigt mit jedem Tag, der vergeht. Erst bei 100 % bringt die Ernte etwas.</li>
<li><strong>HP:</strong> Wird eine Pflanze vernachlässigt, verliert sie HP. Bei 0 HP ist sie eingegangen und wächst nicht weiter. Wie gut du dich kümmerst, beurteilt die Spielleitung.</li>
<li><strong>Ernte:</strong> Vor der Reife darfst du die Pflanze entfernen, bekommst dann aber nichts. Nach der Ernte ist das Beet wieder frei.</li>
</ul>
<p>Es gibt Trankkräuter und Pilze für die Alchemie, Nahrung und Zierpflanzen. Die Rezepte unten verraten, was sich aus den Zutaten brauen lässt. Die Mengen sind ungefähre Richtwerte.</p>`;

const pages = [page("overview", "Der Botanikclub", overview, 100)];
let pageSort = 100;
for (const kind of ["herb", "mushroom", "food", "flower"]) {
  pages.push(page(`plants:${kind}`, KIND_LABELS[kind], plantTable(kind), (pageSort += 100)));
}

const tierRow = (e) => e.rarities.map((r, i) => `${["I", "II", "III"][i]}: ${RARITY_LABEL[r]}`).join(", ");
const recipeHtml = (e) => {
  const recipes = e.recipes.map((r) =>
    `<li>${r.map((x) => `${x.qty}× ${esc(INGREDIENT_BY_ID.get(x.ingredient).name)}`).join(" + ")}</li>`
  ).join("");
  return `<h3>${esc(e.name)} <small>(${e.base === "oil" ? "Öl-Basis" : "Wasser-Basis"})</small></h3>
<p>Stufen — ${tierRow(e)}</p><ul>${recipes}</ul>`;
};
pages.push(page("recipes", "Trankrezepte",
  `<p>Ungefähre Rezepte, abgeleitet vom Vorbild Potion Craft. Die genaue Zubereitung folgt mit der Alchemie-Werkstatt.</p>${EFFECTS.map(recipeHtml).join("")}`,
  (pageSort += 100)));

const journal = {
  _id: stableId("journal:kraeuterkunde"),
  name: "Kräuterkunde des Botanikclubs",
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
