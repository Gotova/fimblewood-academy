/**
 * Fimblewood Academy — Potion items
 *
 * Builds the dnd5e item source of a potion for an effect at a tier (I-III):
 * a consumable with an activity (heal, save or utility) and, where the effect
 * has a lasting result, an Active Effect (a status, a bonus, a resistance).
 * The compendium generator (tools/generate-potion-pack.mjs) uses it today;
 * the alchemy workshop can use it later to hand out what it brews.
 *
 * Everything is a rough D&D reading of the Potion Craft effect names, and
 * PROVISIONAL. A few potions (light, mana, magical sight, anti-magic, hallucination)
 * only carry an activity and a description: they have nothing to automate.
 *
 * The flags `potionEffect` and `potionTier` tie a potion to the garden
 * (see modifiers.mjs): Wildes Wachstum speeds up a bed by ×1.5 / ×1.75 / ×2.
 */

import { EFFECT_BY_ID, EFFECTS, TIER_RARITY } from "./effects.mjs";
import { GARDEN_EFFECTS } from "../botany/modifiers.mjs";

const MODULE_ID = "fimblewood-academy";
const MODE = { MULTIPLY: 1, ADD: 2, UPGRADE: 4 };
const TIER_PRICE = [50, 150, 500];
const TIER_LABEL = ["I", "II", "III"];
const RARITY_LABEL = { common: "Gewöhnlich", uncommon: "Ungewöhnlich", rare: "Selten" };
const ABILITY_LABEL = { str: "Stärke", dex: "Geschicklichkeit", con: "Konstitution", wis: "Weisheit" };
const DAMAGE_LABEL = {
  poison: "Gift", fire: "Feuer", cold: "Kälte", lightning: "Blitz", thunder: "Schall", acid: "Säure", necrotic: "Nekrotisch"
};
const STATUS_LABEL = {
  poisoned: "Vergiftet", unconscious: "Bewusstlos", charmed: "Bezaubert", frightened: "Verängstigt",
  restrained: "Festgesetzt", invisible: "Unsichtbar"
};

const P = "icons/consumables/potions/";
const ch = (key, mode, value) => ({ key, mode, value: String(value), priority: null });
const plus = (n) => `+${n}`;

/**
 * One entry per effect. `act`: "heal" | "hit" (save, thrown at a creature) | "buff" (self, with an effect) | "util".
 * Per-tier values are arrays [I, II, III]; `changes(t)` gets the tier index 0-2.
 */
const SPECS = {
  heilung: { img: "bottle-corked-red", act: "heal", heal: [[2, 4, 2], [4, 4, 4], [8, 4, 8]], text: "Heilt Trefferpunkte." },
  gift: { img: "bottle-conical-corked-labeled-skull-poison-green", act: "hit", ability: "con", dc: [12, 14, 16], dmg: [2, 4, 6], die: 6, type: "poison", status: "poisoned", seconds: [60, 600, 3600], text: "Ein Gift, das getrunken oder auf eine Klinge, in einen Becher oder auf ein Ziel gebracht wird." },
  feuer: { img: "bottle-bulb-corked-glowing-red", act: "hit", ability: "dex", dc: [12, 14, 16], dmg: [2, 4, 6], die: 6, type: "fire", text: "Ein Fläschchen mit flüssigem Feuer, das zerbricht, wo es hinfällt." },
  frost: { img: "bottle-conical-corked-cyan", act: "hit", ability: "con", dc: [12, 14, 16], dmg: [2, 4, 6], die: 6, type: "cold", seconds: [6, 60, 600], changes: () => [ch("system.attributes.movement.walk", MODE.MULTIPLY, 0.5)], effectName: "Eingefroren: Bewegungsrate halbiert", text: "Eisige Kälte, die das Ziel verlangsamt." },
  staerke: { img: "bottle-round-corked-orante-red", act: "buff", seconds: 3600, changes: (t) => [ch("system.abilities.str.bonuses.check", MODE.ADD, plus([2, 4, 6][t])), ch("system.abilities.str.bonuses.save", MODE.ADD, plus([2, 4, 6][t]))], effectName: "Gestärkt", text: ["+2 auf Stärkewürfe und -Rettungswürfe für 1 Stunde.", "+4 auf Stärkewürfe und -Rettungswürfe für 1 Stunde.", "+6 auf Stärkewürfe und -Rettungswürfe für 1 Stunde."] },
  schnelligkeit: { img: "bottle-round-corked-yellow", act: "buff", seconds: [600, 3600, 3600], changes: (t) => [ch("system.attributes.movement.walk", MODE.ADD, [10, 20, 30][t])], effectName: "Beschleunigt", text: ["Bewegungsrate +10 Fuß für 10 Minuten.", "Bewegungsrate +20 Fuß für 1 Stunde.", "Bewegungsrate +30 Fuß für 1 Stunde."] },
  geschick: { img: "bottle-pear-corked-pink", act: "buff", seconds: 3600, changes: (t) => [ch("system.abilities.dex.bonuses.check", MODE.ADD, plus([1, 2, 3][t])), ch("system.abilities.dex.bonuses.save", MODE.ADD, plus([1, 2, 3][t]))], effectName: "Flink", text: ["+1 auf Geschicklichkeitswürfe und -Rettungswürfe für 1 Stunde.", "+2 auf Geschicklichkeitswürfe und -Rettungswürfe für 1 Stunde.", "+3 auf Geschicklichkeitswürfe und -Rettungswürfe für 1 Stunde."] },
  licht: { img: "bottle-conical-corked-yellow", act: "util", text: ["Du strahlst 1 Stunde lang helles Licht in 20 Fuß aus (und gedämpftes in weiteren 20 Fuß).", "Du strahlst 2 Stunden lang helles Licht in 30 Fuß aus (und gedämpftes in weiteren 30 Fuß).", "Du strahlst 4 Stunden lang helles Licht in 40 Fuß aus (und gedämpftes in weiteren 40 Fuß)."] },
  blitz: { img: "flask-corked-blue-glow", act: "hit", ability: "dex", dc: [12, 14, 16], dmg: [2, 4, 6], die: 8, type: "lightning", text: "Ein knisterndes Fläschchen, das beim Aufprall entlädt." },
  mana: { img: "bottle-conical-corked-blue", act: "util", text: ["Du erhältst einen verbrauchten Zauberplatz der Stufe 1 zurück.", "Du erhältst einen verbrauchten Zauberplatz der Stufe 2 zurück.", "Du erhältst einen verbrauchten Zauberplatz der Stufe 3 zurück."], note: "Nicht automatisiert: stelle den Zauberplatz auf dem Charakterbogen selbst wieder her." },
  schlaf: { img: "bottle-pear-corked-blue", act: "hit", ability: "con", dc: [12, 14, 16], status: "unconscious", seconds: [60, 600, 3600], text: "Das Ziel versinkt in tiefen Schlaf. Es wacht auf, wenn es Schaden erleidet oder jemand es mit einer Aktion weckt." },
  verlangsamung: { img: "bottle-round-corked-blue", act: "hit", ability: "con", dc: [12, 14, 16], seconds: [60, 60, 600], changes: () => [ch("system.attributes.movement.walk", MODE.MULTIPLY, 0.5), ch("system.attributes.ac.bonus", MODE.ADD, "-2")], effectName: "Verlangsamt", text: "Das Ziel bewegt sich halb so schnell und erhält −2 auf die Rüstungsklasse." },
  "wildes-wachstum": { img: "bottle-round-corked-green", act: "util", text: "Ein Trank, der Wachstum kräftig anregt: Samen und Ranken treiben sichtbar voran.", extra: [null, null, "Wer ihn trinkt, wächst für 1 Stunde um eine Größenkategorie (zum Beispiel Mittelgroß → Groß)."] },
  steinhaut: { img: "bottle-round-corked-orange", act: "buff", seconds: 3600, changes: (t) => [ch("system.attributes.ac.bonus", MODE.ADD, plus([1, 2, 3][t]))], effectName: "Steinhaut", text: ["Deine Haut wird hart wie Stein: +1 auf die Rüstungsklasse für 1 Stunde.", "Deine Haut wird hart wie Stein: +2 auf die Rüstungsklasse für 1 Stunde.", "Deine Haut wird hart wie Stein: +3 auf die Rüstungsklasse für 1 Stunde."] },
  explosion: { img: "bottle-round-corked-red", act: "hit", ability: "dex", dc: [12, 14, 16], dmg: [3, 5, 8], die: 6, type: "thunder", text: "Ein instabiles Gebräu, das bei Erschütterung mit lautem Knall explodiert." },
  raserei: { img: "bottle-round-label-cork-red", act: "buff", seconds: [60, 600, 600], changes: (t) => [ch("system.bonuses.mwak.damage", MODE.ADD, plus([2, 3, 4][t]))], effectName: "In Raserei", text: ["Wut packt dich: +2 Schaden mit Nahkampfangriffen für 1 Minute.", "Wut packt dich: +3 Schaden mit Nahkampfangriffen für 10 Minuten.", "Wut packt dich: +4 Schaden mit Nahkampfangriffen für 10 Minuten."] },
  charme: { img: "bottle-pear-corked-labeled-ornamental-purple", act: "hit", ability: "wis", dc: [12, 14, 16], status: "charmed", seconds: [600, 3600, 28800], text: "Das Ziel sieht dich als guten Freund an. Es weiß nach Ablauf, dass es bezaubert wurde." },
  begierde: { img: "bottle-round-label-cork-purple", act: "hit", ability: "wis", dc: [12, 14, 16], status: "charmed", seconds: [600, 600, 3600], text: "Das Ziel wird von leidenschaftlicher Begierde ergriffen." },
  saeure: { img: "bottle-conical-fumes-green", act: "hit", ability: "dex", dc: [12, 14, 16], dmg: [2, 4, 6], die: 6, type: "acid", text: "Ein ätzendes Fläschchen, das sich durch Stoff und Haut frisst." },
  unsichtbarkeit: { img: "bottle-bulb-empty-glass", act: "buff", seconds: [600, 3600, 28800], status: "invisible", effectName: "Unsichtbar", text: ["Du wirst für 10 Minuten unsichtbar. Der Effekt endet, wenn du angreifst oder zauberst.", "Du wirst für 1 Stunde unsichtbar. Der Effekt endet, wenn du angreifst oder zauberst.", "Du wirst für 8 Stunden unsichtbar. Der Effekt endet, wenn du angreifst oder zauberst."] },
  levitation: { img: "bottle-conical-bubbling-blue", act: "buff", seconds: [600, 3600, 3600], changes: (t) => [ch("system.attributes.movement.fly", MODE.UPGRADE, [10, 20, 30][t])], effectName: "Schwebend", text: ["Du schwebst: Flugbewegungsrate 10 Fuß für 10 Minuten.", "Du schwebst: Flugbewegungsrate 20 Fuß für 1 Stunde.", "Du schwebst: Flugbewegungsrate 30 Fuß für 1 Stunde."] },
  halluzination: { img: "bottle-round-corked-pink", act: "hit", ability: "wis", dc: [12, 14, 16], seconds: [60, 600, 3600], text: "Das Ziel sieht Dinge, die nicht da sind. Bei Misserfolg bestimmt die Spielleitung, was es wahrnimmt. Nicht automatisiert.", noEffect: true },
  "magische-sicht": { img: "bottle-bulb-corked-labeled-blue", act: "util", text: ["Du siehst Magie in 30 Fuß Umkreis (wie Magie entdecken) für 10 Minuten.", "Du siehst Magie in 30 Fuß Umkreis und erkennst Unsichtbares für 1 Stunde.", "Du siehst Magie in 60 Fuß Umkreis und erkennst Unsichtbares für 8 Stunden."] },
  nekromantie: { img: "bottle-bulb-corked-purple", act: "hit", ability: "con", dc: [12, 14, 16], dmg: [2, 4, 6], die: 8, type: "necrotic", text: "Dunkle Energie entzieht dem Ziel Lebenskraft." },
  fluch: { img: "bottle-conical-corked-purple", act: "hit", ability: "wis", dc: [12], seconds: 3600, changes: () => [ch("system.bonuses.abilities.check", MODE.ADD, "-1d4"), ch("system.bonuses.abilities.save", MODE.ADD, "-1d4")], effectName: "Verflucht", text: "Das Ziel ist verflucht: −1W4 auf Attributswürfe und Rettungswürfe für 1 Stunde." },
  furcht: { img: "bottle-ornate-bat-teal", act: "hit", ability: "wis", dc: [12, 14, 16], status: "frightened", seconds: [60, 600, 3600], text: "Das Ziel wird von blanker Furcht gepackt." },
  vergroesserung: { img: "bottle-round-label-cork-green", act: "buff", seconds: [600, 3600, 3600], changes: (t) => [ch("system.bonuses.mwak.damage", MODE.ADD, plus(["1d4", "1d4", "2d4"][t]))], effectName: "Vergrößert", text: ["Du wächst: +1W4 Schaden mit Nahkampfangriffen für 10 Minuten.", "Du wächst: +1W4 Schaden mit Nahkampfangriffen für 1 Stunde.", "Du wächst: +2W4 Schaden mit Nahkampfangriffen für 1 Stunde."] },
  bindung: { img: "bottle-circular-corked-labeled-green", act: "hit", ability: "str", dc: [12], status: "restrained", seconds: 60, text: "Eine klebrige Masse hält das Ziel fest, bis es sich befreit oder die Wirkung nachlässt." },
  antimagie: { img: "bottle-metal-yellow-gray", act: "util", text: ["Vorteil auf Rettungswürfe gegen Zauber für 10 Minuten.", "Vorteil auf Rettungswürfe gegen Zauber für 1 Stunde.", "Vorteil auf Rettungswürfe gegen Zauber für 8 Stunden."], note: "Nicht automatisiert: der Vorteil wird am Tisch angewendet." },
  feuerschutz: { img: "bottle-round-label-cork-red", act: "buff", seconds: [3600, 28800, 3600], changes: (t) => [ch(t === 2 ? "system.traits.di.value" : "system.traits.dr.value", MODE.ADD, "fire")], effectName: "Feuerschutz", text: ["Resistenz gegen Feuerschaden für 1 Stunde.", "Resistenz gegen Feuerschaden für 8 Stunden.", "Immunität gegen Feuerschaden für 1 Stunde."] },
  giftschutz: { img: "bottle-corked-green", act: "buff", seconds: [3600, 28800, 3600], changes: (t) => [ch(t === 2 ? "system.traits.di.value" : "system.traits.dr.value", MODE.ADD, "poison")], effectName: "Giftschutz", text: ["Resistenz gegen Giftschaden für 1 Stunde.", "Resistenz gegen Giftschaden für 8 Stunden.", "Immunität gegen Giftschaden für 1 Stunde."] },
  saeureschutz: { img: "bottle-pear-corked-labeled-green", act: "buff", seconds: [3600, 28800, 3600], changes: (t) => [ch(t === 2 ? "system.traits.di.value" : "system.traits.dr.value", MODE.ADD, "acid")], effectName: "Säureschutz", text: ["Resistenz gegen Säureschaden für 1 Stunde.", "Resistenz gegen Säureschaden für 8 Stunden.", "Immunität gegen Säureschaden für 1 Stunde."] },
  blitzschutz: { img: "bottle-corked-blue", act: "buff", seconds: [3600, 28800, 3600], changes: (t) => [ch(t === 2 ? "system.traits.di.value" : "system.traits.dr.value", MODE.ADD, "lightning")], effectName: "Blitzschutz", text: ["Resistenz gegen Blitzschaden für 1 Stunde.", "Resistenz gegen Blitzschaden für 8 Stunden.", "Immunität gegen Blitzschaden für 1 Stunde."] }
};

/** Potion effects that have an item (all of them, in the order of the recipe catalogue). */
export const POTION_EFFECTS = EFFECTS.filter((e) => SPECS[e.id]).map((e) => e.id);

const per = (value, t) => (Array.isArray(value) ? (value[t] ?? value.at(-1)) : value);
const fmtTime = (seconds) => {
  if (seconds >= 3600) return `${seconds / 3600} Std.`;
  if (seconds >= 60) return `${seconds / 60} Min.`;
  return `${seconds} Sek.`;
};

function describe(effectId, spec, t) {
  const effect = EFFECT_BY_ID.get(effectId);
  const lines = [];
  const text = Array.isArray(spec.text) ? spec.text[t] : spec.text;
  lines.push(`<p><strong>${effect.name}</strong>${effect.maxTier > 1 ? ` (Stufe ${TIER_LABEL[t]})` : ""}: ${text}</p>`);
  if (spec.act === "heal") {
    const [n, d, b] = spec.heal[t];
    lines.push(`<p>Heilung: ${n}W${d}+${b} Trefferpunkte.</p>`);
  }
  if (spec.act === "hit") {
    const parts = [`Rettungswurf ${ABILITY_LABEL[spec.ability]} gegen SG ${per(spec.dc, t)}.`];
    if (spec.dmg) parts.push(`Bei Misserfolg ${per(spec.dmg, t)}W${spec.die} ${DAMAGE_LABEL[spec.type]}schaden, bei Erfolg die Hälfte.`);
    if (spec.status) parts.push(`Bei Misserfolg: ${STATUS_LABEL[spec.status]} für ${fmtTime(per(spec.seconds, t))}.`);
    else if (spec.changes) parts.push(`Bei Misserfolg gilt der Effekt für ${fmtTime(per(spec.seconds, t))}.`);
    lines.push(`<p>${parts.join(" ")}</p>`);
  }
  if (spec.extra?.[t]) lines.push(`<p>${spec.extra[t]}</p>`);
  if (spec.note) lines.push(`<p><em>${spec.note}</em></p>`);
  const garden = GARDEN_EFFECTS[effectId];
  if (garden?.kind === "growth") {
    lines.push(`<p><strong>Im Botanikclub-Garten:</strong> auf ein Beet angewendet, wachsen die Pflanzen dort mit Faktor ×${String(per(garden.factors, t)).replace(".", ",")}, bis auf dem Beet geerntet wird.</p>`);
  } else if (garden?.kind === "harm") {
    lines.push("<p><strong>Im Botanikclub-Garten:</strong> auf ein Beet angewendet, vernichtet der Trank die Pflanze dort sofort (HP auf 0).</p>");
  }
  return lines.join("\n");
}

/**
 * The item source of a potion. `makeId(label)` supplies the 16-character ids for the
 * item's activity and effect (stable in the generator, random at runtime).
 * Returns `{ item, effectId }` where `item` has no `_id`.
 */
export function buildPotion(effectId, tier, makeId = () => foundry.utils.randomID()) {
  const effect = EFFECT_BY_ID.get(effectId);
  const spec = SPECS[effectId];
  if (!effect || !spec) throw new Error(`No potion for effect ${effectId}`);
  const t = Math.max(1, Math.min(effect.maxTier, tier)) - 1;
  const rarity = TIER_RARITY[t];

  const activityId = makeId("activity");
  const activity = {
    _id: activityId,
    name: "",
    activation: { type: "action", override: false },
    consumption: { scaling: { allowed: false }, spellSlot: false, targets: [{ type: "itemUses", target: "", value: "1", scaling: {} }] },
    description: { chatFlavor: "" },
    effects: [],
    sort: 0
  };
  const effects = [];

  // A lasting result becomes an Active Effect the activity applies.
  const changes = spec.changes ? spec.changes(t) : [];
  const statuses = spec.status ? [spec.status] : [];
  if (!spec.noEffect && (changes.length || statuses.length)) {
    const effectDocId = makeId("effect");
    const seconds = per(spec.seconds, t);
    effects.push({
      _id: effectDocId,
      name: spec.effectName ?? STATUS_LABEL[spec.status] ?? effect.name,
      img: `${P}${spec.img}.webp`,
      type: "base",
      changes,
      disabled: false,
      duration: { seconds },
      description: "",
      origin: null,
      tint: "#ffffff",
      transfer: false,
      statuses,
      sort: 0,
      flags: {}
    });
    activity.effects.push(spec.act === "hit" ? { _id: effectDocId, onSave: false } : { _id: effectDocId });
  }

  const duration = spec.seconds ? per(spec.seconds, t) : null;
  if (spec.act === "heal") {
    const [number, denomination, bonus] = spec.heal[t];
    Object.assign(activity, {
      type: "heal",
      healing: { number, denomination, bonus: String(bonus), types: ["healing"], custom: { enabled: false, formula: "" }, scaling: { mode: "", number: 1 } },
      range: { units: "touch" },
      target: { affects: { type: "creature", count: "1" }, template: { units: "ft" }, prompt: true }
    });
  } else if (spec.act === "hit") {
    Object.assign(activity, {
      type: "save",
      save: { ability: [spec.ability], dc: { calculation: "", formula: String(per(spec.dc, t)) }, visible: true },
      damage: {
        onSave: "half",
        parts: spec.dmg ? [{ number: per(spec.dmg, t), denomination: spec.die, bonus: "", types: [spec.type], custom: { enabled: false, formula: "" }, scaling: { mode: "", number: 1 } }] : []
      },
      range: { value: "30", units: "ft" },
      target: { affects: { type: "creature", count: "1" }, template: { units: "ft" }, prompt: true }
    });
  } else {
    Object.assign(activity, {
      type: "utility",
      range: { units: "self" },
      target: { affects: { type: "self" }, template: { units: "ft" }, prompt: false }
    });
  }
  if (duration) activity.duration = { value: String(duration >= 3600 ? duration / 3600 : duration >= 60 ? duration / 60 : duration), units: duration >= 3600 ? "hour" : duration >= 60 ? "minute" : "second", override: true };

  const magical = !["gift", "saeure", "explosion"].includes(effectId);
  const name = effect.maxTier > 1 ? `Trank: ${effect.name} (Stufe ${TIER_LABEL[t]})` : `Trank: ${effect.name}`;
  const item = {
    name,
    type: "consumable",
    img: `${P}${spec.img}.webp`,
    system: {
      description: { value: describe(effectId, spec, t), chat: "" },
      quantity: 1,
      weight: { value: 0.5, units: "lb" },
      price: { value: TIER_PRICE[t], denomination: "gp" },
      rarity,
      uses: { spent: 0, max: "1", recovery: [], autoDestroy: true },
      type: { value: "potion", subtype: "" },
      properties: magical ? ["mgc"] : [],
      activities: { [activityId]: activity },
      identified: true,
      source: { custom: "Fimblewood Academy Botanikclub" }
    },
    effects,
    folder: null,
    ownership: { default: 0 },
    flags: { [MODULE_ID]: { potionEffect: effectId, potionTier: t + 1, role: "potion" } }
  };
  return { item, rarityLabel: RARITY_LABEL[rarity] };
}
