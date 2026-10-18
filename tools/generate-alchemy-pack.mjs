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
