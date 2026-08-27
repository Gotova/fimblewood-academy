/**
 * Dragonchess referee.
 *
 * The GM client is the single source of truth: players never write game
 * state directly. A player action (accepting an invite, an RPS pick, a
 * colour choice, a move, a resignation) is sent as a broadcast socket
 * message that every client receives and only the GM client acts on — the
 * same self-filtering idiom the Jukebox and Draw Pad already use for
 * GM-only reactions, just also filtered by a target `userId` for the
 * messages that are meant for one specific player (mirroring how
 * `liveDrawingStart` self-filters to "not the GM" instead of naming a user,
 * generalised here to name one).
 *
 * Durable state (the whole match, including the board) lives in the world
 * setting `dragonchessGame`. Foundry replicates world-setting writes to
 * every connected client and fires each client's own onChange callback, so
 * that alone is what keeps every open board window in sync — no separate
 * "here is the new state" broadcast is needed. Only one Dragonchess match
 * is tracked at a time; starting a new one after the previous one ended (or
 * was declined) simply replaces it.
 */

import {
  createInitialState, generateMoves, makeMove, gameStatus, hitChance, opponent,
  PIECE_VALUES, algebraic
} from "./rules.mjs";
import { chooseMove, difficultyPreset } from "./engine.mjs";

const MODULE_ID = "fimblewood-academy";
const CHANNEL = `module.${MODULE_ID}`;

export const GAME_SETTING = "dragonchessGame";
export const DIFFICULTY_SETTING = "dragonchessDifficulty";
export const ROLL_DELAY_SETTING = "dragonchessRollDelay";
export const KINGS_MAY_TOUCH_SETTING = "dragonchessKingsMayTouch";

/** Fixed (non-configurable) duration of the arrow-forms-then-piece-slides
 * animation that plays before a Schlagzug's roll delay (or immediately, for
 * a quiet move) — see processMove(). Every client times its own local
 * animation to this same constant so they all settle in step. */
export const MOVE_ANIMATION_MS = 700;
/** How much of MOVE_ANIMATION_MS is the arrow forming; the remainder is the piece's slide. */
export const ARROW_ANIMATION_MS = 300;

export const PIECE_DISPLAY = { k: "König", q: "Drache", r: "Bastion", b: "Magus", n: "Greif", p: "Knappe" };
export const PIECE_GLYPH = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
export const COLOR_LABEL = { w: "Blau", b: "Rot" };

const i18n = (k) => game.i18n.localize(`FIMBLEWOOD.Dragonchess.${k}`);
const fmt = (k, data) => game.i18n.format(`FIMBLEWOOD.Dragonchess.${k}`, data);

function pieceLabel(type, color) {
  return `${PIECE_DISPLAY[type]} (${COLOR_LABEL[color]})`;
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

/* -------------------------------------------- */
/*  Persisted game record                        */
/* -------------------------------------------- */

export function getGameRecord() {
  return foundry.utils.deepClone(game.settings.get(MODULE_ID, GAME_SETTING));
}

async function setGameRecord(record) {
  if (!game.user.isGM) return;
  await game.settings.set(MODULE_ID, GAME_SETTING, record);
}

function ruleOptions() {
  return { kingsMayTouch: game.settings.get(MODULE_ID, KINGS_MAY_TOUCH_SETTING) };
}

export function roleForCurrentUser(record) {
  if (!record) return null;
  if (game.user.isGM) return "gm";
  if (game.user.id === record.pcUserId || (record.opponentUserId && game.user.id === record.opponentUserId)) return "player";
  return "spectator";
}

/**
 * Which colour `userId` controls in `record`, or null if they don't control
 * either side. `record.opponentUserId` is set only for a player-vs-player
 * match (see launchPvpChallenge) — it names whichever real user plays the
 * "npc" seat, which otherwise belongs to the bot or the GM playing by hand.
 */
export function seatColorForUser(record, userId) {
  if (!record) return null;
  if (userId === record.pcUserId) return record.pcColor;
  if (record.opponentUserId && userId === record.opponentUserId) return record.npcColor;
  return null;
}

/** Like seatColorForUser, but also covers the GM manually playing the NPC's side by hand. */
export function mySideForCurrentUser(record) {
  const seat = seatColorForUser(record, game.user.id);
  if (seat) return seat;
  if (game.user.isGM && record && !record.npcIsBot && !record.opponentUserId) return record.npcColor;
  return null;
}

/* -------------------------------------------- */
/*  Board window lifecycle                       */
/* -------------------------------------------- */

let _boardInstance = null;
let _lastSeenGameId = null;
let _lastSeenPhase = null;

async function importBoardApp() {
  // Deferred import avoids a circular dependency (board-app.mjs needs several
  // helpers exported from this file).
  const mod = await import("./board-app.mjs");
  return mod.DragonchessBoardApp;
}

export async function openBoardForCurrentUser(record = getGameRecord()) {
  if (!record) {
    ui.notifications.warn(i18n("Notify.NoActiveGame"));
    return;
  }
  const role = roleForCurrentUser(record);
  const DragonchessBoardApp = await importBoardApp();
  if (!_boardInstance || !_boardInstance.rendered) {
    _boardInstance = new DragonchessBoardApp({ gameId: record.id, role });
    _boardInstance.render(true);
  } else {
    _boardInstance.gameId = record.id;
    _boardInstance.role = role;
    _boardInstance.render();
    _boardInstance.bringToTop();
  }
}

async function onGameRecordChanged(record) {
  const isNewGame = record && record.id !== _lastSeenGameId;
  const enteringPlaying = !!record && record.phase === "playing" && (isNewGame || _lastSeenPhase !== "playing");
  _lastSeenPhase = record?.phase ?? null;
  _lastSeenGameId = record?.id ?? null;

  if (enteringPlaying) {
    await openBoardForCurrentUser(record);
  } else if (_boardInstance?.rendered) {
    _boardInstance.render();
  }
  ui.controls?.render();
}

/* -------------------------------------------- */
/*  Pending player-response waiters              */
/* -------------------------------------------- */

const _pending = new Map();
function waitFor(key) { return new Promise((resolve) => _pending.set(key, resolve)); }
function resolvePending(key, value) {
  const resolve = _pending.get(key);
  if (resolve) { resolve(value); _pending.delete(key); }
}

function emit(type, payload) {
  game.socket.emit(CHANNEL, { type, ...payload });
}

/** Ask a specific user (by socket round-trip) for an RPS throw or a colour choice. */
function requestPlayerChoice(kind, gameId, userId) {
  emit(kind === "rps" ? "dcRpsRequest" : "dcColorRequest", { gameId, userId });
  return waitFor(`${kind}:${gameId}:${userId}`);
}

function randomRpsChoice() { return ["schere", "stein", "papier"][Math.floor(Math.random() * 3)]; }
function randomColorChoice() { return Math.random() < 0.5 ? "w" : "b"; }

/* -------------------------------------------- */
/*  Launching a game (GM)                        */
/* -------------------------------------------- */

function primaryOwnerOf(actor) {
  if (!actor) return null;
  return game.users.find((u) => !u.isGM && u.active !== false && actor.testUserPermission(u, "OWNER"))
    ?? game.users.find((u) => !u.isGM && actor.testUserPermission(u, "OWNER"))
    ?? null;
}

async function chooseDifficultyDialog() {
  const current = game.settings.get(MODULE_ID, DIFFICULTY_SETTING);
  const options = ["knappe", "student", "magister", "drache"]
    .map((key) => `<option value="${key}" ${key === current ? "selected" : ""}>${i18n(`Difficulty.${key[0].toUpperCase()}${key.slice(1)}`)}</option>`)
    .join("");
  return foundry.applications.api.DialogV2.wait({
    window: { title: i18n("Launch.Title") },
    content: `
      <p>${i18n("Launch.Intro")}</p>
      <label>${i18n("Launch.NpcControl")}
        <select name="npcControl">
          <option value="bot">${i18n("Launch.NpcBot")}</option>
          <option value="gm">${i18n("Launch.NpcGm")}</option>
        </select>
      </label>
      <label>${i18n("Launch.Difficulty")}
        <select name="difficulty">${options}</select>
      </label>`,
    buttons: [
      {
        action: "start", label: i18n("Launch.Invite"), default: true, type: "button",
        callback: (event, button) => ({ npcControl: button.form.elements.npcControl.value, difficulty: button.form.elements.difficulty.value })
      },
      { action: "cancel", label: i18n("Launch.Cancel"), type: "button", callback: () => null }
    ],
    rejectClose: false
  });
}

/** Entry point for the scene-control button. Reads the GM's current targets. */
export async function launchDragonchess() {
  if (!game.user.isGM) return;

  const existing = getGameRecord();
  if (existing && !["ended", "declined", null].includes(existing.phase)) {
    const proceed = await foundry.applications.api.DialogV2.confirm({
      window: { title: i18n("Launch.AlreadyRunningTitle") },
      content: `<p>${i18n("Launch.AlreadyRunningBody")}</p>`,
      rejectClose: false
    });
    if (!proceed) return;
  }

  const targets = Array.from(game.user.targets ?? []);
  if (targets.length !== 2) {
    ui.notifications.warn(i18n("Launch.NeedTwoTargets"));
    return;
  }

  const [a, b] = targets;
  const ownerA = primaryOwnerOf(a.actor);
  const ownerB = primaryOwnerOf(b.actor);
  let pcToken, pcUser, npcToken;
  if (ownerA && !ownerB) { pcToken = a; pcUser = ownerA; npcToken = b; }
  else if (ownerB && !ownerA) { pcToken = b; pcUser = ownerB; npcToken = a; }
  else {
    ui.notifications.warn(i18n("Launch.NeedOnePcOneNpc"));
    return;
  }

  const choice = await chooseDifficultyDialog();
  if (!choice) return;

  const record = {
    id: foundry.utils.randomID(),
    createdAt: Date.now(),
    pcUserId: pcUser.id,
    pcActorName: pcToken.actor?.name ?? pcToken.name,
    pcTokenUuid: pcToken.document.uuid,
    npcActorName: npcToken.actor?.name ?? npcToken.name,
    npcTokenUuid: npcToken.document.uuid,
    npcIsBot: choice.npcControl === "bot",
    difficulty: choice.difficulty,
    phase: "invited",
    pcColor: null,
    npcColor: null,
    state: null,
    announce: null,
    log: [],
    result: null
  };
  await setGameRecord(record);

  emit("dcInvite", {
    gameId: record.id, userId: pcUser.id, challengerName: game.user.name,
    pcActorName: record.pcActorName, npcActorName: record.npcActorName
  });
  ChatMessage.create({
    content: fmt("Notify.InvitationSent", { player: pcUser.name, pc: record.pcActorName, npc: record.npcActorName })
  });
}

/* -------------------------------------------- */
/*  Launching a player-vs-player challenge       */
/* -------------------------------------------- */

/**
 * Entry point for the player-facing "Challenge to Dragonchess" tool. The
 * challenger controls their own token and targets the opponent's; the
 * request is broadcast and only the GM's client acts on it (only the GM can
 * write the world-scope game-state setting), so a GM must be logged in.
 */
export async function launchPvpChallenge() {
  if (game.user.isGM) return;

  if (!game.users.some((u) => u.isGM && u.active)) {
    ui.notifications.warn(i18n("Launch.NeedGmOnline"));
    return;
  }

  const targets = Array.from(game.user.targets ?? []);
  if (targets.length !== 1) {
    ui.notifications.warn(i18n("Launch.NeedOneTarget"));
    return;
  }
  const opponentToken = targets[0];
  const opponentUser = primaryOwnerOf(opponentToken.actor);
  if (!opponentUser || opponentUser.id === game.user.id) {
    ui.notifications.warn(i18n("Launch.NeedOtherPlayerToken"));
    return;
  }

  const myToken = canvas.tokens?.controlled.find((t) => primaryOwnerOf(t.actor)?.id === game.user.id)
    ?? game.user.character?.getActiveTokens()[0];
  if (!myToken) {
    ui.notifications.warn(i18n("Launch.NeedOwnToken"));
    return;
  }

  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: { title: i18n("Launch.ChallengeTitle") },
    content: `<p>${fmt("Launch.ChallengeConfirmBody", { opponent: opponentToken.actor?.name ?? opponentToken.name })}</p>`,
    rejectClose: false
  });
  if (!confirmed) return;

  emit("dcChallengeRequest", {
    challengerUserId: game.user.id,
    challengerActorName: myToken.actor?.name ?? myToken.name,
    challengerTokenUuid: myToken.document.uuid,
    opponentUserId: opponentUser.id,
    opponentActorName: opponentToken.actor?.name ?? opponentToken.name,
    opponentTokenUuid: opponentToken.document.uuid
  });
  ui.notifications.info(i18n("Launch.ChallengeSent"));
}

async function handleChallengeRequest(data) {
  const existing = getGameRecord();
  if (existing && !["ended", "declined"].includes(existing.phase)) {
    emit("dcChallengeBusy", { userId: data.challengerUserId });
    return;
  }

  // Kept consistent with the GM-launched flow's invariant: pcUserId is
  // always the invited party (the one who accepts/declines and whose
  // decline message reads naturally), regardless of who initiated.
  const record = {
    id: foundry.utils.randomID(),
    createdAt: Date.now(),
    pcUserId: data.opponentUserId,
    pcActorName: data.opponentActorName,
    pcTokenUuid: data.opponentTokenUuid,
    npcActorName: data.challengerActorName,
    npcTokenUuid: data.challengerTokenUuid,
    npcIsBot: false,
    opponentUserId: data.challengerUserId,
    difficulty: null,
    phase: "invited",
    pcColor: null,
    npcColor: null,
    state: null,
    announce: null,
    log: [],
    result: null
  };
  await setGameRecord(record);

  emit("dcInvite", {
    gameId: record.id, userId: record.pcUserId, challengerName: game.users.get(data.challengerUserId)?.name ?? record.npcActorName,
    pcActorName: record.pcActorName, npcActorName: record.npcActorName
  });
  ChatMessage.create({
    content: fmt("Notify.InvitationSent", { player: game.users.get(record.pcUserId)?.name ?? "?", pc: record.pcActorName, npc: record.npcActorName })
  });
}

function handleChallengeBusy(data) {
  ui.notifications.warn(i18n("Launch.ChallengeBusy"));
}

/* -------------------------------------------- */
/*  Invitation (player side)                     */
/* -------------------------------------------- */

async function handleInviteReceived(data) {
  const accepted = await foundry.applications.api.DialogV2.confirm({
    window: { title: i18n("Invite.Title") },
    content: `<p>${fmt("Invite.Body", { challenger: data.challengerName, pc: data.pcActorName, npc: data.npcActorName })}</p>`,
    yes: { label: i18n("Invite.Accept") },
    no: { label: i18n("Invite.Decline") },
    rejectClose: false
  }).catch(() => false);
  emit("dcInviteResponse", { gameId: data.gameId, userId: game.user.id, accepted: !!accepted });
}

async function handleInviteResponse(data) {
  const record = getGameRecord();
  if (!record || record.id !== data.gameId || record.phase !== "invited") return;

  if (!data.accepted) {
    record.phase = "declined";
    await setGameRecord(record);
    ChatMessage.create({
      content: fmt("Notify.Declined", { player: game.users.get(record.pcUserId)?.name ?? "?", npc: record.npcActorName })
    });
    return;
  }

  record.phase = "rps";
  await setGameRecord(record);
  await runRockPaperScissorsAndStart(record);
}

/* -------------------------------------------- */
/*  Rock-paper-scissors + colour choice (GM)     */
/* -------------------------------------------- */

const RPS_BEATS = { schere: "papier", stein: "schere", papier: "stein" };

async function promptGmRpsChoice(npcActorName) {
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: i18n("Rps.GmTitle") },
    content: `<p>${fmt("Rps.GmBody", { npc: npcActorName })}</p>`,
    buttons: [
      { action: "schere", label: i18n("Rps.Schere"), type: "button", callback: () => "schere" },
      { action: "stein", label: i18n("Rps.Stein"), type: "button", callback: () => "stein" },
      { action: "papier", label: i18n("Rps.Papier"), type: "button", callback: () => "papier" }
    ],
    rejectClose: false
  });
  return result ?? ["schere", "stein", "papier"][Math.floor(Math.random() * 3)];
}

async function promptGmColorChoice() {
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: i18n("Color.GmTitle") },
    content: `<p>${i18n("Color.GmBody")}</p>`,
    buttons: [
      { action: "w", label: i18n("Color.Blau"), type: "button", callback: () => "w" },
      { action: "b", label: i18n("Color.Rot"), type: "button", callback: () => "b" }
    ],
    rejectClose: false
  });
  return result ?? (Math.random() < 0.5 ? "w" : "b");
}

async function runRockPaperScissorsAndStart(record) {
  let pcChoice = null, npcChoice = null, winner = null;
  while (!winner) {
    const pcPromise = requestPlayerChoice("rps", record.id, record.pcUserId);
    const npcPromise = record.npcIsBot
      ? Promise.resolve(randomRpsChoice())
      : record.opponentUserId
        ? requestPlayerChoice("rps", record.id, record.opponentUserId)
        : promptGmRpsChoice(record.npcActorName);
    [pcChoice, npcChoice] = await Promise.all([pcPromise, npcPromise]);
    if (pcChoice === npcChoice) continue; // tie, roll again
    winner = RPS_BEATS[pcChoice] === npcChoice ? "pc" : "npc";
  }

  ChatMessage.create({
    content: fmt("Notify.RpsResult", {
      player: game.users.get(record.pcUserId)?.name ?? "?",
      pcChoice: i18n(`Rps.${pcChoice[0].toUpperCase()}${pcChoice.slice(1)}`),
      npcChoice: i18n(`Rps.${npcChoice[0].toUpperCase()}${npcChoice.slice(1)}`),
      winner: winner === "pc" ? record.pcActorName : record.npcActorName
    })
  });

  let winnerColor;
  if (winner === "pc") {
    winnerColor = await requestPlayerChoice("color", record.id, record.pcUserId);
  } else if (record.npcIsBot) {
    winnerColor = randomColorChoice();
  } else if (record.opponentUserId) {
    winnerColor = await requestPlayerChoice("color", record.id, record.opponentUserId);
  } else {
    winnerColor = await promptGmColorChoice();
  }
  const loserColor = winnerColor === "w" ? "b" : "w";
  record.pcColor = winner === "pc" ? winnerColor : loserColor;
  record.npcColor = winner === "pc" ? loserColor : winnerColor;
  record.state = createInitialState();
  record.phase = "playing";
  record.log = [{ text: fmt("Log.GameStart", { pcColor: COLOR_LABEL[record.pcColor], npcColor: COLOR_LABEL[record.npcColor] }) }];
  await setGameRecord(record);

  ChatMessage.create({
    content: fmt("Notify.GameStart", {
      pc: record.pcActorName, npc: record.npcActorName,
      pcColor: COLOR_LABEL[record.pcColor], npcColor: COLOR_LABEL[record.npcColor]
    })
  });

  if (isBotTurn(record)) scheduleBotMove(record.id);
}

async function handleRpsChoice(data) { resolvePending(`rps:${data.gameId}:${data.userId}`, data.choice); }
async function handleColorChoice(data) { resolvePending(`color:${data.gameId}:${data.userId}`, data.color); }

/* -------------------------------------------- */
/*  Move resolution                              */
/* -------------------------------------------- */

function isBotTurn(record) {
  return record.phase === "playing" && record.npcIsBot && record.state.turn === record.npcColor;
}

function scheduleBotMove(gameId) {
  const thinkMs = 700 + Math.floor(Math.random() * 900);
  setTimeout(async () => {
    const record = getGameRecord();
    if (!record || record.id !== gameId || record.phase !== "playing" || !isBotTurn(record)) return;
    const preset = difficultyPreset(record.difficulty);
    const move = chooseMove(record.state, { ...preset, kingsMayTouch: ruleOptions().kingsMayTouch });
    if (!move) return;
    await processMove(record, move);
  }, thinkMs);
}

/**
 * Apply a validated legal move to `record`. Every move — quiet or not —
 * gets a beat first: the board shows an arrow forming from the source
 * square to the destination and the piece physically sliding there
 * (MOVE_ANIMATION_MS, played independently by each client off the
 * `announce` field). A Schlagzug then continues into the existing
 * announce → roll-delay → roll → roll-delay → resolve beat on top of that.
 */
async function processMove(record, move) {
  const defenderSq = move.capture ? (move.enPassant ? move.epCapturedSq : move.to) : null;
  const isKingTarget = move.capture && move.capturedType === "k";
  const entrenched = move.capture && record.state.entrenched === defenderSq;
  const attackerLabel = move.capture ? pieceLabel(move.piece.type, move.piece.color) : null;
  const defenderLabel = move.capture ? pieceLabel(move.capturedType, opponent(move.piece.color)) : null;

  record.announce = {
    moveId: foundry.utils.randomID(),
    from: move.from, to: move.to,
    pieceType: move.piece.type, pieceColor: move.piece.color,
    capture: !!move.capture, isKingTarget, entrenched,
    attackerLabel, defenderLabel,
    needed: move.capture && !isKingTarget ? 10 + PIECE_VALUES[move.capturedType] : null
  };
  await setGameRecord(record);
  await sleep(MOVE_ANIMATION_MS);

  if (!move.capture) {
    const next = makeMove(record.state, move, { success: true });
    record.announce = null;
    await finalizeMove(record, move, next, {});
    return;
  }

  const totalDelay = Math.max(0, game.settings.get(MODULE_ID, ROLL_DELAY_SETTING)) * 1000;
  await sleep(totalDelay / 2);

  let success = true, rollTotal = null;
  if (!isKingTarget) {
    const atkVal = PIECE_VALUES[move.piece.type];
    const defVal = PIECE_VALUES[move.capturedType];
    const dc = 10 + defVal;
    const formula = entrenched ? `2d20kl + ${atkVal}` : `1d20 + ${atkVal}`;
    const roll = await new Roll(formula).evaluate();
    const die = roll.dice[0];
    const kept = die.results.find((r) => !r.discarded) ?? die.results[0];
    const natural = kept.result;
    success = natural === 20 ? true : natural === 1 ? false : roll.total >= dc;
    await ChatMessage.create({
      flavor: fmt("Log.AttackFlavor", { attacker: attackerLabel, defender: defenderLabel, dc }),
      content: `<p>${success ? i18n("Log.Hit") : i18n("Log.Miss")}</p>`,
      rolls: [roll]
    });
    rollTotal = roll.total;
  } else {
    ChatMessage.create({ content: fmt("Log.KingAttack", { attacker: attackerLabel, defender: defenderLabel }) });
  }

  await sleep(totalDelay / 2);
  const next = makeMove(record.state, move, { success });
  record.announce = null;
  await finalizeMove(record, move, next, { success, rollTotal, isKingTarget, attackerLabel, defenderLabel });
}

async function finalizeMove(record, move, nextState, meta) {
  const opts = ruleOptions();
  record.state = nextState;

  let logText;
  if (move.capture) {
    logText = meta.isKingTarget
      ? fmt("Log.KingCapturedLine", { attacker: meta.attackerLabel })
      : fmt(meta.success ? "Log.CaptureSuccessLine" : "Log.CaptureFailLine", {
        attacker: meta.attackerLabel, defender: meta.defenderLabel, roll: meta.rollTotal
      });
    if (move.promotion && meta.success) logText += ` ${fmt("Log.PromotionLine", { square: algebraic(move.to) })}`;
  } else if (move.castle) {
    logText = fmt("Log.CastleLine", { color: COLOR_LABEL[move.piece.color], side: move.castle === "K" ? i18n("Log.SideKing") : i18n("Log.SideQueen") });
  } else if (move.promotion) {
    logText = fmt("Log.PromotionLine", { square: algebraic(move.to) });
  } else {
    logText = fmt("Log.MoveLine", { piece: pieceLabel(move.piece.type, move.piece.color), from: algebraic(move.from), to: algebraic(move.to) });
  }
  record.log = [...record.log, { text: logText }].slice(-200);

  if (meta.isKingTarget) {
    record.result = { type: "kingCaptured", winnerColor: move.piece.color };
    record.phase = "ended";
  } else {
    const status = gameStatus(nextState, opts);
    if (status !== "playing") {
      record.result = { type: status, winnerColor: status === "checkmate" ? opponent(nextState.turn) : null };
      record.phase = "ended";
    }
  }

  await setGameRecord(record);

  if (record.phase === "ended") {
    postGameEndMessage(record);
  } else if (isBotTurn(record)) {
    scheduleBotMove(record.id);
  }
}

function winnerRoleLabel(record, winnerColor) {
  if (winnerColor == null) return null;
  return winnerColor === record.pcColor ? record.pcActorName : record.npcActorName;
}

function postGameEndMessage(record) {
  const { type, winnerColor } = record.result;
  const winner = winnerRoleLabel(record, winnerColor);
  let content;
  if (type === "stalemate") content = i18n("Notify.EndStalemate");
  else if (type === "resign") content = fmt("Notify.EndResign", { winner });
  else content = fmt(type === "kingCaptured" ? "Notify.EndKingCaptured" : "Notify.EndCheckmate", { winner });
  ChatMessage.create({ content: `<h3>${i18n("Notify.EndTitle")}</h3><p>${content}</p>` });
}

/* -------------------------------------------- */
/*  Player-submitted actions (GM-side handlers)  */
/* -------------------------------------------- */

async function handleMoveRequest(data) {
  const record = getGameRecord();
  if (!record || record.id !== data.gameId || record.phase !== "playing") return;
  const seatColor = seatColorForUser(record, data.userId);
  if (!seatColor || record.state.turn !== seatColor) return;
  const legal = generateMoves(record.state, ruleOptions());
  const move = legal.find((m) => m.from === data.from && m.to === data.to);
  if (!move) return;
  await processMove(record, move);
}

async function handleResignRequest(data) {
  const record = getGameRecord();
  if (!record || record.id !== data.gameId || record.phase !== "playing") return;
  const seatColor = seatColorForUser(record, data.userId);
  if (!seatColor) return;
  record.result = { type: "resign", winnerColor: opponent(seatColor) };
  record.phase = "ended";
  await setGameRecord(record);
  postGameEndMessage(record);
}

/** Called directly (no socket hop) by the GM's own board when playing the NPC by hand, or resigning on its behalf. */
export async function gmSubmitMove(from, to) {
  const record = getGameRecord();
  if (!record || record.phase !== "playing" || record.npcIsBot || record.opponentUserId) return;
  if (record.state.turn !== record.npcColor) return;
  const legal = generateMoves(record.state, ruleOptions());
  const move = legal.find((m) => m.from === from && m.to === to);
  if (!move) return;
  await processMove(record, move);
}

export async function gmEndGame(winnerColor) {
  const record = getGameRecord();
  if (!record || record.phase !== "playing") return;
  record.result = { type: "resign", winnerColor };
  record.phase = "ended";
  await setGameRecord(record);
  postGameEndMessage(record);
}

/* -------------------------------------------- */
/*  Player-facing submission (socket emits)      */
/* -------------------------------------------- */

export function submitRpsChoice(gameId, choice) { emit("dcRpsChoice", { gameId, userId: game.user.id, choice }); }
export function submitColorChoice(gameId, color) { emit("dcColorChoice", { gameId, userId: game.user.id, color }); }
export function submitMove(gameId, from, to) { emit("dcMove", { gameId, userId: game.user.id, from, to }); }
export function submitResign(gameId) { emit("dcResign", { gameId, userId: game.user.id }); }

/* -------------------------------------------- */
/*  Registration                                 */
/* -------------------------------------------- */

export function registerDragonchess() {
  game.settings.register(MODULE_ID, GAME_SETTING, {
    scope: "world", config: false, type: Object, default: null,
    onChange: (record) => onGameRecordChanged(record)
  });
  game.settings.register(MODULE_ID, DIFFICULTY_SETTING, {
    scope: "world", config: true, type: String, default: "student",
    choices: { knappe: "FIMBLEWOOD.Dragonchess.Difficulty.Knappe", student: "FIMBLEWOOD.Dragonchess.Difficulty.Student", magister: "FIMBLEWOOD.Dragonchess.Difficulty.Magister", drache: "FIMBLEWOOD.Dragonchess.Difficulty.Drache" },
    name: "FIMBLEWOOD.Dragonchess.Settings.DifficultyName",
    hint: "FIMBLEWOOD.Dragonchess.Settings.DifficultyHint"
  });
  game.settings.register(MODULE_ID, ROLL_DELAY_SETTING, {
    scope: "world", config: true, type: Number, default: 3, range: { min: 0, max: 6, step: 0.5 },
    name: "FIMBLEWOOD.Dragonchess.Settings.RollDelayName",
    hint: "FIMBLEWOOD.Dragonchess.Settings.RollDelayHint"
  });
  game.settings.register(MODULE_ID, KINGS_MAY_TOUCH_SETTING, {
    scope: "world", config: true, type: Boolean, default: false,
    name: "FIMBLEWOOD.Dragonchess.Settings.KingsMayTouchName",
    hint: "FIMBLEWOOD.Dragonchess.Settings.KingsMayTouchHint"
  });

  Hooks.once("ready", () => {
    game.socket.on(CHANNEL, (data) => {
      switch (data.type) {
        case "dcChallengeRequest": if (game.user.isGM) handleChallengeRequest(data); break;
        case "dcChallengeBusy": if (game.user.id === data.userId) handleChallengeBusy(data); break;
        case "dcInvite": if (game.user.id === data.userId) handleInviteReceived(data); break;
        case "dcInviteResponse": if (game.user.isGM) handleInviteResponse(data); break;
        case "dcRpsRequest": if (game.user.id === data.userId) resolvePromptRps(data); break;
        case "dcRpsChoice": if (game.user.isGM) handleRpsChoice(data); break;
        case "dcColorRequest": if (game.user.id === data.userId) resolvePromptColor(data); break;
        case "dcColorChoice": if (game.user.isGM) handleColorChoice(data); break;
        case "dcMove": if (game.user.isGM) handleMoveRequest(data); break;
        case "dcResign": if (game.user.isGM) handleResignRequest(data); break;
        default: break;
      }
    });

    const record = getGameRecord();
    _lastSeenGameId = record?.id ?? null;
    _lastSeenPhase = record?.phase ?? null;
  });
}

/* -------------------------------------------- */
/*  Player-side prompts (invoked from sockets)   */
/* -------------------------------------------- */

async function resolvePromptRps(data) {
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: i18n("Rps.PlayerTitle") },
    content: `<p>${i18n("Rps.PlayerBody")}</p>`,
    buttons: [
      { action: "schere", label: i18n("Rps.Schere"), type: "button", callback: () => "schere" },
      { action: "stein", label: i18n("Rps.Stein"), type: "button", callback: () => "stein" },
      { action: "papier", label: i18n("Rps.Papier"), type: "button", callback: () => "papier" }
    ],
    rejectClose: false
  });
  submitRpsChoice(data.gameId, choice ?? ["schere", "stein", "papier"][Math.floor(Math.random() * 3)]);
}

async function resolvePromptColor(data) {
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: i18n("Color.PlayerTitle") },
    content: `<p>${i18n("Color.PlayerBody")}</p>`,
    buttons: [
      { action: "w", label: i18n("Color.Blau"), type: "button", callback: () => "w" },
      { action: "b", label: i18n("Color.Rot"), type: "button", callback: () => "b" }
    ],
    rejectClose: false
  });
  submitColorChoice(data.gameId, choice ?? (Math.random() < 0.5 ? "w" : "b"));
}

/* -------------------------------------------- */
/*  Self-test (browser console)                  */
/* -------------------------------------------- */

export function selftest() {
  const results = [];
  const report = (label, ok, detail) => { results.push({ label, ok, detail }); console.log(`${ok ? "OK  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`); };

  function perft(state, depth, options) {
    if (depth === 0) return 1;
    const moves = generateMoves(state, options);
    if (depth === 1) return moves.length;
    let count = 0;
    for (const move of moves) count += perft(makeMove(state, move, { success: true }), depth - 1, options);
    return count;
  }
  const start = createInitialState();
  const perftExpected = { 1: 20, 2: 400, 3: 8902 };
  for (const [depth, expected] of Object.entries(perftExpected)) {
    const got = perft(start, Number(depth), {});
    report(`perft(${depth})`, got === expected, `got ${got}, expected ${expected}`);
  }

  const hitTable = [
    [9, 1, false, 0.95], [9, 5, false, 0.75], [3, 1, false, 0.65], [5, 3, false, 0.65],
    [3, 3, false, 0.55], [3, 5, false, 0.45], [5, 9, false, 0.35], [1, 9, false, 0.15],
    [5, 3, true, 0.4225]
  ];
  for (const [atk, def, entrenched, expected] of hitTable) {
    const got = hitChance(atk, def, entrenched);
    report(`hitChance(${atk},${def},${entrenched})`, Math.abs(got - expected) < 1e-9, `got ${got}`);
  }

  let state = createInitialState();
  let plies = 0;
  let illegal = false;
  while (plies < 200) {
    const status = gameStatus(state, {});
    if (status !== "playing") break;
    const move = chooseMove(state, { depth: 1, blunderChance: 0.2 });
    const legal = generateMoves(state, {});
    if (!legal.some((m) => m.from === move.from && m.to === move.to)) { illegal = true; break; }
    const success = !move.capture || move.capturedType === "k" || Math.random() < hitChance(PIECE_VALUES[move.piece.type], PIECE_VALUES[move.capturedType], state.entrenched === (move.enPassant ? move.epCapturedSq : move.to));
    state = makeMove(state, move, { success });
    plies++;
    if (move.capturedType === "k") break;
  }
  report("bot self-play terminates without an illegal move", !illegal, `${plies} plies`);

  const passed = results.every((r) => r.ok);
  ui.notifications?.[passed ? "info" : "error"](`Dragonchess self-test: ${results.filter(r => r.ok).length}/${results.length} passed.`);
  return results;
}
