/**
 * Generates the alchemy compendium source (packs/_source/alchemy): the
 * portable tools, the liquids and the failed potion.
 *
 * Run `node tools/generate-alchemy-pack.mjs`, then `npm run build:packs`.
 * Ids are derived from the item keys, so reruns overwrite in place.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TOOL_IMG } from "../scripts/alchemy/tools.mjs";
import { ALL_RECIPES, recipeKey } from "../scripts/alchemy/brewing.mjs";
import { EFFECT_BY_ID } from "../scripts/alchemy/effects.mjs";
import { INGREDIENT_BY_ID } from "../scripts/alchemy/ingredients.mjs";

const MODULE_ID = "fimblewood-academy";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "packs", "_source", "alchemy");
const stableId = (key) => createHash("sha1").update(`${MODULE_ID}:${key}`).digest("hex").slice(0, 16);

/** [key, name, img, gp, rarity, lootType, flags, weight, description] */
const ITEMS = [
  ["reisekessel", "Reisekessel", TOOL_IMG.reisekessel, 10, "common", "gear", { alchemyTool: "reisekessel" }, 5,
    "Ein kleiner Kessel für unterwegs. Damit lässt sich überall ein Trank nach dem anderen brauen."],
  ["kelle", "Kelle", TOOL_IMG.kelle, 2, "common", "gear", { alchemyTool: "kelle" }, 1,
    "Zum Abmessen von Wasser, Öl und anderen Flüssigkeiten in Bechern. Ohne Kelle kommt keine Flüssigkeit in den Kessel."],
  ["moerser", "Mörser", TOOL_IMG.moerser, 5, "common", "gear", { alchemyTool: "moerser" }, 2,
    "Mörser und Stößel. Damit werden Zutaten gemahlen."],
  ["oel", "Becher Öl", "icons/containers/kitchenware/jug-clay-brown-sealed.webp", 0.1, "common", "material", { liquid: "oil" }, 1,
    "Ein Becher Öl für die Alchemie. Erhitzen lässt es sich nur im Ölbad."],
  ["mondtau", "Mondtau", "icons/consumables/potions/bottle-round-ring-teal.webp", 50, "rare", "material", { liquid: "mondtau" }, 0.5,
    "Ein Becher schimmernder Tau. Woher er stammt, weiß niemand so genau."],
  ["misslungen", "Misslungener Trank", "icons/tools/laboratory/bowl-liquid-black.webp", 0, "common", "junk", { role: "failedPotion" }, 0.5,
    "Ein trüber, übel riechender Schlamm. Hier ist etwas schiefgegangen."]
];

function price(gp) {
  if (gp >= 1) return { value: gp, denomination: "gp" };
  return { value: Math.round(gp * 10), denomination: "sp" };
}

mkdirSync(DIR, { recursive: true });
for (const f of readdirSync(DIR)) if (f.endsWith(".json")) rmSync(path.join(DIR, f));

let sort = 0;
for (const [key, name, img, gp, rarity, lootType, flags, weight, text] of ITEMS) {
  const id = stableId(`alchemy:${key}`);
  const doc = {
    _id: id,
    name,
    type: "loot",
    img,
    system: {
      description: { value: `<p>${text}</p>`, chat: "" },
      quantity: 1,
      weight: { value: weight, units: "lb" },
      price: price(gp),
      rarity,
      type: { value: lootType, subtype: "" },
      source: { custom: "Fimblewood Academy Alchemie" }
    },
    effects: [],
    folder: null,
    sort: (sort += 100),
    ownership: { default: 0 },
    flags: { [MODULE_ID]: flags },
    _key: `!items!${id}`
  };
  writeFileSync(path.join(DIR, `${id}.json`), `${JSON.stringify(doc, null, 2)}\n`, "utf8");
}
console.log(`Wrote ${ITEMS.length} items to ${path.relative(ROOT, DIR)}`);

/* -------------------------------------------- */
/*  Recipe items (packs/_source/alchemy-recipes)  */
/* -------------------------------------------- */

const RECIPE_DIR = path.join(ROOT, "packs", "_source", "alchemy-recipes");
const TIER_LABEL = ["I", "II", "III"];
const TIER_RARITY = ["common", "uncommon", "rare"];
const TIER_PRICE = [25, 75, 250];
const TIER_IMG = ["icons/sundries/scrolls/scroll-rolled-tan.webp", "icons/sundries/scrolls/scroll-bound-green.webp", "icons/sundries/scrolls/scroll-bound-gold.webp"];
const LIQUID = { water: "Wasser", oil: "Öl", mondtau: "Mondtau" };
const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

mkdirSync(RECIPE_DIR, { recursive: true });
for (const f of readdirSync(RECIPE_DIR)) if (f.endsWith(".json")) rmSync(path.join(RECIPE_DIR, f));

sort = 0;
for (const r of ALL_RECIPES) {
  const effect = EFFECT_BY_ID.get(r.effectId);
  const key = recipeKey(r.effectId, r.tier, r.variant);
  const id = stableId(`recipe:${key}`);
  const title = [effect.name, effect.maxTier > 1 ? `Stufe ${TIER_LABEL[r.tier - 1]}` : null, effect.variants.length > 1 ? `Variante ${r.variant + 1}` : null].filter(Boolean).join(", ");
  const parts = [...r.items].map(([k, qty]) => {
    const [ingId, prep] = k.split("|");
    const ing = INGREDIENT_BY_ID.get(ingId);
    return `${qty}× ${prep === "g" ? ing.groundName : ing.name}`;
  });
  const cups = ["water", "oil", "mondtau"].filter((l) => r[l]).map((l) => `${r[l]} Becher ${LIQUID[l]}`);
  const gear = [r.tier === 2 ? "Destillierapparat" : null, r.tier === 3 ? "Athanor" : null, r.oil ? "Ölbad" : null, cups.length ? "Kelle" : null].filter(Boolean);
  const description = [
    `<p><strong>Rezept: ${escHtml(title)}</strong></p>`,
    `<p>${escHtml(parts.join(" + "))}${cups.length ? `; ${escHtml(cups.join(", "))}` : ""}</p>`,
    gear.length ? `<p>Ausrüstung: ${escHtml(gear.join(", "))}.</p>` : "",
    "<p><em>Kommt das Rezept in ein Inventar, steht es sofort im Rezeptbuch des Charakters. Das Blatt bleibt erhalten und kann weitergegeben werden.</em></p>"
  ].join("");
  const t = r.tier - 1;
  const doc = {
    _id: id,
    name: `Rezept: ${title}`,
    type: "loot",
    img: TIER_IMG[t],
    system: {
      description: { value: description, chat: "" },
      quantity: 1,
      weight: { value: 0, units: "lb" },
      price: { value: TIER_PRICE[t], denomination: "gp" },
      rarity: TIER_RARITY[t],
      type: { value: "treasure", subtype: "" },
      source: { custom: "Fimblewood Academy Alchemie" }
    },
    effects: [],
    folder: null,
    sort: (sort += 100),
    ownership: { default: 0 },
    flags: { [MODULE_ID]: { role: "recipe", recipe: key } },
    _key: `!items!${id}`
  };
  writeFileSync(path.join(RECIPE_DIR, `${id}.json`), `${JSON.stringify(doc, null, 2)}\n`, "utf8");
}
console.log(`Wrote ${ALL_RECIPES.length} recipe items to ${path.relative(ROOT, RECIPE_DIR)}`);
