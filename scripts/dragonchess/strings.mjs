/**
 * Dragonchess is entirely German — the source rulebook, the club fiction,
 * and the world piece names (Drache, Bastion, Magus, Greif, Knappe, König)
 * are all German, so mixing in English UI text around them read as a weird
 * language mash-up. Rather than following the Foundry world's active
 * language (which could be English, producing exactly that mix), this
 * feature's text is hard-coded German — the same choice already made for
 * unblooded-sorcery.mjs's English text, just the other language.
 *
 * `t`/`tf` below mimic game.i18n.localize()/format() (dotted-path lookup,
 * `{placeholder}` substitution) but read from this file instead of the
 * world's active `lang/*.json`. A handful of strings Foundry itself
 * localizes directly (scene-control titles, the window title, world-setting
 * names/hints) can't go through these — those are hard-coded German at
 * their declaration site instead; see index.mjs and the settings.register
 * calls in game.mjs.
 */

const STRINGS = {
  Difficulty: {
    Knappe: "Knappe (sehr schwach)",
    Student: "Student (schwach)",
    Magister: "Magister (stark)",
    Drache: "Drache (sehr stark)"
  },
  Launch: {
    Title: "Herausforderung zu Dragonchess",
    Intro: "Ziele auf ein Spieler-Token und ein NSC-Token, bevor du diesen Knopf drueckst. Der Spieler des Spieler-Tokens erhaelt eine Einladung.",
    NpcControl: "NSC gespielt von",
    NpcBot: "dem Dragonchess-Bot",
    NpcGm: "mir (dem Spielleiter)",
    Difficulty: "Bot-Schwierigkeit",
    Invite: "Einladung senden",
    Cancel: "Abbrechen",
    AlreadyRunningTitle: "Dragonchess laeuft bereits",
    AlreadyRunningBody: "Es laeuft bereits eine Dragonchess-Partie oder wartet auf eine Antwort. Eine neue Partie ersetzt sie. Fortfahren?",
    NeedTwoTargets: "Ziele zuerst genau zwei Tokens: einen Spieler-Charakter und einen NSC.",
    NeedOnePcOneNpc: "Eines der Ziel-Tokens braucht einen Spieler als Besitzer (der SC), das andere nicht (der NSC).",
    ChallengeTitle: "Zu Dragonchess herausfordern",
    ChallengeConfirmBody: "<strong>{opponent}</strong> zu einer Partie Dragonchess herausfordern?",
    NeedGmOnline: "Ein Spielleiter muss angemeldet sein, um eine Dragonchess-Partie zu leiten.",
    NeedOneTarget: "Ziele zuerst auf genau ein Token eines anderen Spielers und kontrolliere dann dein eigenes.",
    NeedOtherPlayerToken: "Das Ziel-Token muss einem anderen Spieler gehoeren.",
    NeedOwnToken: "Kontrolliere zuerst das Token deines eigenen Charakters.",
    ChallengeSent: "Herausforderung gesendet! Warte auf eine Antwort …",
    ChallengeBusy: "Es laeuft bereits eine Dragonchess-Partie — versuch es erneut, wenn sie vorbei ist."
  },
  Invite: {
    Title: "Dragonchess-Herausforderung",
    Body: "<strong>{challenger}</strong> fordert dich zu einer Partie Dragonchess heraus: <strong>{pc}</strong> gegen <strong>{npc}</strong>. Nimmst du an?",
    Accept: "Annehmen",
    Decline: "Ablehnen"
  },
  Rps: {
    Schere: "Schere",
    Stein: "Stein",
    Papier: "Papier",
    GmTitle: "Schere, Stein, Papier",
    GmBody: "Waehle den Wurf von {npc}.",
    PlayerTitle: "Schere, Stein, Papier",
    PlayerBody: "Waehle deinen Wurf, um zu sehen, wer zuerst seine Farbe waehlen darf."
  },
  Color: {
    Blau: "Blau",
    Rot: "Rot",
    GmTitle: "Farbe waehlen",
    GmBody: "Du hast den Wurf gewonnen. Waehle die Farbe des NSC.",
    PlayerTitle: "Farbe waehlen",
    PlayerBody: "Du hast den Wurf gewonnen! Waehle deine Farbe — Blau zieht zuerst."
  },
  Notify: {
    InvitationSent: "{player} wurde zu einer Dragonchess-Partie eingeladen: {pc} gegen {npc}.",
    Declined: "{player} hat die Dragonchess-Herausforderung gegen {npc} abgelehnt.",
    RpsResult: "{player} warf {pcChoice}, fuer den NSC wurde {npcChoice} geworfen — {winner} gewinnt den Wurf.",
    GameStart: "Dragonchess beginnt: {pc} spielt {pcColor}, {npc} spielt {npcColor}. Blau zieht zuerst.",
    NoActiveGame: "Es laeuft gerade keine Dragonchess-Partie.",
    EndTitle: "Dragonchess — Spielende",
    EndStalemate: "Die Partie endet im Patt — unentschieden.",
    EndResign: "{winner} gewinnt durch Aufgabe.",
    EndKingCaptured: "{winner} gewinnt — der gegnerische Koenig ist gefallen!",
    EndCheckmate: "{winner} gewinnt durch Matt."
  },
  Log: {
    GameStart: "Die Partie beginnt — {pcColor} gegen {npcColor}. Blau zieht zuerst.",
    AttackFlavor: "{attacker} greift {defender} an — braucht {dc}+",
    Hit: "Erfolg!",
    Miss: "Fehlschlag!",
    KingAttack: "{attacker} schlaegt {defender} nieder — ein Angriff auf den Koenig gelingt immer.",
    KingAttackerNoRoll: "{attacker} greift {defender} an — ein Angriff des Koenigs gelingt immer.",
    KingCapturedLine: "{attacker} schlaegt den gegnerischen Koenig!",
    KingCapturesLine: "{attacker} ueberwaeltigt {defender} — ein Angriff des Koenigs gelingt immer.",
    CaptureSuccessLine: "{attacker} besiegt {defender} ({roll}) und nimmt das Feld ein, eingegraben.",
    CaptureFailLine: "{attacker} faellt gegen {defender} ({roll}) — {defender} haelt das Feld, eingegraben.",
    CastleLine: "{color} rochiert {side}.",
    SideKing: "kurz",
    SideQueen: "lang",
    PromotionLine: "Ein Knappe erreicht {square} und wird zum Drachen!",
    MoveLine: "{piece} zieht {from}-{to}."
  },
  Board: {
    WindowTitle: "Dragonchess",
    NoGame: "Es gibt keine Dragonchess-Partie anzuzeigen.",
    Waiting: "Warte auf die Antwort zur Einladung …",
    Declined: "Die Einladung zu dieser Dragonchess-Partie wurde abgelehnt.",
    AttackBanner: "{attacker} greift {defender} an — braucht {needed}+ …",
    KingAttackBanner: "{attacker} greift den Koenig an — {defender} hat dagegen keine Abwehr …",
    KingAttackerBanner: "{attacker} greift {defender} an — der Angriff des Koenigs gelingt immer!",
    EntrenchedNote: "(eingegraben — Wurf mit Nachteil)",
    EntrenchedTooltip: "Eingegraben — der naechste Angriff auf dieses Feld hat Nachteil.",
    EndStalemate: "Patt — die Partie endet unentschieden.",
    EndResign: "{winner} gewinnt durch Aufgabe.",
    EndKingCaptured: "{winner} gewinnt — der gegnerische Koenig ist gefallen!",
    EndCheckmate: "{winner} gewinnt durch Matt.",
    TurnBanner: "{color} ist am Zug ({name})",
    NoPieces: "keine Figuren mehr",
    Resign: "Aufgeben",
    EndGame: "Spiel beenden",
    ResignConfirmTitle: "Partie aufgeben?",
    ResignConfirmBody: "Willst du diese Dragonchess-Partie wirklich aufgeben?",
    EndGameTitle: "Spiel beenden",
    EndGameBody: "Einen Sieger festlegen und die Partie sofort beenden.",
    EndGameWinner: "{name} gewinnt"
  }
};

function lookup(key) {
  const value = key.split(".").reduce((obj, part) => obj?.[part], STRINGS);
  if (value == null) {
    console.warn(`fimblewood-academy | Dragonchess: missing string "${key}"`);
    return key;
  }
  return value;
}

/** Mimics game.i18n.localize() for a dotted key into STRINGS above. */
export function t(key) {
  return lookup(key);
}

/** Mimics game.i18n.format(): t(key) with {placeholder} substitution from data. */
export function tf(key, data = {}) {
  let text = lookup(key);
  for (const [k, v] of Object.entries(data)) text = text.replaceAll(`{${k}}`, String(v ?? ""));
  return text;
}
