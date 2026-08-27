/**
 * The Dragonchess board window — one class serving three roles:
 *  - "player": the invited PC, can move their own pieces on their turn.
 *  - "gm": the GM. Can move the NPC's pieces by hand when the NPC isn't a
 *    bot, and always has a "End Game" override.
 *  - "spectator": everyone else. Read-only, streamed live via the world
 *    setting the same way the interactive boards are.
 *
 * Follows the JukeboxApp pattern (jukebox.mjs) precisely: ApplicationV2
 * without the Handlebars mixin, markup built as a template-literal string in
 * _renderHTML(), and a single delegated click listener wired once in
 * _replaceHTML() dispatching through a small action map — DEFAULT_OPTIONS
 * .actions/data-action auto-dispatch has proven unreliable in this module.
 */

import { generateMoves, PIECE_VALUES, hitChance } from "./rules.mjs";
import {
  getGameRecord, submitMove, submitResign, gmSubmitMove, gmEndGame,
  PIECE_DISPLAY, PIECE_GLYPH, COLOR_LABEL, KINGS_MAY_TOUCH_SETTING
} from "./game.mjs";

const MODULE_ID = "fimblewood-academy";
const i18n = (k) => game.i18n.localize(`FIMBLEWOOD.Dragonchess.${k}`);
const fmt = (k, data) => game.i18n.format(`FIMBLEWOOD.Dragonchess.${k}`, data);

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

export class DragonchessBoardApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "fimblewood-dragonchess",
    tag: "div",
    window: { title: "FIMBLEWOOD.Dragonchess.Board.WindowTitle", icon: "fas fa-chess-queen" },
    position: { width: 640, height: 620 },
    classes: ["fimblewood-dragonchess-app"]
  };

  static #ACTIONS = { resign: "_onResign", endGame: "_onEndGame" };

  constructor(options) {
    super(options);
    this.gameId = options.gameId;
    this.role = options.role;
    this.selectedSquare = null;
  }

  canInteract(record) {
    if (!record || record.phase !== "playing") return false;
    if (this.role === "player") return record.state.turn === record.pcColor;
    if (this.role === "gm") return !record.npcIsBot && record.state.turn === record.npcColor;
    return false;
  }

  /* -------------------------------------------- */

  async _renderHTML() {
    const record = getGameRecord();
    if (!record || record.id !== this.gameId) {
      return `<div class="fw-dc-empty">${i18n("Board.NoGame")}</div>`;
    }
    if (!record.state) {
      // Invitation/RPS/colour-choice handshake is still in progress (or was
      // declined) — those steps run as their own dialogs, not on this board.
      return `<div class="fw-dc-empty">${i18n(record.phase === "declined" ? "Board.Declined" : "Board.Waiting")}</div>`;
    }

    const kingsMayTouch = game.settings.get(MODULE_ID, KINGS_MAY_TOUCH_SETTING);
    const interactive = this.canInteract(record);
    let legalDestinations = new Map(); // square -> move
    if (interactive && this.selectedSquare != null) {
      for (const move of generateMoves(record.state, { kingsMayTouch, from: this.selectedSquare })) {
        legalDestinations.set(move.to, move);
      }
    }
    const mySide = this.role === "player" ? record.pcColor : this.role === "gm" ? record.npcColor : null;

    const squares = [];
    for (let rank = 7; rank >= 0; rank--) {
      for (let file = 0; file < 8; file++) {
        const s = rank * 8 + file;
        const piece = record.state.board[s];
        const dark = (file + rank) % 2 === 0;
        const classes = ["fw-dc-square", dark ? "is-dark" : "is-light"];
        if (this.selectedSquare === s) classes.push("is-selected");
        if (record.state.entrenched === s) classes.push("is-entrenched");
        if (record.announce && (record.announce.attackerSq === s || record.announce.defenderSq === s)) classes.push("is-announcing");
        let badge = "";
        if (legalDestinations.has(s)) {
          classes.push("is-legal-move");
          const move = legalDestinations.get(s);
          if (move.capture) {
            classes.push("is-legal-capture");
            const entrenched = record.state.entrenched === (move.enPassant ? move.epCapturedSq : move.to);
            const pct = Math.round(hitChanceFor(move, entrenched) * 100);
            badge = `<span class="fw-dc-hit-badge">${pct}%</span>`;
          }
        }
        const pieceHtml = piece
          ? `<span class="fw-dc-piece is-${piece.color === "w" ? "blau" : "rot"}" title="${esc(PIECE_DISPLAY[piece.type])} (${esc(COLOR_LABEL[piece.color])}, ${PIECE_VALUES[piece.type]})">${PIECE_GLYPH[piece.type]}</span>`
          : "";
        squares.push(`<div class="${classes.join(" ")}" data-square="${s}">${pieceHtml}${badge}</div>`);
      }
    }

    return `
      <div class="fw-dc-layout">
        <div class="fw-dc-board">${squares.join("")}</div>
        <div class="fw-dc-side">
          ${this.#renderStatus(record, mySide)}
          ${this.#renderRosters(record)}
          ${this.#renderLog(record)}
          ${this.#renderActions(record)}
        </div>
      </div>`;
  }

  #renderStatus(record, mySide) {
    if (record.announce) {
      const a = record.announce;
      const text = a.isKingTarget
        ? fmt("Board.KingAttackBanner", { attacker: esc(a.attackerLabel), defender: esc(a.defenderLabel) })
        : fmt("Board.AttackBanner", { attacker: esc(a.attackerLabel), defender: esc(a.defenderLabel), needed: a.needed })
          + (a.entrenched ? ` ${i18n("Board.EntrenchedNote")}` : "");
      return `<div class="fw-dc-banner is-attack">${text}</div>`;
    }
    if (record.phase === "ended") {
      const { type, winnerColor } = record.result;
      const winner = winnerColor == null ? null : (winnerColor === record.pcColor ? record.pcActorName : record.npcActorName);
      const text = type === "stalemate" ? i18n("Board.EndStalemate")
        : type === "resign" ? fmt("Board.EndResign", { winner: esc(winner) })
          : fmt(type === "kingCaptured" ? "Board.EndKingCaptured" : "Board.EndCheckmate", { winner: esc(winner) });
      return `<div class="fw-dc-banner is-end">${text}</div>`;
    }
    const turnColor = record.state.turn;
    const turnName = turnColor === record.pcColor ? record.pcActorName : record.npcActorName;
    const myTurn = mySide === turnColor;
    return `<div class="fw-dc-banner ${myTurn ? "is-my-turn" : ""}">
      ${fmt("Board.TurnBanner", { color: COLOR_LABEL[turnColor], name: esc(turnName) })}
    </div>`;
  }

  #renderRosters(record) {
    const rosterFor = (color) => {
      const counts = {};
      for (const piece of record.state.board) {
        if (piece?.color === color) counts[piece.type] = (counts[piece.type] ?? 0) + 1;
      }
      const parts = ["q", "r", "b", "n", "p"].filter((t) => counts[t]).map((t) => `${counts[t]}× ${PIECE_DISPLAY[t]} (${PIECE_VALUES[t]})`);
      return parts.length ? parts.join(", ") : i18n("Board.NoPieces");
    };
    return `
      <div class="fw-dc-roster">
        <div class="fw-dc-roster-row"><strong class="is-blau">${COLOR_LABEL.w}</strong> (${esc(record.pcColor === "w" ? record.pcActorName : record.npcActorName)}): ${rosterFor("w")}</div>
        <div class="fw-dc-roster-row"><strong class="is-rot">${COLOR_LABEL.b}</strong> (${esc(record.pcColor === "b" ? record.pcActorName : record.npcActorName)}): ${rosterFor("b")}</div>
      </div>`;
  }

  #renderLog(record) {
    const rows = record.log.slice().reverse().map((entry) => `<li>${entry.text}</li>`).join("");
    return `<ol class="fw-dc-log" reversed>${rows}</ol>`;
  }

  #renderActions(record) {
    const buttons = [];
    if (this.role === "player" && record.phase === "playing") {
      buttons.push(`<button type="button" class="fw-dc-btn" data-action="resign">${i18n("Board.Resign")}</button>`);
    }
    if (this.role === "gm" && record.phase === "playing") {
      buttons.push(`<button type="button" class="fw-dc-btn" data-action="endGame">${i18n("Board.EndGame")}</button>`);
    }
    return buttons.length ? `<div class="fw-dc-actions">${buttons.join("")}</div>` : "";
  }

  /* -------------------------------------------- */

  async _replaceHTML(result, content) {
    content.innerHTML = result;
    if (!content.dataset.fwDcWired) {
      content.dataset.fwDcWired = "1";
      content.addEventListener("click", (event) => {
        const actionTarget = event.target.closest("[data-action]");
        if (actionTarget) {
          const handlerName = DragonchessBoardApp.#ACTIONS[actionTarget.dataset.action];
          if (handlerName) this[handlerName](event, actionTarget);
          return;
        }
        const squareTarget = event.target.closest("[data-square]");
        if (squareTarget) this._onSquareClick(Number(squareTarget.dataset.square));
      });
    }
    return content;
  }

  /* -------------------------------------------- */
  /*  Note: re-rendering on game-state changes is driven by game.mjs, which
      owns the singleton board instance and calls render() directly whenever
      the `dragonchessGame` world setting changes — no local hook needed here. */

  _onSquareClick(square) {
    const record = getGameRecord();
    if (!record || !this.canInteract(record)) return;
    const mySide = this.role === "player" ? record.pcColor : record.npcColor;

    if (this.selectedSquare != null) {
      const moves = generateMoves(record.state, {
        kingsMayTouch: game.settings.get(MODULE_ID, KINGS_MAY_TOUCH_SETTING), from: this.selectedSquare
      });
      const move = moves.find((m) => m.to === square);
      if (move) {
        this.selectedSquare = null;
        if (this.role === "player") submitMove(this.gameId, move.from, move.to);
        else gmSubmitMove(move.from, move.to);
        this.render();
        return;
      }
    }

    const piece = record.state.board[square];
    if (piece && piece.color === mySide) {
      this.selectedSquare = square;
    } else {
      this.selectedSquare = null;
    }
    this.render();
  }

  async _onResign() {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: i18n("Board.ResignConfirmTitle") },
      content: `<p>${i18n("Board.ResignConfirmBody")}</p>`,
      rejectClose: false
    });
    if (confirmed) submitResign(this.gameId);
  }

  async _onEndGame() {
    const record = getGameRecord();
    if (!record) return;
    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: i18n("Board.EndGameTitle") },
      content: `<p>${i18n("Board.EndGameBody")}</p>`,
      buttons: [
        { action: "pc", label: fmt("Board.EndGameWinner", { name: esc(record.pcActorName) }), type: "button", callback: () => record.pcColor },
        { action: "npc", label: fmt("Board.EndGameWinner", { name: esc(record.npcActorName) }), type: "button", callback: () => record.npcColor },
        { action: "cancel", label: i18n("Launch.Cancel"), type: "button", callback: () => null }
      ],
      rejectClose: false
    });
    if (choice) await gmEndGame(choice);
  }
}

/** Hit chance for a given legal move object, matching the odds shown in chat when it resolves. */
function hitChanceFor(move, entrenched) {
  return hitChance(PIECE_VALUES[move.piece.type], PIECE_VALUES[move.capturedType], entrenched);
}
