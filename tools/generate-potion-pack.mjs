/**
 * Generates the potion compendium source (packs/_source/potions) from the
 * effect catalogue and the potion mechanics in scripts/alchemy/. One potion
 * per effect and tier, each with its activity and Active Effect.
 *
 * Run `node tools/generate-potion-pack.mjs`, then `npm run build:packs`.
 * Ids are derived from effect, tier and part, so reruns overwrite in place.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EFFECT_BY_ID } from "../scripts/alchemy/effects.mjs";
import { POTION_EFFECTS, buildPotion } from "../scripts/alchemy/potions.mjs";

const MODULE_ID = "fimblewood-academy";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "packs", "_source", "potions");

const stableId = (key) => createHash("sha1").update(`${MODULE_ID}:${key}`).digest("hex").slice(0, 16);

mkdirSync(DIR, { recursive: true });
for (const f of readdirSync(DIR)) if (f.endsWith(".json")) rmSync(path.join(DIR, f));

let sort = 0;
let count = 0;
for (const effectId of POTION_EFFECTS) {
  const maxTier = EFFECT_BY_ID.get(effectId).maxTier;
  for (let tier = 1; tier <= maxTier; tier++) {
    const makeId = (label) => stableId(`potion:${effectId}:${tier}:${label}`);
    const { item } = buildPotion(effectId, tier, makeId);
    const id = makeId("item");
    const doc = { _id: id, ...item, sort: (sort += 100), _key: `!items!${id}` };
    for (const effect of doc.effects) effect._key = `!items.effects!${id}.${effect._id}`;
    writeFileSync(path.join(DIR, `${id}.json`), `${JSON.stringify(doc, null, 2)}\n`, "utf8");
    count += 1;
  }
}
console.log(`Wrote ${count} potions to ${path.relative(ROOT, DIR)}`);
