/**
 * Fimblewood Academy — Alchemy potion effects and recipes
 *
 * Every effect has up to three strength tiers (I/II/III = common/uncommon/rare
 * potion). The tier changes the recipe:
 *
 *   - Tier I is the base recipe (one or more variants).
 *   - Tier II adds one rarer ingredient (`boosts[0]`), tier III adds both
 *     (`boosts[0]` and `boosts[1]`, the latter rare or very rare).
 *   - The liquid is given in cups ("Becher") of water and oil; every tier adds
 *     one cup of each liquid the recipe uses.
 *   - Magical potions need powdered mana crystals: 1, 3 and 6 for tiers I-III.
 *
 * The recipes are for the GM; the players are meant to find them out
 * themselves, so nothing in the player-facing items spells them out.
 * Everything here is PROVISIONAL groundwork for the brewing workshop.
 */

export const TIER_RARITY = ["common", "uncommon", "rare"];

/** Powdered mana crystals needed per tier (index 0 = tier I) by magical potions. */
export const MANA_PER_TIER = [1, 3, 6];
export const MANA_INGREDIENT = "manastaub";

const WATER_ONLY = [2, 0];
const WATER_OIL = [1, 2];

/**
 * [id, name, pc, maxTier, magical, [water, oil], [boostII, boostIII], variants]
 * `[water, oil]` are the cups of tier I; a variant is a list of [ingredientId, qty].
 */
const ROWS = [
  ["heilung", "Heilung", "Healing", 3, true, WATER_ONLY, ["lebensblatt", "lebenskristall"], [[["erdwurz", 2], ["sumpfling", 1]], [["wasserbluete", 1], ["golddorn", 1]]]],
  ["gift", "Gift", "Poisoning", 3, false, WATER_ONLY, ["seltsampilz", "grabtruffel"], [[["erdwurz", 2], ["feuerglocke", 1]]]],
  ["feuer", "Feuer", "Fire", 3, true, [1, 1], ["flammenkraut", "feuercitrin"], [[["feuerglocke", 3], ["windbluete", 1]]]],
  ["frost", "Frost", "Frost", 3, true, WATER_ONLY, ["eisfrucht", "frostsaphir"], [[["wasserbluete", 3], ["erdwurz", 1]]]],
  ["staerke", "Stärke", "Strength", 3, true, WATER_ONLY, ["wirrkraut", "greifwurzel"], [[["erdwurz", 4]]]],
  ["schnelligkeit", "Schnelligkeit", "Swiftness", 3, true, WATER_ONLY, ["federbluete", "flauschbluete"], [[["windbluete", 4]]]],
  ["geschick", "Geschick", "Dexterity", 3, true, WATER_ONLY, ["wirrkraut", "flauschbluete"], [[["wasserbluete", 4], ["windbluete", 1]]]],
  ["licht", "Licht", "Light", 3, true, [2, 1], ["schwefelporling", "feuercitrin"], [[["feuerglocke", 3], ["windbluete", 1]], [["feuerglocke", 2], ["feuercitrin", 1]]]],
  ["blitz", "Blitz", "Lightning", 3, true, [2, 1], ["donnerdistel", "wolkenkristall"], [[["windbluete", 4], ["wasserbluete", 2]], [["donnerdistel", 3], ["windbluete", 1]]]],
  ["mana", "Mana", "Mana", 3, true, WATER_ONLY, ["traumruebe", "arkankristall"], [[["schattenpfifferling", 3]], [["windbluete", 3], ["wasserbluete", 2]]]],
  ["schlaf", "Schlaf", "Sleep", 3, true, [3, 0], ["lebensblatt", "hexenpilz"], [[["wasserbluete", 3], ["lebensblatt", 1]]]],
  ["verlangsamung", "Verlangsamung", "Slowness", 3, true, WATER_ONLY, ["seltsampilz", "greifwurzel"], [[["lebensblatt", 1], ["schlammpilz", 1], ["stinkpilz", 1], ["druidenrosmarin", 1]]]],
  ["wildes-wachstum", "Wildes Wachstum", "Wild Growth", 3, true, WATER_ONLY, ["lebensblatt", "greifwurzel"], [[["erdwurz", 3], ["wasserbluete", 1], ["windbluete", 1]]]],
  ["steinhaut", "Steinhaut", "Stone Skin", 3, true, [2, 1], ["schlammpilz", "erdpyrit"], [[["erdwurz", 3], ["stinkpilz", 1], ["feuerglocke", 1]]]],
  ["explosion", "Explosion", "Explosion", 3, false, [1, 2], ["schwefelporling", "magmamorchel"], [[["wahnpilz", 4]], [["windbluete", 3], ["feuerglocke", 3]]]],
  ["raserei", "Raserei", "Rage", 3, true, [1, 2], ["blutdorn", "magmamorchel"], [[["wahnpilz", 5], ["feuerglocke", 1], ["windbluete", 1], ["wasserbluete", 1]]]],
  ["charme", "Charme", "Charm", 3, true, WATER_ONLY, ["lustpilz", "flauschbluete"], [[["wahnpilz", 1], ["federbluete", 1], ["schwefelporling", 1], ["feuerglocke", 1]]]],
  ["begierde", "Begierde", "Libido", 3, true, WATER_ONLY, ["lustpilz", "blutrubin"], [[["feuerglocke", 6], ["erdwurz", 2]]]],
  ["saeure", "Säure", "Acid", 3, false, [1, 1], ["schlammpilz", "grabtruffel"], [[["stinkpilz", 1], ["feuerglocke", 1], ["dryadensattel", 1]]]],
  ["unsichtbarkeit", "Unsichtbarkeit", "Invisibility", 3, true, [2, 1], ["nebelschirmling", "regenbogenkappe"], [[["windbluete", 5], ["wasserbluete", 2], ["hexenpilz", 2]]]],
  ["levitation", "Levitation", "Levitation", 3, true, [3, 0], ["federbluete", "wolkenkristall"], [[["wahnpilz", 1], ["windbluete", 1], ["hexenpilz", 1]], [["nebelschirmling", 6], ["wolkenkristall", 1]]]],
  ["halluzination", "Halluzination", "Hallucinations", 3, true, [3, 0], ["seltsampilz", "regenbogenkappe"], [[["windbluete", 5], ["wasserbluete", 5]]]],
  ["magische-sicht", "Magische Sicht", "Magical Vision", 3, true, WATER_ONLY, ["traumruebe", "arkankristall"], [[["wasserbluete", 3], ["schattenpfifferling", 2], ["hexenpilz", 1]]]],
  ["nekromantie", "Nekromantie", "Necromancy", 3, true, WATER_ONLY, ["seltsampilz", "blutrubin"], [[["grabtruffel", 2], ["schattenpfifferling", 2]]]],
  ["fluch", "Fluch", "Curse", 1, true, WATER_ONLY, [null, null], [[["schlammpilz", 1], ["stinkpilz", 1], ["druidenrosmarin", 1], ["seltsampilz", 1]]]],
  ["furcht", "Furcht", "Fear", 3, true, WATER_ONLY, ["nebelschirmling", "hexenpilz"], [[["flammenkraut", 1], ["blutdorn", 1], ["grabtruffel", 1], ["greifwurzel", 1]]]],
  ["vergroesserung", "Vergrößerung", "Enlargement", 3, true, WATER_ONLY, ["haarbanane", "feuercitrin"], [[["flammenkraut", 1], ["blutdorn", 1], ["lustpilz", 1], ["magmamorchel", 1]]]],
  ["bindung", "Bindung", "Gluing", 1, true, WATER_ONLY, [null, null], [[["gutbeere", 1], ["haarbanane", 1], ["golddorn", 1], ["sumpfling", 1]]]],
  ["antimagie", "Antimagie", "Anti-Magic", 3, true, WATER_OIL, ["schattenpfifferling", "arkankristall"], [[["traumruebe", 1], ["federbluete", 1], ["zauberbluete", 1], ["hexenpilz", 1]]]],
  ["feuerschutz", "Feuerschutz", "Fire Protection", 3, true, WATER_OIL, ["eisfrucht", "lebenskristall"], [[["dornstock", 4], ["frostsaphir", 2]]]],
  ["giftschutz", "Giftschutz", "Poison Protection", 3, true, WATER_OIL, ["heilerheide", "greifwurzel"], [[["gutbeere", 5], ["haarbanane", 2], ["dryadensattel", 1]]]],
  ["saeureschutz", "Säureschutz", "Acid Protection", 3, true, WATER_OIL, ["eisfrucht", "frostsaphir"], [[["heilerheide", 2], ["erdwurz", 2], ["kaelteblatt", 1]]]],
  ["blitzschutz", "Blitzschutz", "Lightning Protection", 3, true, WATER_OIL, ["druidenrosmarin", "erdpyrit"], [[["erdwurz", 4], ["schlammpilz", 2], ["feuerglocke", 1]]]]
];

export const EFFECTS = ROWS.map(([id, name, pc, maxTier, magical, [water, oil], boosts, variants]) => ({
  id, name, pc, maxTier, magical, water, oil, boosts,
  rarities: TIER_RARITY.slice(0, maxTier),
  variants: variants.map((v) => v.map(([ingredient, qty]) => ({ ingredient, qty }))),
  provisional: true
}));

export const EFFECT_BY_ID = new Map(EFFECTS.map((e) => [e.id, e]));

/**
 * The complete recipe of an effect at `tier` (1-3) for one of its variants:
 * the variant's ingredients plus the tier's rarer ingredients, the cups of
 * water and oil, and the powdered mana crystals a magical potion needs.
 */
export function tierRecipe(effect, tier, variant = 0) {
  const t = Math.max(1, Math.min(effect.maxTier, tier));
  const ingredients = (effect.variants[variant] ?? effect.variants[0]).map((x) => ({ ...x }));
  for (let i = 0; i < t - 1; i++) {
    const boost = effect.boosts[i];
    if (boost) ingredients.push({ ingredient: boost, qty: 1 });
  }
  return {
    ingredients,
    water: effect.water > 0 ? effect.water + (t - 1) : 0,
    oil: effect.oil > 0 ? effect.oil + (t - 1) : 0,
    mana: effect.magical ? MANA_PER_TIER[t - 1] : 0
  };
}
