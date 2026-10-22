/**
 * Generates the shop compendium source (packs/_source/shop): everything the
 * Stratos shops sell, one folder per shop type.
 *
 * Items marked with an SRD id copy their rules data (activities, uses,
 * properties) from dnd5e's equipment24 pack and get a German name and the
 * Stratos price. That data lives in tools/data/shop-srd-base.json; refresh it
 * from a dnd5e checkout with
 *   node tools/generate-shop-pack.mjs --snapshot <dnd5e>/packs/_source/equipment24
 *
 * Run `node tools/generate-shop-pack.mjs`, then `npm run build:packs`.
 * Ids are derived from folder and item names, so reruns overwrite in place.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_ID = "fimblewood-academy";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "packs", "_source", "shop");
const SNAPSHOT = path.join(ROOT, "tools", "data", "shop-srd-base.json");
const SOURCE = "Fimblewood Academy: Stratos-Shops";
const stableId = (key) => createHash("sha1").update(`${MODULE_ID}:${key}`).digest("hex").slice(0, 16);
const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/* -------------------------------------------- */
/*  Item kinds                                   */
/* -------------------------------------------- */

/** Document type, subtype and fallback icon per kind of custom item. */
const KINDS = {
  food: { type: "consumable", sub: "food", uses: true, img: "icons/consumables/food/bowl-stew-brown.webp" },
  drink: { type: "consumable", sub: "food", uses: true, img: "icons/consumables/drinks/alcohol-beer-stein-wooden-metal-brown.webp" },
  potion: { type: "consumable", sub: "potion", uses: true, img: "icons/consumables/potions/bottle-round-corked-pink.webp" },
  bomb: { type: "consumable", sub: "trinket", uses: true, img: "icons/commodities/tech/smoke-bomb-purple.webp" },
  charm: { type: "consumable", sub: "trinket", uses: true, img: "icons/commodities/treasure/token-runed-circle-green.webp" },
  magic: { type: "equipment", sub: "trinket", img: "icons/commodities/treasure/puzzle-box-glowing-blue.webp" },
  clothing: { type: "equipment", sub: "clothing", img: "icons/equipment/chest/shirt-collared-brown.webp" },
  gear: { type: "loot", sub: "gear", img: "icons/containers/bags/pack-simple-leather.webp" },
  material: { type: "loot", sub: "material", img: "icons/commodities/materials/bowl-powder-gold.webp" },
  plant: { type: "loot", sub: "gear", img: "icons/consumables/plants/sprout-leaf-herb-green.webp" },
  service: { type: "loot", sub: "gear", img: "icons/sundries/documents/document-sealed-red-yellow.webp" }
};

/* -------------------------------------------- */
/*  Catalogue                                    */
/* -------------------------------------------- */

/**
 * Item rows. `c(name, price, kind, img, text, rarity)` is a custom item,
 * `s(name, price, srdId, text)` takes its rules from the SRD snapshot.
 * Prices read "2 KM", "5 SM" or "7.5 GM".
 */
const c = (name, price, kind, img = null, text = "", rarity = "") => ({ name, price, kind, img, text, rarity });
const s = (name, price, srd, text = "") => ({ name, price, srd, text });

const SHOPS = [
  ["Taverne", [
    ["Speisen", [
      c("Brot & Butter", "2 KM", "food", "icons/consumables/grains/bread-loaf-boule-rustic-brown.webp"),
      c("Tagessuppe (Kürbis oder Zwiebel)", "5 KM", "food", "icons/consumables/food/soup-broth-bowl-wooden-yellow.webp"),
      c("Fischeintopf der Küste", "1 SM", "food", "icons/consumables/food/bowl-stew-brown.webp"),
      c("Bratkartoffeln mit Speck", "3 SM", "food", "icons/consumables/food/short-ribs-cooked-meat-brown.webp"),
      c("Käseplatte", "5 SM", "food", "icons/consumables/grains/breadsticks-crackers-wrapped-ration-brown.webp"),
      c("Pastete des Hauses", "6 SM", "food", "icons/consumables/grains/bread-loaf-boule-rustic-brown.webp"),
      c("Braten mit Wurzelgemüse", "8 SM", "food", "icons/consumables/food/cooked-ribs-rack-glazed-bones-brown-white.webp"),
      c("Festmahl für vier", "4 GM", "food", "icons/consumables/food/cooked-drumstick-chicken-turkey-brown.webp", "Ein reich gedeckter Tisch für vier Personen."),
      c("Erdbeertörtchen", "3 SM", "food", "icons/commodities/flowers/strawberry-trio-white.webp"),
      c("Honigkuchen", "2 SM", "food", "icons/consumables/grains/bread-loaf-boule-rustic-brown.webp"),
      c("Lavendelscones", "2 SM", "food", "icons/consumables/grains/breadsticks-crackers-wrapped-ration-brown.webp"),
      c("Feuerglocken-Chili", "4 SM", "food", "icons/consumables/fruit/chili-fresno-pepper-red.webp",
        "Höllisch scharf. Wer es isst, macht einen Rettungswurf auf Konstitution (SG 10) oder hustet eine Runde lang."),
      c("Eisfrucht-Sorbet", "5 SM", "food", "icons/consumables/fruit/berry-shiny-leaf-blue-teal.webp",
        "Eiskalt und fruchtig. Für 1 Stunde Vorteil auf Rettungswürfe gegen extreme Hitze."),
      c("Proviant-Lunchpaket (1 Tag)", "5 SM", "food", "icons/consumables/grains/breadsticks-crackers-wrapped-ration-brown.webp", "Verpflegung für einen Tag unterwegs."),
      c("Studentenmenü", "4 SM", "food", "icons/consumables/food/soup-broth-bowl-wooden-yellow.webp", "Suppe, Brot und Saft. Nur gegen Vorlage des Akademieausweises.")
    ]],
    ["Getränke", [
      c("Wasser", "1 KM", "drink", "icons/sundries/survival/waterskin-leather-brown.webp"),
      c("Kräutertee", "1 KM", "drink", "icons/consumables/drinks/tea-jug-gourd-brown.webp"),
      c("Minztee", "2 KM", "drink", "icons/consumables/plants/mint-dried-green.webp"),
      c("Kamillentee", "2 KM", "drink", "icons/consumables/drinks/tea-jug-gourd-brown.webp"),
      c("Milch", "2 KM", "drink", "icons/containers/kitchenware/jug-terracotta-orange.webp"),
      c("Apfel- oder Beerensaft", "3 KM", "drink", "icons/consumables/fruit/apple-red-tree-green.webp"),
      c("Heiße Schokolade mit Sahne", "5 KM", "drink", "icons/containers/kitchenware/goblet-worn-clay-white.webp"),
      c("Ale (Krug)", "4 KM", "drink", "icons/consumables/drinks/alcohol-beer-stein-wooden-metal-brown.webp"),
      c("Dunkelbier „Sturmbräu“", "6 KM", "drink", "icons/consumables/drinks/alcohol-beer-stein-wooden-metal-brown.webp"),
      c("Met", "1 SM", "drink", "icons/commodities/bones/horn-drinking-white.webp"),
      c("Cider", "5 KM", "drink", "icons/containers/kitchenware/stein-empty.webp"),
      c("Wein (Glas)", "2 SM", "drink", "icons/containers/kitchenware/goblet-jeweled-gold-white.webp"),
      c("Wein (Flasche)", "2 GM", "drink", "icons/consumables/drinks/alcohol-spirits-bottle-green.webp"),
      c("Feiner Elfenwein (Flasche)", "10 GM", "drink", "icons/consumables/drinks/alcohol-spirits-bottle-green.webp"),
      c("Zwergenschnaps", "5 SM", "drink", "icons/consumables/drinks/alcohol-jar-spirits-gray.webp"),
      c("Donnerdistel-Brand", "8 SM", "drink", "icons/consumables/drinks/alcohol-jar-spirits-gray.webp", "Kleine Funken knistern auf der Zunge."),
      c("Wolkenpunsch", "4 SM", "drink", "icons/containers/kitchenware/goblet-worn-clay-white.webp", "Alkoholfrei. Die Schaumkrone schwebt eine Handbreit über dem Glas."),
      c("Mondblütenlikör", "1 GM", "drink", "icons/consumables/drinks/clay-jar-glowing-orange-blue.webp", "Leuchtet schwach im Dunkeln."),
      c("Drachenatem", "2 GM", "drink", "icons/consumables/drinks/clay-jar-glowing-orange-blue.webp",
        "Wer ihn trinkt, erleidet 1 Feuerschaden und hat 1 Stunde lang Vorteil auf Würfe für Einschüchtern."),
      c("Seemannsgrog", "6 KM", "drink", "icons/containers/kitchenware/stein-empty.webp"),
      c("Kaffee „Prüfungsnacht“", "3 SM", "drink", "icons/containers/kitchenware/goblet-worn-clay-white.webp",
        "Wer eine Nacht durchlernt, erleidet dadurch keine Erschöpfung.")
    ]],
    ["Unterkunft & Service", [
      c("Schlafplatz im Gemeinschaftsraum (1 Nacht)", "5 KM", "service", "icons/sundries/survival/bedroll-grey.webp"),
      c("Schlafplatz im Gemeinschaftsraum (bis zur nächsten Stadt)", "1 GM", "service", "icons/sundries/survival/bedroll-grey.webp", PAUSCHALE()),
      c("Einfaches Zimmer (1 Nacht)", "5 SM", "service", "icons/sundries/misc/key-ring-long-gold.webp"),
      c("Einfaches Zimmer (bis zur nächsten Stadt)", "10 GM", "service", "icons/sundries/misc/key-ring-long-gold.webp", PAUSCHALE()),
      c("Gutes Zimmer (1 Nacht)", "8 SM", "service", "icons/sundries/misc/key-ring-long-gold.webp"),
      c("Gutes Zimmer (bis zur nächsten Stadt)", "18 GM", "service", "icons/sundries/misc/key-ring-long-gold.webp", PAUSCHALE()),
      c("Suite (1 Nacht)", "2 GM", "service", "icons/sundries/misc/key-ring-long-gold.webp"),
      c("Suite (bis zur nächsten Stadt)", "45 GM", "service", "icons/sundries/misc/key-ring-long-gold.webp", PAUSCHALE()),
      c("Heißes Bad", "2 SM", "service", "icons/sundries/survival/soap.webp"),
      c("Wäsche waschen", "1 SM", "service", "icons/commodities/cloth/cloth-roll-worn-blue.webp"),
      c("Stallplatz (1 Nacht)", "5 SM", "service", "icons/tools/smithing/horsehoe-worn-steel-grey.webp"),
      c("Gepäckaufbewahrung (1 Tag)", "2 KM", "service", "icons/containers/chest/chest-simple-box-brown.webp"),
      c("Bote innerhalb der Insel", "2 KM", "service", "icons/sundries/documents/envelope-sealed-red-tan.webp", "Preis pro Kilometer."),
      c("Barde für einen Abend", "2 GM", "service", "icons/tools/instruments/lute-gold-brown.webp"),
      c("Spielabend (Würfel, Karten oder Drachenschach leihen)", "1 SM", "service", "icons/sundries/gaming/chess-knight-white.webp")
    ]],
    ["Souvenirs & Theke", [
      c("Tavernenkrug mit Gravur", "5 SM", "gear", "icons/containers/kitchenware/stein-empty.webp"),
      c("Pfeife & Tabak", "2 SM", "gear", "icons/commodities/wood/kindling-stick-brown.webp"),
      s("Kartenspiel", "5 SM", "phbgstPlayingcar"),
      s("Würfelset aus Knochen", "1 SM", "phbgstDice000000"),
      c("Postkarte von Stratos", "1 KM", "gear", "icons/sundries/documents/document-letter-blue.webp"),
      s("Kerze", "1 KM", "phbagCandle00000")
    ]]
  ]],

  ["Magieladen", [
    ["Verbrauchbare Magie", [
      s("Zauberschriftrolle (Zaubertrick)", "7.5 GM", "dmgSpellScrollCa"),
      s("Zauberschriftrolle (Grad 1)", "30 GM", "dmgSpellScroll1s"),
      s("Zauberschriftrolle (Grad 2)", "100 GM", "dmgSpellScroll2n"),
      s("Zauberschriftrolle (Grad 3)", "250 GM", "dmgSpellScroll3r"),
      s("Zauberschriftrolle (Grad 4)", "800 GM", "dmgSpellScroll4t"),
      s("Zauberschriftrolle (Grad 5)", "1500 GM", "dmgSpellScroll5t"),
      s("Staub des Verschwindens", "300 GM", "dmgDustOfDisappe"),
      s("Staub des Niesens und Erstickens", "200 GM", "dmgDustOfSneezin"),
      c("Feenstaub", "250 GM", "charm", "icons/commodities/materials/bowl-powder-gold.webp",
        "Eine Prise golden glitzernder Staub. Über eine Kreatur gestreut, wirkt er einmal den Zauber <em>Federfall</em> auf sie.", "uncommon"),
      s("Perle der Kraft", "400 GM", "dmgPearlOfPower0"),
      c("Keoghtoms Salbe", "200 GM", "potion", "icons/containers/kitchenware/jug-bottle-clay-brown-gold-blue.webp",
        "Eine Dose mit 1W4+1 Portionen. Eine Portion heilt 2W8+2 Trefferpunkte und beendet Vergiftung und Krankheit.", "uncommon"),
      c("Wolkenwachskerze", "10 GM", "charm", "icons/sundries/lights/candle-lit-angelic.webp",
        "Brennt 8 Stunden und geht auch bei starkem Wind nicht aus.", "common"),
      c("Sturmglas-Kugel", "150 GM", "charm", "icons/commodities/materials/glass-orb-blue.webp",
        "Zerbricht man die Kugel, wirkt sie einmal den Zauber <em>Windstoß</em>.", "uncommon"),
      c("Blitzfeder", "50 GM", "charm", "icons/commodities/materials/feather-blue-glowing.webp",
        "Als Reaktion beim Fallen: Die Feder zerfällt und wirkt <em>Federfall</em> auf dich.", "common"),
      c("Leuchtsteine (3 Stück)", "15 GM", "charm", "icons/commodities/gems/pearl-natural.webp",
        "Jeder Stein leuchtet nach einem Reiben 1 Stunde lang wie der Zaubertrick <em>Licht</em>.", "common"),
      c("Zauberkreide", "40 GM", "charm", "icons/commodities/stone/rock-chunk-pumice-white.webp",
        "Ein damit gezeichnetes Zeichen wirkt einmal den Zauber <em>Alarm</em>.", "common"),
      c("Bote-Papiervogel", "20 GM", "charm", "icons/commodities/treasure/trinket-wing-white.webp",
        "Ein gefalteter Papiervogel. Er fliegt eine kurze Nachricht zu einer bekannten Person auf der Insel.", "common")
    ]],
    ["Gewöhnliche Magie", [
      c("Ewige Kerze", "50 GM", "magic", "icons/sundries/lights/candle-pillar-lit-yellow.webp", "Brennt ohne Hitze und ohne je herunterzubrennen.", "common"),
      c("Ewige Fackel", "50 GM", "magic", "icons/sundries/lights/torch-brown-lit.webp", "Brennt ohne Hitze und ohne je auszugehen.", "common"),
      c("Kleiner Hut der Verkleidung", "50 GM", "magic", "icons/equipment/head/hat-belted-simple.webp", "Ändert auf Befehl Farbe und Schnitt deiner Kleidung, aber nicht dein Aussehen.", "common"),
      c("Selbstrührende Tasse", "30 GM", "magic", "icons/containers/kitchenware/goblet-worn-clay-white.webp", "Rührt Tee und Kaffee von selbst um.", "common"),
      c("Immerwarme Decke", "40 GM", "magic", "icons/sundries/survival/bedroll-pink.webp", "Bleibt immer angenehm warm.", "common"),
      c("Geheimtinte", "35 GM", "magic", "icons/tools/scribal/ink-quill-red.webp", "Was damit geschrieben wird, kann nur die Person lesen, die es geschrieben hat.", "common"),
      c("Diktier-Notizbuch", "75 GM", "magic", "icons/sundries/books/book-open-brown.webp", "Schreibt mit, was in seiner Nähe gesagt wird.", "common"),
      c("Schreibfeder ohne Tinte", "25 GM", "magic", "icons/tools/scribal/pen-steel-grey-brown.webp", "Schreibt ohne Tinte.", "common"),
      c("Ohrstecker der Übersetzung", "100 GM", "magic", "icons/equipment/neck/pendant-faceted-blue.webp",
        "Einmal am Tag verstehst du für 1 Stunde eine festgelegte Sprache, wenn du sie hörst.", "common"),
      c("Wolkenkissen", "60 GM", "magic", "icons/commodities/materials/material-cotton-white.webp", "Schwebt 30 cm über dem Boden und trägt bis zu 5 kg.", "common"),
      c("Taschenuhr der Akademieglocke", "30 GM", "magic", "icons/tools/navigation/watch-simple-blue.webp", "Vibriert kurz vor jedem Unterrichtsbeginn.", "common"),
      c("Windfester Regenschirm", "40 GM", "magic", "icons/commodities/wood/wood-pole.webp", "Lässt sich vom Wind nicht verbiegen oder entreißen.", "common"),
      c("Schattenlaterne", "80 GM", "magic", "icons/sundries/lights/lantern-iron-yellow.webp", "Ihr Licht kann nur sehen, wer sie trägt.", "common"),
      c("Mantel der billigen Illusion", "50 GM", "magic", "icons/equipment/back/cloak-hooded-blue.webp", "Ändert auf Befehl seine Farbe.", "common"),
      c("Heimkompass", "50 GM", "magic", "icons/tools/navigation/compass-chain-blue.webp", "Zeigt immer zum Ort, an dem du zuletzt eine lange Rast gemacht hast.", "common"),
      c("Stab der Blumen", "50 GM", "magic", "icons/commodities/wood/wood-pole.webp", "Lässt auf Befehl eine Blume aus der Spitze sprießen.", "common"),
      c("Topf des Erwachens", "100 GM", "magic", "icons/containers/kitchenware/vase-clay-painted-brown-white.webp",
        "Wird darin 30 Tage lang ein Strauch gezogen, erwacht er zu einem kleinen, freundlichen Begleiter.", "common"),
      c("Plaudernde Drachenschach-Figur", "40 GM", "magic", "icons/sundries/gaming/chess-knight-white.webp", "Kommentiert jeden Zug, ob man will oder nicht.", "common")
    ]],
    ["Ungewöhnliche Magie", [
      s("Tasche des Haltens", "500 GM", "dmgBagOfHolding0"),
      s("Hewards praktischer Rucksack", "1000 GM", "dmgHewardsHandyH"),
      s("Seil des Kletterns", "400 GM", "dmgRopeOfClimbin"),
      s("Stiefel der Elfen", "500 GM", "dmgBootsOfElvenk"),
      s("Stiefel des Schreitens und Springens", "500 GM", "dmgBootsOfStridi"),
      s("Umhang des Schutzes", "600 GM", "dmgCloakOfProtec"),
      s("Ring des Schwimmens", "400 GM", "dmgRingOfSwimmin"),
      s("Ring des Springens", "400 GM", "dmgRingOfJumping"),
      s("Ring der Wärme", "400 GM", "dmgRingOfWarmth0"),
      s("Brille der Nacht", "300 GM", "dmgGogglesOfNigh"),
      s("Augen des Adlers", "400 GM", "dmgEyesOfTheEagl"),
      s("Stirnreif des Intellekts", "800 GM", "dmgHeadbandOfInt"),
      s("Handschuhe der Diebeskunst", "500 GM", "dmgGlovesOfThiev"),
      s("Immerrauchende Flasche", "300 GM", "dmgEversmokingBo"),
      s("Sendesteine (Paar)", "400 GM", "dmgSendingStones"),
      s("Hut der Verkleidung", "400 GM", "dmgHatOfDisguise"),
      s("Zauberstab der Geschosse", "400 GM", "dmgWandOfMagicMi"),
      s("Zauberstab des Netzes", "400 GM", "dmgWandOfWeb0000"),
      s("Zauberstab der Magieentdeckung", "250 GM", "dmgWandOfMagicDe"),
      s("Fokus +1 (Zauberstab des Kriegsmagiers)", "600 GM", "dmg1WandOfTheWar"),
      s("Waffe +1", "600 GM", "dmgWeapon12or300"),
      s("Rüstung +1", "800 GM", "dmgArmor12or3000"),
      s("Schild +1", "800 GM", "dmgShield12or300"),
      c("Wingwing-Umhang", "500 GM", "magic", "icons/equipment/back/cloak-collared-feathers-green.webp",
        "Solange du ihn trägst, fällst du sanft wie unter dem Zauber <em>Federfall</em>.", "uncommon"),
      c("Windsegel-Gleitflügel", "450 GM", "magic", "icons/commodities/treasure/trinket-wing-white.webp",
        "Beim Fallen gleitest du für jede 30 cm Fall 2 m weit in eine Richtung deiner Wahl.", "uncommon"),
      c("Flugbesen-Reparaturset", "150 GM", "gear", "icons/tools/hand/broom-straw-brown.webp", "Borsten, Bindedraht und Runenwachs, um einen magischen Besen zu reparieren.", "uncommon")
    ]],
    ["Seltene Magie", [
      s("Besen des Fliegens", "3000 GM", "dmgBroomOfFlying"),
      s("Umhang der Fledermaus", "4000 GM", "dmgCloakOfTheBat"),
      s("Ring der Zauberspeicherung", "5000 GM", "dmgRingOfSpellSt"),
      s("Stab der Heilung", "4000 GM", "dmgStaffOfHealin"),
      s("Zauberstab der Feuerbälle", "5000 GM", "dmgWandOfFirebal"),
      s("Glücksstein", "3000 GM", "dmgStoneOfGoodLu"),
      s("Mantel der Elfen", "2500 GM", "dmgCloakOfElvenk"),
      s("Kristallkugel", "7500 GM", "dmgCrystalBall00")
    ]],
    ["Dienstleistungen", [
      c("Gegenstand identifizieren", "20 GM", "service", "icons/tools/scribal/magnifying-glass.webp"),
      c("Magischen Gegenstand aufladen", "50 GM", "service", "icons/commodities/gems/gem-faceted-radiant-teal.webp", "Preis pro Ladung."),
      c("Waffe mit Zaubertrick verzaubern", "100 GM", "service", "icons/sundries/documents/blueprint-magical.webp"),
      c("Fluch entfernen lassen", "250 GM", "service", "icons/sundries/scrolls/scroll-bound-sealed-black-red.webp")
    ]]
  ]],

  ["Alchemieladen", [
    ["Alchemistische Klassiker", [
      s("Alchemistenfeuer", "50 GM", "phbagAlchemistsF"),
      s("Säureflasche", "25 GM", "phbagAcid0000000"),
      s("Weihwasser", "25 GM", "phbagHolyWater00"),
      s("Gegengift", "50 GM", "phbagAntitoxin00"),
      s("Heilerkit", "5 GM", "phbagHealersKit0"),
      c("Rauchbombe", "25 GM", "bomb", "icons/commodities/tech/smoke-bomb-purple.webp", "Erzeugt beim Zerplatzen eine Rauchwolke mit 3 m Radius, die 1 Minute lang Sicht blockiert."),
      c("Blendpulver", "20 GM", "bomb", "icons/commodities/materials/bowl-powder-gold.webp", "Ins Gesicht geworfen: Rettungswurf auf Konstitution (SG 12) oder 1 Runde blind."),
      c("Klebebombe", "50 GM", "bomb", "icons/commodities/materials/slime-white.webp", "Das Ziel ist festgesetzt, bis es eine Aktion aufwendet, um sich zu befreien."),
      c("Donnerstein", "30 GM", "bomb", "icons/commodities/stone/geode-raw-tan.webp", "Zerschellt mit lautem Knall: 1W4 Schallschaden im Umkreis von 1,5 m."),
      c("Leuchtstab", "5 GM", "bomb", "icons/sundries/lights/torch-black.webp", "Leuchtet nach dem Knicken 1 Stunde lang hell in 6 m Umkreis."),
      c("Zündstäbchen", "1 SM", "bomb", "icons/commodities/wood/kindling-stick-brown.webp", "Entzündet sich beim Reiben an einer rauen Fläche."),
      c("Kaltlichtfackel", "10 GM", "gear", "icons/sundries/lights/torch-black.webp", "Leuchtet wie eine Fackel, aber ohne Flamme und Hitze."),
      c("Riechsalz", "15 GM", "bomb", "icons/commodities/gems/powder-raw-white.webp", "Stabilisiert eine bewusstlose Kreatur mit 0 Trefferpunkten und weckt eine schlafende."),
      c("Schlafpulver", "30 GM", "bomb", "icons/commodities/materials/bowl-powder-blue.webp", "Ins Gesicht geblasen: Rettungswurf auf Konstitution (SG 12) oder 1 Minute bewusstlos."),
      c("Juckpulver", "5 GM", "bomb", "icons/commodities/materials/bowl-powder-pink.webp", "Ziel hat 1 Minute lang Nachteil auf Geschicklichkeitswürfe."),
      c("Stinkbombe", "10 GM", "bomb", "icons/consumables/potions/bottle-conical-fumes-green.webp", "Verpestet einen Raum. Wer drin bleibt, ist vergiftet, solange der Gestank anhält (1 Minute).")
    ]],
    ["Kosmetik & Alltag", [
      c("Haarfärbetonikum", "5 GM", "potion", "icons/consumables/potions/bottle-round-corked-orange.webp", "Färbt die Haare für eine Woche in einer Farbe deiner Wahl."),
      c("Stimmenwandler", "10 GM", "potion", "icons/consumables/potions/bottle-pear-corked-pink.webp", "Deine Stimme wird für 10 Minuten piepsig hoch."),
      c("Glitzerelixier", "5 GM", "potion", "icons/consumables/potions/potion-bottle-corked-fancy-orange.webp", "Deine Haut glitzert 1 Stunde lang."),
      c("Duftwasser „Erste Liebe“", "8 GM", "potion", "icons/consumables/potions/potion-flask-corked-labeled-pink.webp"),
      c("Wachhaltetropfen", "25 GM", "potion", "icons/consumables/potions/vial-cork-green.webp", "Keine Müdigkeit für 8 Stunden. Danach eine Stufe Erschöpfung."),
      c("Kater-Kur", "10 GM", "potion", "icons/consumables/potions/bottle-round-label-cork-yellow.webp", "Beseitigt die Folgen einer durchzechten Nacht."),
      c("Warzensalbe", "5 GM", "potion", "icons/containers/kitchenware/jug-clay-brown-sealed.webp"),
      c("Sonnenschutzcreme", "3 GM", "potion", "icons/containers/kitchenware/jug-clay-brown-sealed.webp"),
      c("Lippenbalsam der Sternfarbe", "2 GM", "potion", "icons/commodities/gems/pearl-purple-smooth.webp", "Färbt die Lippen in schimmernden Sternfarben."),
      c("Mutmacher-Bonbon", "20 GM", "potion", "icons/commodities/gems/gem-rough-cushion-red.webp", "Für 1 Runde Vorteil auf Rettungswürfe gegen den Zustand Verängstigt."),
      c("Knistertonikum", "5 GM", "potion", "icons/consumables/potions/bottle-conical-corked-yellow.webp", "Die Haare stehen 1 Stunde lang knisternd unter Strom."),
      c("Seifenblasen-Elixier", "5 GM", "potion", "icons/consumables/potions/bottle-round-empty-glass.webp", "Damit lassen sich riesige, schwebende Seifenblasen pusten.")
    ]],
    ["Laborbedarf", [
      s("Alchemistenausrüstung", "50 GM", "phbtulAlchemists"),
      s("Giftmacherwerkzeug", "50 GM", "phbtulPoisonersK"),
      s("Glasphiole", "1 GM", "phbagVial0000000"),
      c("Phiolengürtel (6 Plätze)", "5 GM", "gear", "icons/equipment/waist/belt-buckle-square-leather-brown.webp"),
      c("Gepolsterte Trankkiste (12 Plätze)", "15 GM", "gear", "icons/containers/chest/chest-reinforced-box-brown.webp"),
      c("Destillierkolben", "20 GM", "gear", "icons/tools/laboratory/alembic-glass-ball-blue.webp"),
      c("Ölbrenner", "10 GM", "gear", "icons/tools/laboratory/burner-steel-grey.webp"),
      c("Waage mit Gewichten", "5 GM", "gear", "icons/tools/hand/scale-balances-merchant-brown.webp"),
      c("Schutzbrille", "5 GM", "gear", "icons/equipment/head/goggles-leather-blue.webp"),
      c("Lederschürze", "2 GM", "gear", "icons/equipment/chest/vest-cloth-tattered-tan.webp"),
      c("Feuerfeste Handschuhe", "8 GM", "gear", "icons/equipment/hand/glove-simple-leather-green.webp"),
      c("Pipetten-Set", "3 GM", "gear", "icons/consumables/potions/vial-cork-empty.webp"),
      c("Filtertücher (10 Stück)", "1 SM", "gear", "icons/commodities/cloth/cloth-bolt-gold-orange.webp"),
      c("Etiketten & Siegelwachs", "5 SM", "gear", "icons/sundries/documents/envelope-sealed-red-brown.webp"),
      c("Kühlbox mit Frostrune", "40 GM", "magic", "icons/containers/chest/chest-reinforced-steel-walnut-brown.webp", "Hält ihren Inhalt kühl wie in einem Eiskeller.", "common"),
      c("Laborjournal", "5 GM", "gear", "icons/sundries/books/book-symbol-triangle-silver-brown.webp"),
      c("Mondstein-Mörser", "25 GM", "gear", "icons/tools/laboratory/mortar-liquid-pink.webp", "Ein edler Mörser aus Mondstein.")
    ]],
    ["Reagenzien", [
      c("Quecksilber", "5 GM", "material", "icons/commodities/materials/liquid-purple.webp"),
      c("Schwefel", "1 GM", "material", "icons/commodities/stone/ore-pile-white.webp"),
      c("Salpeter", "1 GM", "material", "icons/commodities/gems/powder-raw-white.webp"),
      c("Meersalz", "5 KM", "material", "icons/commodities/gems/powder-raw-white.webp"),
      c("Kohlepulver", "1 SM", "material", "icons/commodities/stone/stone-pile-grey.webp"),
      c("Kupferspäne", "5 SM", "material", "icons/commodities/metal/fragments-steel-barbed.webp"),
      c("Silberstaub", "25 GM", "material", "icons/commodities/materials/bowl-powder-blue.webp"),
      c("Goldstaub", "50 GM", "material", "icons/commodities/materials/bowl-powder-gold.webp"),
      c("Perlenpulver", "100 GM", "material", "icons/commodities/gems/pearl-rough-white.webp"),
      c("Diamantstaub", "300 GM", "material", "icons/commodities/gems/gem-rough-cushion-white.webp"),
      c("Rotharz (Drachenblut-Ersatz)", "20 GM", "material", "icons/commodities/materials/liquid-orange.webp"),
      c("Phönixasche", "200 GM", "material", "icons/commodities/materials/powder-red-green-yellow.webp", "", "rare"),
      c("Schleimtropfen", "2 GM", "material", "icons/commodities/materials/slime-white.webp"),
      c("Spinnenseide", "5 GM", "material", "icons/commodities/cloth/thread-spindle-white.webp"),
      c("Fledermausguano", "1 SM", "material", "icons/commodities/stone/rock-chunk-brown.webp"),
      c("Krötenschleim", "5 SM", "material", "icons/commodities/materials/slime-white.webp"),
      c("Greifenfeder", "25 GM", "material", "icons/commodities/materials/feather-orange.webp"),
      c("Meerwasser-Essenz", "2 GM", "material", "icons/consumables/potions/bottle-round-corked-blue.webp"),
      c("Gewitterwasser", "10 GM", "material", "icons/commodities/tech/tube-chamber-lightning.webp", "In einem Sturm aufgefangen."),
      c("Sternenstaub", "50 GM", "material", "icons/commodities/materials/bowl-powder-pink.webp"),
      c("Geisterkerzenwachs", "15 GM", "material", "icons/sundries/lights/candle-unlit-grey.webp")
    ]],
    ["Spezialtränke", [
      s("Trank des Wasseratmens", "180 GM", "dmgPotionOfWater"),
      s("Trank des Kletterns", "75 GM", "dmgPotionOfClimb"),
      s("Trank der Tierfreundschaft", "100 GM", "dmgPotionOfAnima"),
      s("Trank des Gedankenlesens", "500 GM", "dmgPotionOfMindR"),
      s("Trank der Gasförmigen Gestalt", "500 GM", "dmgPotionOfGaseo"),
      s("Trank des Widerstands", "300 GM", "dmgPotionOfResis", "Im Laden gibt es Kälte, Schall und Nekrotisch. Die übrigen Schutztränke braut der Botanikclub."),
      s("Öl der Glätte", "480 GM", "dmgOilOfSlipperi"),
      s("Öl der Schärfe", "3200 GM", "dmgOilOfSharpnes"),
      s("Liebestrank", "90 GM", "dmgPhilterOfLove"),
      c("Trank des Vergessens", "150 GM", "potion", "icons/consumables/potions/bottle-round-label-cork-purple.webp",
        "Wer ihn trinkt, vergisst die letzte Stunde. Gegenstück zum Vergissmeinnicht.", "uncommon"),
      s("Trank der Wahrheit", "200 GM", "dmgTruthSerum000")
    ]]
  ]],

  ["Botanikladen", [
    ["Werkzeug & Zubehör", [
      c("Gartenschere", "1 GM", "gear", "icons/tools/hand/sickle-steel-grey.webp"),
      c("Kräutersichel", "2 GM", "gear", "icons/tools/hand/sickle-steel-grey.webp"),
      c("Handschaufel", "5 SM", "gear", "icons/tools/hand/shovel-spade-steel-grey.webp"),
      c("Gießkanne", "1 GM", "gear", "icons/containers/misc/bucket-steel.webp"),
      c("Pflanzenzerstäuber", "2 GM", "gear", "icons/consumables/potions/bottle-bulb-empty-glass.webp"),
      c("Gartenhandschuhe", "5 SM", "gear", "icons/equipment/hand/glove-simple-leather-green.webp"),
      c("Drachenleder-Handschuhe", "15 GM", "gear", "icons/equipment/hand/glove-tooled-leather-red.webp", "Schützen auch vor den Dornen von Blutdorn und Dornstock."),
      c("Tontopf", "5 KM", "gear", "icons/containers/kitchenware/jug-terracotta-orange.webp"),
      c("Keramiktopf", "3 SM", "gear", "icons/containers/kitchenware/vase-clay-painted-brown-white.webp"),
      c("Glastopf", "2 GM", "gear", "icons/containers/kitchenware/vase-bottle-brown.webp"),
      c("Hängeampel", "1 GM", "gear", "icons/containers/misc/basket-handle-woven-yellow.webp"),
      c("Pflanzschalen-Set", "2 GM", "gear", "icons/tools/laboratory/bowl-mixing.webp"),
      c("Anzuchtkasten", "5 GM", "gear", "icons/containers/boxes/crate-heavy-yellow.webp"),
      c("Mini-Gewächshaus", "25 GM", "gear", "icons/commodities/materials/glass-cube.webp"),
      s("Erntekorb", "4 SM", "phbagBasket00000"),
      c("Trocknungsnetz", "1 GM", "gear", "icons/tools/fishing/net-simple-tan.webp"),
      c("Herbarium-Mappe", "5 GM", "gear", "icons/sundries/books/book-embossed-clasp-gold-brown.webp"),
      c("Blütenpresse", "2 GM", "gear", "icons/sundries/books/book-worn-brown.webp"),
      s("Lupe", "100 GM", "phbagMagnifyingG"),
      c("Bestimmungsbuch „Flora von Stratos“", "25 GM", "gear", "icons/sundries/books/book-turquoise-moon.webp"),
      s("Kräuterkunde-Ausrüstung", "5 GM", "phbtulHerbalismK"),
      c("Pflanzenetiketten (10 Stück)", "1 SM", "gear", "icons/sundries/documents/paper-plain-white.webp"),
      c("Bambusstäbe & Bindfaden", "5 KM", "gear", "icons/commodities/wood/wood-pole.webp")
    ]],
    ["Erden & Pflege", [
      c("Blumenerde (Sack)", "1 SM", "material", "icons/consumables/grains/sack-rice-flour-brown.webp"),
      c("Moorerde für Pilze", "3 SM", "material", "icons/consumables/grains/sack-rice-flour-brown.webp"),
      c("Vulkanerde", "2 GM", "material", "icons/commodities/stone/ore-pile-red.webp", "Besonders gut für Feuerpflanzen."),
      c("Wolkenmoos-Substrat", "3 GM", "material", "icons/commodities/materials/material-cotton-white.webp", "Besonders gut für Wind- und Wolkenpflanzen."),
      c("Sternensand", "5 GM", "material", "icons/commodities/materials/bowl-powder-pink.webp", "Lässt Mondblüten prächtiger wachsen."),
      c("Schneckenschreck", "5 SM", "material", "icons/commodities/gems/powder-raw-white.webp"),
      c("Blattlausspray", "1 GM", "material", "icons/consumables/potions/bottle-bulb-corked-green.webp"),
      c("Wurzelstimulans", "5 GM", "material", "icons/consumables/potions/bottle-round-corked-green.webp"),
      c("Mondwasser", "4 GM", "material", "icons/consumables/potions/bottle-round-ring-teal.webp", "Bei Vollmond gesammelt."),
      c("Regenwasser (Fass)", "2 SM", "material", "icons/containers/barrels/barrel-oak-banded-tan.webp"),
      c("Kompost", "1 SM", "material", "icons/consumables/grains/sack-rice-flour-brown.webp"),
      c("Wurmkiste mit Kompostwürmern", "3 GM", "material", "icons/containers/boxes/crate-heavy-yellow.webp")
    ]],
    ["Pflanzen & Deko", [
      c("Venusfliegenfalle „Schnappi“", "2 GM", "plant", "icons/consumables/plants/thorned-curled-vine-green.webp", "Hält das Zimmer frei von Insekten."),
      c("Sprechende Topfblume", "25 GM", "plant", "icons/commodities/flowers/blooms-pink.webp", "Kennt genau drei Sätze.", "common"),
      c("Nachtglimm-Farn", "15 GM", "plant", "icons/consumables/plants/kelp-fern-glowing-green.webp", "Spendet dämmriges Licht in 1,5 m Umkreis.", "common"),
      c("Wetterblume", "10 GM", "plant", "icons/commodities/flowers/cornflower-blue.webp", "Schließt sich eine Stunde, bevor es regnet."),
      c("Wachhund-Efeu", "30 GM", "plant", "icons/consumables/plants/thorned-stem-brown.webp", "Raschelt laut, wenn Fremde den Raum betreten.", "common"),
      c("Duftgeranie", "5 SM", "plant", "icons/commodities/flowers/blooms-purple.webp"),
      c("Bonsai-Wolkenkiefer", "40 GM", "plant", "icons/environment/wilderness/tree-oak.webp"),
      c("Sonnentau", "3 GM", "plant", "icons/consumables/plants/leaf-pink.webp"),
      c("Kaktus „Prüfungsfreund“", "5 SM", "plant", "icons/consumables/plants/thorned-dried-stem-red.webp"),
      c("Teichlilie", "2 GM", "plant", "icons/consumables/plants/lily-pad-leaf-stem.webp"),
      c("Thymian (Topf)", "2 KM", "plant", "icons/consumables/plants/herb-marjoram-basil-oregano-leaf-bunch-green.webp"),
      c("Salbei (Topf)", "2 KM", "plant", "icons/consumables/plants/leaf-herb-green.webp"),
      c("Petersilie (Topf)", "2 KM", "plant", "icons/consumables/plants/dill-herb-bundle-green.webp"),
      c("Schnittlauch (Topf)", "2 KM", "plant", "icons/consumables/plants/sprout-leaf-herb-green.webp"),
      c("Teemischung Minze-Lavendel", "3 SM", "plant", "icons/consumables/plants/mint-dried-green.webp"),
      c("Teemischung Kamille", "2 SM", "plant", "icons/consumables/plants/dried-stem-vine-root-bramble-brown.webp"),
      c("Teemischung Rosenblüte", "5 SM", "plant", "icons/commodities/flowers/rosaecia-red.webp"),
      c("Getrockneter Blumenstrauß", "1 GM", "plant", "icons/commodities/flowers/cornflower-gold.webp"),
      c("Blumenkranz", "5 SM", "plant", "icons/magic/nature/leaf-oak-wreath-glow-green.webp"),
      c("Ansteckblume für Bälle", "2 SM", "plant", "icons/commodities/flowers/lotus-white.webp")
    ]]
  ]],

  ["Allgemeiner Laden", [
    ["Abenteuerausrüstung", [
      s("Rucksack", "2 GM", "phbagBackpack000"),
      s("Schlafsack", "1 GM", "phbagBedroll0000"),
      s("Zelt", "2 GM", "phbagTent0000000"),
      s("Hanfseil (15 m)", "1 GM", "phbagRope0000000"),
      s("Seidenseil (15 m)", "10 GM", "phbagRope0000000", "Leichter und geschmeidiger als Hanfseil."),
      s("Kletterhaken (Eisen)", "5 KM", "phbagSpikesIron0"),
      s("Enterhaken", "2 GM", "phbagGrapplingHo"),
      s("Kapuzenlaterne", "5 GM", "phbagLanternHood"),
      s("Blendlaterne", "10 GM", "phbagLanternBull"),
      s("Lampenöl", "1 SM", "phbagOil00000000"),
      s("Fackel", "1 KM", "phbagTorch000000"),
      s("Zunderkästchen", "5 SM", "phbagTinderbox00"),
      s("Feldflasche", "2 SM", "phbagWaterskin00"),
      s("Rationen (1 Tag)", "5 SM", "phbagRations0000"),
      s("Kochgeschirr", "2 SM", "phbagPotIron0000"),
      s("Brecheisen", "2 GM", "phbagCrowbar0000"),
      c("Hammer", "1 GM", "gear", "icons/tools/hand/hammer-and-nail.webp"),
      s("Schaufel", "2 GM", "phbagShovel00000"),
      s("Kette (3 m)", "5 GM", "phbagChain000000"),
      s("Vorhängeschloss", "10 GM", "phbagLock0000000"),
      s("Krähenfüße", "1 GM", "phbagCaltrops000"),
      s("Murmeln", "1 GM", "phbagBallBearing"),
      s("Spiegel", "5 GM", "phbagMirror00000"),
      s("Fernrohr", "1000 GM", "phbagSpyglass100"),
      c("Fernglas „Möwenblick“", "200 GM", "gear", "icons/tools/navigation/spyglass-telescope-brass-blue.webp", "Ein kleineres, günstigeres Fernrohr aus Inselfertigung."),
      s("Karte der Insel Stratos", "5 GM", "phbagMap00000000"),
      s("Seekarte", "20 GM", "phbagMap00000000"),
      c("Kompass", "25 GM", "gear", "icons/tools/navigation/compass-brass-blue-red.webp"),
      s("Signalpfeife", "5 KM", "phbagSignalWhist"),
      s("Glocke", "1 GM", "phbagBell0000000"),
      c("Kreide", "1 KM", "gear", "icons/commodities/stone/rock-chunk-pumice-white.webp"),
      s("Netz", "1 GM", "phbagNet00000000"),
      c("Angelausrüstung", "1 GM", "gear", "icons/tools/fishing/rod-brown-gold.webp"),
      s("Jagdfalle", "5 GM", "phbagHuntingTrap")
    ]],
    ["Schule & Schreibwaren", [
      s("Tinte", "10 GM", "phbagInk00000000"),
      s("Schreibfeder", "2 KM", "phbagInkPen00000"),
      s("Pergament (1 Blatt)", "1 SM", "phbagParchment00"),
      s("Papier (1 Blatt)", "2 SM", "phbagPaper000000"),
      s("Notizbuch", "25 GM", "phbagBook0000000", "Ein leeres, gebundenes Buch."),
      c("Schulranzen", "3 GM", "gear", "icons/containers/bags/pack-leather-strapped-tan.webp"),
      c("Federmäppchen", "5 SM", "gear", "icons/containers/bags/case-leather-tan.webp"),
      c("Lineal & Zirkel", "1 GM", "gear", "icons/tools/navigation/sextant-brass-brown.webp"),
      c("Schiefertafel & Kreide", "5 SM", "gear", "icons/commodities/stone/paver-tile-grey.webp"),
      c("Bücherriemen", "2 SM", "gear", "icons/sundries/survival/leather-strap-brown.webp"),
      c("Siegelring-Rohling", "5 GM", "gear", "icons/equipment/finger/ring-band-copper.webp"),
      c("Briefumschlag", "1 KM", "gear", "icons/sundries/documents/envelope-sealed-red-tan.webp"),
      c("Kerzen-Set fürs Nachtlernen", "5 SM", "gear", "icons/sundries/lights/candle-unlit-tan.webp"),
      c("Akademie-Schal in Hausfarben", "1 GM", "clothing", "icons/equipment/waist/sash-cloth-gold-purple.webp"),
      c("Akademie-Uniform (Ersatz)", "5 GM", "clothing", "icons/equipment/chest/robe-layered-blue.webp"),
      s("Ballkleidung", "15 GM", "phbagClothesFine"),
      s("Lehrbuch", "15 GM", "phbagBook0000000", "Je nach Fach 10 bis 25 GM.")
    ]],
    ["Kleidung & Pflege", [
      c("Gewöhnliche Kleidung", "5 SM", "clothing", "icons/equipment/chest/shirt-collared-brown.webp"),
      s("Reisekleidung", "2 GM", "phbagClothesTrav"),
      c("Regenmantel", "1 GM", "clothing", "icons/equipment/back/cloak-hooded-blue.webp"),
      c("Winterumhang", "1 GM", "clothing", "icons/equipment/back/cloak-heavy-fur-blue.webp"),
      c("Stiefel", "1 GM", "clothing", "icons/equipment/feet/boots-leather-laced-brown.webp"),
      c("Handschuhe", "5 SM", "clothing", "icons/equipment/hand/glove-simple-leather-green.webp"),
      c("Hut", "2 SM", "clothing", "icons/equipment/head/hat-belted-simple.webp"),
      c("Seife", "2 KM", "gear", "icons/sundries/survival/soap.webp"),
      s("Parfüm", "5 GM", "phbagPerfume0000"),
      c("Kamm & Bürste", "5 SM", "gear", "icons/tools/hand/brush-paint-brown-tan.webp"),
      c("Rasiermesser", "1 GM", "gear", "icons/tools/hand/chisel-steel-brown.webp"),
      c("Nähzeug", "5 SM", "gear", "icons/commodities/cloth/thread-spindle-white-needle.webp"),
      c("Handtuch", "2 SM", "gear", "icons/commodities/cloth/cloth-roll-worn-blue.webp")
    ]],
    ["Haushalt & Krimskrams", [
      s("Decke", "5 SM", "phbagBlanket0000"),
      c("Kissen", "3 SM", "gear", "icons/commodities/materials/material-cotton-white.webp"),
      s("Eimer", "5 KM", "phbagBucket00000"),
      c("Besen", "2 SM", "gear", "icons/tools/hand/broom-straw-brown.webp"),
      c("Teekessel", "1 GM", "gear", "icons/tools/cooking/pot-camping-iron-black.webp"),
      c("Teeservice", "5 GM", "gear", "icons/containers/kitchenware/vase-clay-painted-brown-white.webp"),
      c("Becher", "2 KM", "gear", "icons/containers/kitchenware/goblet-worn-clay-white.webp"),
      s("Spielkarten", "5 SM", "phbgstPlayingcar"),
      s("Drachenschach (Reiseset)", "2 GM", "phbgstDragonches"),
      s("Drachenschach (Edelset)", "25 GM", "phbgstDragonches", "Handgeschnitzte Figuren auf einem Brett mit Intarsien."),
      s("Würfelset", "1 SM", "phbgstDice000000"),
      s("Flöte", "2 GM", "phbmusFlute00000"),
      s("Laute", "35 GM", "phbmusLute000000"),
      s("Trommel", "6 GM", "phbmusDrum000000"),
      c("Kreisel", "1 SM", "gear", "icons/commodities/treasure/token-brass-round.webp"),
      c("Puppe", "5 SM", "gear", "icons/commodities/treasure/figurine-idol.webp"),
      c("Kuscheltier Inselmöwe", "1 GM", "gear", "icons/commodities/materials/feather-white.webp"),
      c("Vogelkäfig", "5 GM", "gear", "icons/containers/misc/basket-handle-woven-gold.webp"),
      c("Leine", "5 SM", "gear", "icons/sundries/misc/pet-collar-red.webp"),
      c("Tierfutter (1 Tag)", "2 KM", "gear", "icons/consumables/grains/sack-oats-glowing-white.webp"),
      c("Seifenblasenstab", "2 KM", "gear", "icons/sundries/survival/soap.webp")
    ]],
    ["Werkzeugsets", [
      s("Diebeswerkzeug", "25 GM", "phbtulThievesToo"),
      s("Schmiedewerkzeug", "20 GM", "phbtulSmithsTool"),
      s("Tischlerwerkzeug", "8 GM", "phbtulCarpenters"),
      s("Kalligrafiebedarf", "10 GM", "phbtulCalligraph"),
      s("Malerbedarf", "10 GM", "phbtulPaintersSu"),
      s("Kartografenwerkzeug", "15 GM", "phbtulCartograph"),
      s("Navigationswerkzeug", "25 GM", "phbtulNavigators"),
      s("Verkleidungsausrüstung", "25 GM", "phbtulDisguiseKi"),
      s("Fälscherausrüstung", "15 GM", "phbtulForgeryKit"),
      s("Kochutensilien", "1 GM", "phbtulCooksUtens"),
      s("Ledererwerkzeug", "5 GM", "phbtulLeatherwor"),
      s("Weberwerkzeug", "1 GM", "phbtulWeaversToo"),
      s("Juwelierwerkzeug", "25 GM", "phbtulJewelersTo")
    ]],
    ["Reisen & Transport", [
      c("Fährticket zum Festland", "5 SM", "service", "icons/environment/settlement/ship.webp"),
      c("Bootsmiete (1 Tag)", "2 GM", "service", "icons/tools/nautical/anchor-blue.webp"),
      c("Ruderboot", "50 GM", "gear", "icons/tools/nautical/anchor-blue-orange.webp"),
      c("Windgleiter-Rundflug", "5 GM", "service", "icons/commodities/treasure/trinket-wing-white.webp", "Ein Mietflug einmal rund um die Insel."),
      c("Reittier leihen (1 Tag)", "5 SM", "service", "icons/tools/smithing/horseshoe-steel-blue.webp"),
      c("Kutschfahrt über die Insel", "2 SM", "service", "icons/tools/smithing/horsehoe-worn-steel-grey.webp")
    ]]
  ]]
];

function PAUSCHALE() {
  return "Pauschale bis zur nächsten Stadt (etwa 25 bis 30 Tage), mit Frühstück. Wer früher auszieht, bekommt nichts zurück.";
}

/* -------------------------------------------- */
/*  Snapshot mode                                */
/* -------------------------------------------- */

function allRows() {
  return SHOPS.flatMap(([, subs]) => subs.flatMap(([, rows]) => rows));
}

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".yml") ? [p] : [];
  });
}

if (process.argv[2] === "--snapshot") {
  const src = process.argv[3];
  if (!src || !existsSync(src)) {
    console.error("Usage: node tools/generate-shop-pack.mjs --snapshot <dnd5e>/packs/_source/equipment24");
    process.exit(1);
  }
  const { load } = await import("js-yaml"); // only for snapshots; comes with @foundryvtt/foundryvtt-cli
  const wanted = new Set(allRows().filter((r) => r.srd).map((r) => r.srd));
  const out = {};
  for (const file of walk(src)) {
    const doc = load(readFileSync(file, "utf8"));
    if (!wanted.has(doc?._id)) continue;
    out[doc._id] = { name: doc.name, type: doc.type, img: doc.img, system: doc.system, effects: doc.effects ?? [], flags: doc.flags?.dnd5e ? { dnd5e: doc.flags.dnd5e } : {} };
  }
  const missing = [...wanted].filter((id) => !out[id]);
  if (missing.length) {
    console.error(`Missing in ${src}: ${missing.join(", ")}`);
    process.exit(1);
  }
  mkdirSync(path.dirname(SNAPSHOT), { recursive: true });
  writeFileSync(SNAPSHOT, `${JSON.stringify(out, null, 1)}\n`, "utf8");
  console.log(`Wrote ${Object.keys(out).length} SRD items to ${path.relative(ROOT, SNAPSHOT)}`);
  process.exit(0);
}

/* -------------------------------------------- */
/*  Build                                        */
/* -------------------------------------------- */

const DENOM = { KM: "cp", SM: "sp", GM: "gp" };
function price(text) {
  const [, value, unit] = text.match(/^([\d.]+) (KM|SM|GM)$/);
  return { value: Number(value), denomination: DENOM[unit] };
}

function customSystem(row) {
  const kind = KINDS[row.kind];
  const system = {
    description: { value: row.text ? `<p>${row.text}</p>` : "", chat: "" },
    quantity: 1,
    weight: { value: 0, units: "lb" },
    price: price(row.price),
    rarity: row.rarity,
    identified: true,
    type: { value: kind.sub, subtype: "" },
    source: { custom: SOURCE }
  };
  if (kind.uses) system.uses = { max: "1", spent: 0, recovery: [], autoDestroy: true };
  if (row.rarity && row.kind !== "gear" && row.kind !== "plant" && row.kind !== "material") system.properties = ["mgc"];
  return system;
}

const srdBase = JSON.parse(readFileSync(SNAPSHOT, "utf8"));

mkdirSync(DIR, { recursive: true });
for (const f of readdirSync(DIR)) if (f.endsWith(".json")) rmSync(path.join(DIR, f));

const write = (doc) => writeFileSync(path.join(DIR, `${doc._id}.json`), `${JSON.stringify(doc, null, 2)}\n`, "utf8");
const folderDoc = (id, name, parent, sort) => ({
  _id: id, name, type: "Item", folder: parent, sorting: "m", sort, color: null, description: "", flags: {}, _key: `!folders!${id}`
});

let count = 0;
SHOPS.forEach(([shop, subs], i) => {
  const shopId = stableId(`shop-folder:${shop}`);
  write(folderDoc(shopId, shop, null, (i + 1) * 100));
  subs.forEach(([sub, rows], j) => {
    const subId = stableId(`shop-folder:${shop}/${sub}`);
    write(folderDoc(subId, sub, shopId, (j + 1) * 100));
    rows.forEach((row, k) => {
      const id = stableId(`shop:${shop}/${sub}/${row.name}`);
      let doc;
      if (row.srd) {
        const base = structuredClone(srdBase[row.srd]);
        const note = row.text ? `<p>${escHtml(row.text)}</p><hr>` : "";
        base.system.description.value = `${note}${base.system.description.value ?? ""}`;
        base.system.price = price(row.price);
        base.system.source = { ...base.system.source, custom: SOURCE };
        doc = {
          _id: id, name: row.name, type: base.type, img: base.img, system: base.system,
          effects: base.effects.map((e) => ({ ...e, _key: `!items.effects!${id}.${e._id}` })),
          flags: { ...base.flags, [MODULE_ID]: { shop: true, srd: `Compendium.dnd5e.equipment24.Item.${row.srd}` } }
        };
      } else {
        doc = {
          _id: id, name: row.name, type: KINDS[row.kind].type, img: row.img ?? KINDS[row.kind].img,
          system: customSystem(row), effects: [], flags: { [MODULE_ID]: { shop: true } }
        };
      }
      write({ ...doc, folder: subId, sort: (k + 1) * 100, ownership: { default: 0 }, _key: `!items!${id}` });
      count++;
    });
  });
});
console.log(`Wrote ${count} items to ${path.relative(ROOT, DIR)}`);
