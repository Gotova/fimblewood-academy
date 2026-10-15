/**
 * Fimblewood Academy — Alchemy potion effects and recipes
 *
 * Approximate Potion Craft recipes, expressed with the ingredient ids from
 * ingredients.mjs. `base` is the liquid the potion is brewed in (water, or
 * oil for the advanced effects). `maxTier` is how many strength tiers the
 * effect has; tier I/II/III map to the D&D rarities common/uncommon/rare.
 * Recipes are PROVISIONAL groundwork for the brewing workshop.
 */

export const TIER_RARITY = ["common", "uncommon", "rare"];

/** [id, name, pc, maxTier, base, recipes] — a recipe is a list of [ingredientId, qty]. */
const ROWS = [
  ["heilung", "Heilung", "Healing", 3, "water", [[["erdwurz", 2], ["sumpfling", 1]], [["wasserbluete", 1], ["golddorn", 1]]]],
  ["gift", "Gift", "Poisoning", 3, "water", [[["erdwurz", 2], ["feuerglocke", 1]]]],
  ["feuer", "Feuer", "Fire", 3, "water", [[["feuerglocke", 3], ["windbluete", 1]]]],
  ["frost", "Frost", "Frost", 3, "water", [[["wasserbluete", 3], ["erdwurz", 1]]]],
  ["staerke", "Stärke", "Strength", 3, "water", [[["erdwurz", 4]]]],
  ["schnelligkeit", "Schnelligkeit", "Swiftness", 3, "water", [[["windbluete", 4]]]],
  ["geschick", "Geschick", "Dexterity", 3, "water", [[["wasserbluete", 4], ["windbluete", 1]]]],
  ["licht", "Licht", "Light", 3, "water", [[["feuerglocke", 3], ["windbluete", 1]], [["feuerglocke", 2], ["feuercitrin", 1]]]],
  ["blitz", "Blitz", "Lightning", 3, "water", [[["windbluete", 4], ["wasserbluete", 2]], [["donnerdistel", 3], ["windbluete", 1]]]],
  ["mana", "Mana", "Mana", 3, "water", [[["schattenpfifferling", 3]], [["windbluete", 3], ["wasserbluete", 2]]]],
  ["schlaf", "Schlaf", "Sleep", 3, "water", [[["wasserbluete", 3], ["lebensblatt", 1]]]],
  ["verlangsamung", "Verlangsamung", "Slowness", 3, "water", [[["lebensblatt", 1], ["schlammpilz", 1], ["stinkpilz", 1], ["druidenrosmarin", 1]]]],
  ["wildes-wachstum", "Wildes Wachstum", "Wild Growth", 3, "water", [[["erdwurz", 3], ["wasserbluete", 1], ["windbluete", 1]]]],
  ["steinhaut", "Steinhaut", "Stone Skin", 3, "water", [[["erdwurz", 3], ["stinkpilz", 1], ["feuerglocke", 1]]]],
  ["explosion", "Explosion", "Explosion", 3, "water", [[["wahnpilz", 4]], [["windbluete", 3], ["feuerglocke", 3]]]],
  ["raserei", "Raserei", "Rage", 3, "water", [[["wahnpilz", 5], ["feuerglocke", 1], ["windbluete", 1], ["wasserbluete", 1]]]],
  ["charme", "Charme", "Charm", 3, "water", [[["wahnpilz", 1], ["federbluete", 1], ["schwefelporling", 1], ["feuerglocke", 1]]]],
  ["begierde", "Begierde", "Libido", 3, "water", [[["feuerglocke", 6], ["erdwurz", 2]]]],
  ["saeure", "Säure", "Acid", 3, "water", [[["stinkpilz", 1], ["feuerglocke", 1], ["dryadensattel", 1]]]],
  ["unsichtbarkeit", "Unsichtbarkeit", "Invisibility", 3, "water", [[["windbluete", 5], ["wasserbluete", 2], ["hexenpilz", 2]]]],
  ["levitation", "Levitation", "Levitation", 3, "water", [[["wahnpilz", 1], ["windbluete", 1], ["hexenpilz", 1]], [["nebelschirmling", 6], ["wolkenkristall", 1]]]],
  ["halluzination", "Halluzination", "Hallucinations", 3, "water", [[["windbluete", 5], ["wasserbluete", 5]]]],
  ["magische-sicht", "Magische Sicht", "Magical Vision", 3, "water", [[["wasserbluete", 3], ["schattenpfifferling", 2], ["hexenpilz", 1]]]],
  ["nekromantie", "Nekromantie", "Necromancy", 3, "water", [[["grabtruffel", 2], ["schattenpfifferling", 2]]]],
  ["fluch", "Fluch", "Curse", 1, "water", [[["schlammpilz", 1], ["stinkpilz", 1], ["druidenrosmarin", 1], ["seltsampilz", 1]]]],
  ["furcht", "Furcht", "Fear", 3, "water", [[["flammenkraut", 1], ["blutdorn", 1], ["grabtruffel", 1], ["greifwurzel", 1]]]],
  ["vergroesserung", "Vergrößerung", "Enlargement", 3, "water", [[["flammenkraut", 1], ["blutdorn", 1], ["lustpilz", 1], ["magmamorchel", 1]]]],
  ["bindung", "Bindung", "Gluing", 1, "water", [[["gutbeere", 1], ["haarbanane", 1], ["golddorn", 1], ["sumpfling", 1]]]],
  ["antimagie", "Antimagie", "Anti-Magic", 3, "oil", [[["traumruebe", 1], ["federbluete", 1], ["zauberbluete", 1], ["hexenpilz", 1]]]],
  ["feuerschutz", "Feuerschutz", "Fire Protection", 3, "oil", [[["dornstock", 4], ["frostsaphir", 2]]]],
  ["giftschutz", "Giftschutz", "Poison Protection", 3, "oil", [[["gutbeere", 5], ["haarbanane", 2], ["dryadensattel", 1]]]],
  ["saeureschutz", "Säureschutz", "Acid Protection", 3, "oil", [[["heilerheide", 2], ["erdwurz", 2], ["kaelteblatt", 1]]]],
  ["blitzschutz", "Blitzschutz", "Lightning Protection", 3, "oil", [[["erdwurz", 4], ["schlammpilz", 2], ["feuerglocke", 1]]]]
];

export const EFFECTS = ROWS.map(([id, name, pc, maxTier, base, recipes]) => ({
  id, name, pc, maxTier, base,
  rarities: TIER_RARITY.slice(0, maxTier),
  recipes: recipes.map((r) => r.map(([ingredient, qty]) => ({ ingredient, qty }))),
  provisional: true
}));

export const EFFECT_BY_ID = new Map(EFFECTS.map((e) => [e.id, e]));
