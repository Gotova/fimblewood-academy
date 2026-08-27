/**
 * The Dragonchess board window — one class serving three roles:
 *  - "player": a participant (either seat — the original PC, or, in a
 *    player-vs-player match, the challenger playing the "npc" seat). Can
 *    move their own pieces on their turn.
 *  - "gm": the GM. Can move the NPC's pieces by hand when nobody else is
 *    (no bot, no live opponent), and always has a "End Game" override.
 *  - "spectator": everyone else. Read-only, streamed live via the world
 *    setting the same way the interactive boards are.
 *
 * Follows the JukeboxApp pattern (jukebox.mjs) precisely: ApplicationV2
 * without the Handlebars mixin, markup built as a template-literal string in
 * _renderHTML(), and a single delegated click listener wired once in
 * _replaceHTML() dispatching through a small action map — DEFAULT_OPTIONS
 * .actions/data-action auto-dispatch has proven unreliable in this module.
 *
 * Every move plays out as a short animation, timed identically on every
 * client off the `announce` field the referee (game.mjs) writes before
 * resolving anything: an arrow forms from the source square to the
 * destination, then the moving piece physically slides there. Since
 * ApplicationV2 rebuilds the DOM from scratch on every render() (innerHTML
 * replacement — ApplicationV2 without the Handlebars mixin has no template
 * diffing), a CSS `transition` on the piece/arrow elements can't animate
 * across that rebuild by itself: the browser would just see a brand-new
 * element already at its final position. So _onRender() renders the piece
 * at its start position with transitions off, forces a reflow, then (next
 * frame) turns transitions on and sets the end position — the standard
 * "commit-then-transition" trick for animating into freshly-created DOM.
 */

import { generateMoves, PIECE_VALUES, hitChance, fileOf, rankOf } from "./rules.mjs";
import {
  getGameRecord, submitMove, submitResign, gmSubmitMove, gmEndGame,
  mySideForCurrentUser, PIECE_DISPLAY, PIECE_GLYPH, COLOR_LABEL,
  KINGS_MAY_TOUCH_SETTING, MOVE_ANIMATION_MS, ARROW_ANIMATION_MS
} from "./game.mjs";

const MODULE_ID = "fimblewood-academy";
const SQUARE_SIZE = 50; // px — board is a fixed 8×8 grid of these
const i18n = (k) => game.i18n.localize(`FIMBLEWOOD.Dragonchess.${k}`);
const fmt = (k, data) => game.i18n.format(`FIMBLEWOOD.Dragonchess.${k}`, data);

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

/** Pixel centre of a square, in the board's own 400×400 coordinate space (a1 bottom-left). */
function squareCenter(s) {
  return { x: fileOf(s) * SQUARE_SIZE + SQUARE_SIZE / 2, y: (7 - rankOf(s)) * SQUARE_SIZE + SQUARE_SIZE / 2 };
}

export class DragonchessBoardApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "fimblewood-dragonchess",
    tag: "div",
    window: { title: "FIMBLEWOOD.Dragonchess.Board.WindowTitle", icon: "fas fa-chess-queen" },
    position: { width: 660, height: 660 },
    classes: ["fimblewood-dragonchess-app"]
  };

  static #ACTIONS = { resign: "_onResign", endGame: "_onEndGame" };

  constructor(options) {
    super(options);
    this.gameId = options.gameId;
    this.role = options.role;
    this.selectedSquare = null;
    this._lastAnnounceId = null;
    this._slideTimeout = null;
  }

  canInteract(record) {
    // A move already in flight (announce set) locks the board until it
    // resolves — record.state.turn doesn't flip until then, so without this
    // a second click could race the first move to the referee.
    if (!record || record.phase !== "playing" || record.announce) return false;
    const mySide = mySideForCurrentUser(record);
    return mySide != null && record.state.turn === mySide;
  }

  /* -------------------------------------------- */

  async _renderHTML() {
    const record = getGameRecord();
    if (!record || record.id !== this.gameId) {
      return `<div class="fw-dc-empty">${i18n("Board.NoGame")}</div>`;
    }
    if (!record.state) {
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
    const mySide = mySideForCurrentUser(record);
    const announce = record.announce;

    const squares = [];
    for (let rank = 7; rank >= 0; rank--) {
      for (let file = 0; file < 8; file++) {
        const s = rank * 8 + file;
        const dark = (file + rank) % 2 === 0;
        const classes = ["fw-dc-square", dark ? "is-dark" : "is-light"];
        if (this.selectedSquare === s) classes.push("is-selected");
        if (record.state.entrenched === s) classes.push("is-entrenched");
        if (announce && (announce.from === s || announce.to === s)) classes.push("is-announcing");
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
        squares.push(`<div class="${classes.join(" ")}" data-square="${s}">${badge}</div>`);
      }
    }

    return `
      <div class="fw-dc-layout">
        <div class="fw-dc-board-area">
          <div class="fw-dc-ranks">${this.#renderRankLabels()}</div>
          <div class="fw-dc-board">
            ${squares.join("")}
            ${this.#renderPieceLayer(record, announce?.from)}
            ${this.#renderArrow(announce)}
            ${this.#renderFlyingPiece(announce)}
          </div>
          <div class="fw-dc-files-spacer"></div>
          <div class="fw-dc-files">${this.#renderFileLabels()}</div>
        </div>
        <div class="fw-dc-side">
          ${this.#renderStatus(record, mySide)}
          ${this.#renderRosters(record)}
          ${this.#renderLog(record)}
          ${this.#renderActions(record)}
        </div>
      </div>`;
  }

  #renderRankLabels() {
    const rows = [];
    for (let rank = 7; rank >= 0; rank--) rows.push(`<div class="fw-dc-coord" style="height:${SQUARE_SIZE}px">${rank + 1}</div>`);
    return rows.join("");
  }

  #renderFileLabels() {
    const cols = [];
    for (let file = 0; file < 8; file++) cols.push(`<div class="fw-dc-coord" style="width:${SQUARE_SIZE}px">${String.fromCharCode(97 + file)}</div>`);
    return cols.join("");
  }

  #renderPieceLayer(record, hideSquare) {
    const spans = [];
    for (let s = 0; s < 64; s++) {
      if (s === hideSquare) continue;
      const piece = record.state.board[s];
      if (!piece) continue;
      const { x, y } = squareCenter(s);
      spans.push(this.#pieceTokenHtml(piece.type, piece.color, x, y, { square: s }));
    }
    return `<div class="fw-dc-piece-layer">${spans.join("")}</div>`;
  }

  #pieceTokenHtml(type, color, x, y, { square, extraClass = "", moveId } = {}) {
    const title = `${esc(PIECE_DISPLAY[type])} (${esc(COLOR_LABEL[color])}, ${PIECE_VALUES[type]})`;
    const squareAttr = square != null ? ` data-square="${square}"` : "";
    const moveIdAttr = moveId != null ? ` data-move-id="${moveId}"` : "";
    return `<span class="fw-dc-piece-token ${extraClass} is-${color === "w" ? "blau" : "rot"}" style="left:${x}px; top:${y}px;"${squareAttr}${moveIdAttr} title="${title}">${PIECE_GLYPH[type]}</span>`;
  }

  #renderArrow(announce) {
    if (!announce) return `<div class="fw-dc-arrow" style="display:none;"></div>`;
    return `<div class="fw-dc-arrow" data-move-id="${announce.moveId}"></div>`;
  }

  #renderFlyingPiece(announce) {
    if (!announce) return `<span class="fw-dc-piece-token fw-dc-piece-flying" style="display:none;"></span>`;
    // data-move-id lets _onRender tell a genuinely new move apart from an
    // incidental re-render of the same one; position is set by _onRender.
    return this.#pieceTokenHtml(announce.pieceType, announce.pieceColor, 0, 0, { extraClass: "fw-dc-piece-flying", moveId: announce.moveId });
  }

  #renderStatus(record, mySide) {
    if (record.announce?.capture) {
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

  _onRender(context, options) {
    super._onRender?.(context, options);
    const record = getGameRecord();
    const announce = (record && record.id === this.gameId) ? record.announce : null;
    if (announce && announce.moveId !== this._lastAnnounceId) {
      this._lastAnnounceId = announce.moveId;
      this._playMoveAnimation(announce);
    } else if (!announce) {
      this._lastAnnounceId = null;
    }
  }

  async close(options) {
    if (this._slideTimeout) clearTimeout(this._slideTimeout);
    return super.close(options);
  }

  /** Arrow-forms-then-piece-slides, timed off the shared MOVE_ANIMATION_MS/ARROW_ANIMATION_MS constants so every client settles together. */
  _playMoveAnimation(announce) {
    const root = this.element;
    const arrowEl = root?.querySelector(".fw-dc-arrow");
    const flyingEl = root?.querySelector(".fw-dc-piece-flying");
    if (!arrowEl || !flyingEl) return;

    const from = squareCenter(announce.from);
    const to = squareCenter(announce.to);
    const dx = to.x - from.x, dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);

    arrowEl.style.display = "block";
    arrowEl.style.transition = "none";
    arrowEl.style.left = `${from.x}px`;
    arrowEl.style.top = `${from.y}px`;
    arrowEl.style.transform = `rotate(${angle}deg)`;
    arrowEl.style.width = "0px";

    flyingEl.style.display = "flex";
    flyingEl.style.transition = "none";
    flyingEl.style.left = `${from.x}px`;
    flyingEl.style.top = `${from.y}px`;

    // Commit the "start" state above before animating, so the browser
    // doesn't collapse start+end into a single frame (see class doc comment).
    void root.offsetWidth;

    requestAnimationFrame(() => {
      arrowEl.style.transition = `width ${ARROW_ANIMATION_MS}ms ease-out`;
      arrowEl.style.width = `${length}px`;
    });

    const slideMs = Math.max(0, MOVE_ANIMATION_MS - ARROW_ANIMATION_MS);
    if (this._slideTimeout) clearTimeout(this._slideTimeout);
    this._slideTimeout = setTimeout(() => {
      flyingEl.style.transition = `left ${slideMs}ms ease-in-out, top ${slideMs}ms ease-in-out`;
      requestAnimationFrame(() => {
        flyingEl.style.left = `${to.x}px`;
        flyingEl.style.top = `${to.y}px`;
      });
    }, ARROW_ANIMATION_MS);
  }

  /* -------------------------------------------- */

  _onSquareClick(square) {
    const record = getGameRecord();
    if (!record || !this.canInteract(record)) return;

    if (this.selectedSquare != null) {
      const moves = generateMoves(record.state, {
        kingsMayTouch: game.settings.get(MODULE_ID, KINGS_MAY_TOUCH_SETTING), from: this.selectedSquare
      });
      const move = moves.find((m) => m.to === square);
      if (move) {
        this.selectedSquare = null;
        const isLiveSeat = game.user.id === record.pcUserId || (record.opponentUserId && game.user.id === record.opponentUserId);
        if (isLiveSeat) submitMove(this.gameId, move.from, move.to);
        else gmSubmitMove(move.from, move.to); // GM playing the NPC seat by hand
        this.render();
        return;
      }
    }

    const mySide = mySideForCurrentUser(record);
    const piece = record.state.board[square];
    this.selectedSquare = (piece && piece.color === mySide) ? square : null;
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
