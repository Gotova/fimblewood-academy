/**
 * Fimblewood Academy — Alchemy ingredient catalogue
 *
 * One list of every ingredient (herbs, mushrooms, crystals, food, flowers),
 * shared by the Botany Club garden (which grows the growable ones) and the
 * planned alchemy workshop (which will brew with them, Potion Craft style).
 * Names are German reworkings of the Potion Craft ingredients; `pc` keeps
 * the original name as a reference.
 *
 * `alchemy` is groundwork for the brewing map and is PROVISIONAL: `element`
 * decides the direction an ingredient pushes the bottle, `reach` how far
 * (1-3). Both will be tuned when the workshop gets built.
 */

const C = "icons/consumables/";
const F = "icons/commodities/flowers/";
const G = "icons/commodities/gems/";

/** [id, name, pc, kind, rarity, gp, img, element] — all of these can be grown. */
const GROWN = [
  // Herbs
  ["erdwurz", "Erdwurz", "Terraria", "herb", "common", 1, `${C}plants/leaf-herb-green.webp`, "earth"],
  ["wasserbluete", "Wasserblüte", "Waterbloom", "herb", "common", 1, `${C}plants/lily-pad-leaf-stem.webp`, "water"],
  ["feuerglocke", "Feuerglocke", "Firebell", "herb", "common", 1, `${C}plants/thorned-dried-stem-red.webp`, "fire"],
  ["windbluete", "Windblüte", "Windbloom", "herb", "common", 1, `${F}dandelion-pod-white.webp`, "air"],
  ["heilerheide", "Heilerheide", "Healer's Heather", "herb", "common", 1, `${C}plants/sprout-leaf-herb-green.webp`, "life"],
  ["kaelteblatt", "Kälteblatt", "Coldleaf", "herb", "common", 1, `${C}plants/leaf-broad-blue.webp`, "water"],
  ["dornstock", "Dornstock", "Thornstick", "herb", "common", 1, `${C}plants/thorned-stem-brown.webp`, "earth"],
  ["wirrkraut", "Wirrkraut", "Tangleweed", "herb", "uncommon", 5, `${C}plants/dried-stem-vine-root-bramble-brown.webp`, "earth"],
  ["gutbeere", "Gutbeere", "Goodberry", "herb", "uncommon", 4, `${C}fruit/berry-stem-green.webp`, "life"],
  ["haarbanane", "Haarbanane", "Hairy Banana", "herb", "uncommon", 6, `${C}fruit/banana-ripe-yellow.webp`, "life"],
  ["golddorn", "Golddorn", "Goldthorn", "herb", "uncommon", 8, `${C}plants/thorned-curled-vine-green.webp`, "life"],
  ["blutdorn", "Blutdorn", "Bloodthorn", "herb", "uncommon", 7, `${C}plants/thorned-dried-stem-red.webp`, "fire"],
  ["traumruebe", "Traumrübe", "Dream Beet", "herb", "uncommon", 7, `${C}vegetable/root-beet-bulb-purple.webp`, "mind"],
  ["donnerdistel", "Donnerdistel", "Thunder Thistle", "herb", "uncommon", 6, `${C}plants/milkweed-stem-serrated-leaves-green.webp`, "air"],
  ["lebensblatt", "Lebensblatt", "Lifeleaf", "herb", "uncommon", 6, `${C}plants/leaf-veins-glowing-green.webp`, "life"],
  ["federbluete", "Federblüte", "Featherbloom", "herb", "uncommon", 6, `${C}plants/leaf-pink.webp`, "air"],
  ["druidenrosmarin", "Druidenrosmarin", "Druid's Rosemary", "herb", "uncommon", 5, `${C}plants/dill-herb-bundle-green.webp`, "earth"],
  ["flammenkraut", "Flammenkraut", "Flameweed", "herb", "uncommon", 7, `${C}plants/flax-leaves-spiked-bundle-orange.webp`, "fire"],
  ["eisfrucht", "Eisfrucht", "Icefruit", "herb", "uncommon", 5, `${C}fruit/berry-shiny-leaf-blue-teal.webp`, "water"],
  ["greifwurzel", "Greifwurzel", "Grasping Root", "herb", "rare", 25, `${C}vegetable/root-alien-green.webp`, "earth"],
  ["flauschbluete", "Flauschblüte", "Fluffbloom", "herb", "rare", 30, `${C}plants/leaf-hastate-white-green.webp`, "air"],
  ["zauberbluete", "Zauberblüte", "Spellbloom", "herb", "veryRare", 100, `${C}plants/leaf-elm-glowing-green.webp`, "mind"],
  // Mushrooms
  ["stinkpilz", "Stinkpilz", "Stink Mushroom", "mushroom", "common", 1, `${C}mushrooms/convex-green.webp`, "death"],
  ["dryadensattel", "Dryadensattel", "Dryad's Saddle", "mushroom", "common", 1, `${C}mushrooms/convex-tan.webp`, "earth"],
  ["wahnpilz", "Wahnpilz", "Mad Mushroom", "mushroom", "common", 1, `${C}mushrooms/mushroom-spotted-red.webp`, "fire"],
  ["schwefelporling", "Schwefelporling", "Sulphur Shelf", "mushroom", "uncommon", 5, `${C}mushrooms/conical-bell-yellow.webp`, "fire"],
  ["sumpfling", "Sumpfling", "Marshroom", "mushroom", "uncommon", 6, `${C}mushrooms/umbontae-green.webp`, "water"],
  ["schlammpilz", "Schlammpilz", "Mudshroom", "mushroom", "uncommon", 8, `${C}mushrooms/crimini-button-brown.webp`, "earth"],
  ["seltsampilz", "Seltsampilz", "Weirdshroom", "mushroom", "uncommon", 5, `${C}mushrooms/ovate-blue.webp`, "mind"],
  ["lustpilz", "Lustpilz", "Lust Mushroom", "mushroom", "uncommon", 8, `${C}mushrooms/conical-shiny-magenta-pink.webp`, "life"],
  ["nebelschirmling", "Nebelschirmling", "Foggy Parasol", "mushroom", "uncommon", 8, `${C}mushrooms/campanulate-bell-shiny-blue.webp`, "air"],
  ["schattenpfifferling", "Schattenpfifferling", "Shadow Chanterelle", "mushroom", "rare", 25, `${C}mushrooms/helm-purple-shiny.webp`, "mind"],
  ["grabtruffel", "Grabtrüffel", "Grave Truffle", "mushroom", "rare", 30, `${C}mushrooms/cluster-red-brown.webp`, "death"],
  ["hexenpilz", "Hexenpilz", "Witch Mushroom", "mushroom", "rare", 30, `${C}mushrooms/umbontae-bumpy-purple.webp`, "mind"],
  ["magmamorchel", "Magmamorchel", "Magma Morel", "mushroom", "rare", 35, `${C}mushrooms/conical-bell-orange-white.webp`, "fire"],
  ["regenbogenkappe", "Regenbogenkappe", "Rainbow Cap", "mushroom", "veryRare", 100, `${C}mushrooms/alien-spotted-blue.webp`, "mind"],
  // Food
  ["karotte", "Karotte", "", "food", "common", 0.05, `${C}vegetable/root-carrot-orange.webp`, "earth"],
  ["tomate", "Tomate", "", "food", "common", 0.05, `${C}fruit/chili-fresno-pepper-red.webp`, "fire"],
  ["kartoffel", "Kartoffel", "", "food", "common", 0.02, `${C}vegetable/root-brown-orange.webp`, "earth"],
  ["kuerbis", "Kürbis", "", "food", "common", 0.1, `${C}fruit/fruit-watermelon-whole-green.webp`, "earth"],
  ["salat", "Salat", "", "food", "common", 0.05, `${C}vegetable/lettuce-romaine-green.webp`, "water"],
  ["erdbeere", "Erdbeere", "", "food", "common", 0.1, `${F}strawberry-trio-white.webp`, "life"],
  ["zwiebel", "Zwiebel", "", "food", "common", 0.05, `${C}vegetable/onion-yellow.webp`, "earth"],
  ["gurke", "Gurke", "", "food", "common", 0.05, `${C}vegetable/cucumber-pickle-green.webp`, "water"],
  ["basilikum", "Basilikum", "", "food", "common", 0.1, `${C}plants/basil-herb-green.webp`, "life"],
  ["minze", "Minze", "", "food", "common", 0.1, `${C}plants/mint-dried-green.webp`, "water"],
  // Flowers
  ["rose", "Rose", "", "flower", "common", 0.5, `${F}rosaecia-red.webp`, "life"],
  ["tulpe", "Tulpe", "", "flower", "common", 0.2, `${F}blooms-pink.webp`, "life"],
  ["sonnenblume", "Sonnenblume", "", "flower", "common", 0.2, `${F}cornflower-gold.webp`, "fire"],
  ["lavendel", "Lavendel", "", "flower", "common", 0.5, `${F}blooms-purple.webp`, "mind"],
  ["lilie", "Lilie", "", "flower", "common", 0.5, `${F}lily-white.webp`, "water"],
  ["vergissmeinnicht", "Vergissmeinnicht", "", "flower", "common", 0.2, `${F}cornflower-blue.webp`, "mind"],
  ["mondbluete", "Mondblüte", "", "flower", "uncommon", 5, `${F}lotus-white.webp`, "mind"],
  ["orchidee", "Orchidee", "", "flower", "uncommon", 5, `${F}lotus-violet.webp`, "air"]
];

/** [id, name, pc, rarity, gp, img, element] — crystals and powders: ingredients only, they cannot be planted. */
const CRYSTALS = [
  ["erdpyrit", "Erdpyrit", "Earth Pyrite", "rare", 50, `${G}gem-rough-cushion-orange.webp`, "earth"],
  ["frostsaphir", "Frostsaphir", "Frost Sapphire", "rare", 60, `${G}gem-rough-cushion-blue.webp`, "water"],
  ["feuercitrin", "Feuercitrin", "Fire Citrine", "rare", 60, `${G}gem-rough-cushion-orange-red.webp`, "fire"],
  ["wolkenkristall", "Wolkenkristall", "Cloud Crystal", "rare", 70, `${G}gem-rough-cushion-white.webp`, "air"],
  ["arkankristall", "Arkankristall", "Arcane Crystal", "veryRare", 100, `${G}gem-rough-cushion-purple.webp`, "mind"],
  ["blutrubin", "Blutrubin", "Blood Ruby", "veryRare", 100, `${G}gem-rough-cushion-red.webp`, "life"],
  ["lebenskristall", "Lebenskristall", "Life Crystal", "veryRare", 100, `${G}gem-rough-cushion-green.webp`, "life"],
  ["manakristall", "Manakristall", "", "uncommon", 10, `${G}gem-faceted-hexagon-blue.webp`, "mind"]
];

const REACH = { common: 1, uncommon: 2, rare: 3, veryRare: 3 };

/**
 * How an ingredient has to go into the cauldron: "ground" (through the mortar)
 * or "raw". Herbs, flowers and crystals are ground; mushrooms, food and the
 * fruit-like herbs go in raw. A ground mushroom spoils the brew.
 */
const PREP_BY_KIND = { herb: "ground", flower: "ground", crystal: "ground", mushroom: "raw", food: "raw" };
const RAW_HERBS = new Set(["gutbeere", "haarbanane", "eisfrucht"]);

/** Ground forms with their own name or picture (default: "<Name> (gemahlen)", same picture). */
const GROUND_FORM = {
  manakristall: { name: "Manastaub", img: `${G}powder-raw-white.webp` }
};

function build([id, name, pc, kind, rarity, gp, img, element], growable) {
  return {
    id, name, pc, kind, rarity, gp, img, growable,
    prep: RAW_HERBS.has(id) ? "raw" : (PREP_BY_KIND[kind] ?? "raw"),
    groundName: GROUND_FORM[id]?.name ?? `${name} (gemahlen)`,
    groundImg: GROUND_FORM[id]?.img ?? img,
    alchemy: { element, reach: REACH[rarity] ?? 1, provisional: true }
  };
}

export const INGREDIENTS = [
  ...GROWN.map((row) => build(row, true)),
  ...CRYSTALS.map(([id, name, pc, rarity, gp, img, element]) => build([id, name, pc, "crystal", rarity, gp, img, element], false))
];

export const INGREDIENT_BY_ID = new Map(INGREDIENTS.map((i) => [i.id, i]));

export const KIND_LABELS = {
  herb: "Kräuter", mushroom: "Pilze", food: "Nahrung", flower: "Zierpflanzen", crystal: "Kristalle"
};
