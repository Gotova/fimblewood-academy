/**
 * Dragonchess rules engine.
 *
 * Pure game logic, no Foundry API. Chess rules apply throughout, with the
 * Dragonchess deviations from the club rulebook:
 *
 *  - A move onto an occupied enemy square is a "Schlagzug" (capture attempt),
 *    not an automatic capture. Whether it succeeds is decided elsewhere (by
 *    dice, see hitChance()) — this module only knows how to *apply* either
 *    outcome (see makeMove) and how to judge *legality* (judged on the
 *    success branch: a move is legal if your king is safe assuming the
 *    capture works).
 *  - A failed capture removes the attacker and leaves the defender standing,
 *    entrenched. A successful capture removes the defender and entrenches
 *    the attacker on the captured square. Only one square on the whole board
 *    is ever entrenched at a time, and moving that piece away ends it.
 *  - The King attacks and is attacked exactly like a normal chess king
 *    (one step in any direction, including onto an enemy-occupied square).
 *    Any capture where either side is the King — attacker or defender —
 *    always succeeds; the caller (game.mjs) is responsible for skipping the
 *    roll in that case. A King that captures becomes entrenched like any
 *    other piece, since a capture that always succeeds is still a capture.
 *  - Pawn promotion always produces a Drache (Dame, value 9) and the new
 *    piece is never entrenched, even when the promotion happened via a
 *    successful capture.
 */

export const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

const FILES = "abcdefgh";

/* -------------------------------------------- */
/*  Square helpers                               */
/* -------------------------------------------- */

export function sq(file, rank) { return rank * 8 + file; }
export function fileOf(s) { return s % 8; }
export function rankOf(s) { return Math.floor(s / 8); }
export function algebraic(s) { return `${FILES[fileOf(s)]}${rankOf(s) + 1}`; }
export function fromAlgebraic(str) {
  const file = FILES.indexOf(str[0]);
  const rank = Number(str[1]) - 1;
  return sq(file, rank);
}
export function opponent(color) { return color === "w" ? "b" : "w"; }

const DIR_DELTA = { N: 8, S: -8, E: 1, W: -1, NE: 9, NW: 7, SE: -7, SW: -9 };
const DIR_FILE_DELTA = { N: 0, S: 0, E: 1, W: -1, NE: 1, NW: -1, SE: 1, SW: -1 };

/** One step from `s` in a named direction, or null if it would leave the board / wrap a rank. */
function step(s, dirName) {
  const next = s + DIR_DELTA[dirName];
  if (next < 0 || next > 63) return null;
  if (fileOf(next) - fileOf(s) !== DIR_FILE_DELTA[dirName]) return null;
  return next;
}

const BISHOP_DIRS = ["NE", "NW", "SE", "SW"];
const ROOK_DIRS = ["N", "S", "E", "W"];
const QUEEN_DIRS = [...ROOK_DIRS, ...BISHOP_DIRS];
const KNIGHT_OFFSETS = [
  [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]
];

const ROOK_HOMES = { wK: sq(7, 0), wQ: sq(0, 0), bK: sq(7, 7), bQ: sq(0, 7) };

/* -------------------------------------------- */
/*  State                                        */
/* -------------------------------------------- */

export function createInitialState() {
  const board = new Array(64).fill(null);
  const backRank = ["r", "n", "b", "q", "k", "b", "n", "r"];
  for (let file = 0; file < 8; file++) {
    board[sq(file, 0)] = { type: backRank[file], color: "w" };
    board[sq(file, 1)] = { type: "p", color: "w" };
    board[sq(file, 6)] = { type: "p", color: "b" };
    board[sq(file, 7)] = { type: backRank[file], color: "b" };
  }
  return {
    board,
    turn: "w",
    castling: { wK: true, wQ: true, bK: true, bQ: true },
    epSquare: null,
    entrenched: null,
    halfmove: 0,
    fullmove: 1
  };
}

export function cloneState(state) {
  return {
    board: state.board.map((p) => (p ? { ...p } : null)),
    turn: state.turn,
    castling: { ...state.castling },
    epSquare: state.epSquare,
    entrenched: state.entrenched,
    halfmove: state.halfmove,
    fullmove: state.fullmove
  };
}

export function findKing(board, color) {
  for (let s = 0; s < 64; s++) {
    const p = board[s];
    if (p && p.type === "k" && p.color === color) return s;
  }
  return null;
}

/* -------------------------------------------- */
/*  Attack detection                             */
/* -------------------------------------------- */

const KING_OFFSETS = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]
];

/** True if `square` is geometrically threatened by any `byColor` piece. */
export function isSquareAttacked(board, square, byColor) {
  for (const [df, dr] of KING_OFFSETS) {
    const file = fileOf(square) + df;
    const rank = rankOf(square) + dr;
    if (file < 0 || file > 7 || rank < 0 || rank > 7) continue;
    const p = board[sq(file, rank)];
    if (p && p.color === byColor && p.type === "k") return true;
  }

  // Pawns: a byColor pawn attacks diagonally toward its forward direction.
  const pawnDirs = byColor === "w" ? ["SW", "SE"] : ["NW", "NE"];
  for (const dir of pawnDirs) {
    const from = step(square, dir);
    if (from != null) {
      const p = board[from];
      if (p && p.color === byColor && p.type === "p") return true;
    }
  }

  for (const [df, dr] of KNIGHT_OFFSETS) {
    const file = fileOf(square) + df;
    const rank = rankOf(square) + dr;
    if (file < 0 || file > 7 || rank < 0 || rank > 7) continue;
    const p = board[sq(file, rank)];
    if (p && p.color === byColor && p.type === "n") return true;
  }

  for (const dir of BISHOP_DIRS) {
    let s = step(square, dir);
    while (s != null) {
      const p = board[s];
      if (p) {
        if (p.color === byColor && (p.type === "b" || p.type === "q")) return true;
        break;
      }
      s = step(s, dir);
    }
  }

  for (const dir of ROOK_DIRS) {
    let s = step(square, dir);
    while (s != null) {
      const p = board[s];
      if (p) {
        if (p.color === byColor && (p.type === "r" || p.type === "q")) return true;
        break;
      }
      s = step(s, dir);
    }
  }

  return false;
}

/* -------------------------------------------- */
/*  Pseudo-legal move generation                 */
/* -------------------------------------------- */

function slideMoves(state, from, dirs, out) {
  const piece = state.board[from];
  for (const dir of dirs) {
    let s = step(from, dir);
    while (s != null) {
      const occupant = state.board[s];
      if (!occupant) {
        out.push({ from, to: s, piece: { ...piece }, capture: false });
      } else {
        if (occupant.color !== piece.color) {
          out.push({ from, to: s, piece: { ...piece }, capture: true, capturedType: occupant.type });
        }
        break;
      }
      s = step(s, dir);
    }
  }
}

function pawnMoves(state, from, out) {
  const piece = state.board[from];
  const color = piece.color;
  const forward = color === "w" ? "N" : "S";
  const startRank = color === "w" ? 1 : 6;
  const lastRank = color === "w" ? 7 : 0;
  const captureDirs = color === "w" ? ["NW", "NE"] : ["SW", "SE"];

  const oneStep = step(from, forward);
  if (oneStep != null && !state.board[oneStep]) {
    const promotion = rankOf(oneStep) === lastRank ? "q" : null;
    out.push({ from, to: oneStep, piece: { ...piece }, capture: false, promotion });
    if (rankOf(from) === startRank) {
      const twoStep = step(oneStep, forward);
      if (twoStep != null && !state.board[twoStep]) {
        out.push({ from, to: twoStep, piece: { ...piece }, capture: false, double: true, epSquareAfter: oneStep });
      }
    }
  }

  for (const dir of captureDirs) {
    const target = step(from, dir);
    if (target == null) continue;
    const occupant = state.board[target];
    if (occupant && occupant.color !== color) {
      const promotion = rankOf(target) === lastRank ? "q" : null;
      out.push({ from, to: target, piece: { ...piece }, capture: true, capturedType: occupant.type, promotion });
    } else if (!occupant && target === state.epSquare) {
      const epCapturedSq = rankOf(target) === 2 ? target + 8 : target - 8;
      out.push({ from, to: target, piece: { ...piece }, capture: true, capturedType: "p", enPassant: true, epCapturedSq });
    }
  }
}

function kingStepMoves(state, from, out) {
  const piece = state.board[from];
  for (const dir of QUEEN_DIRS) {
    const to = step(from, dir);
    if (to == null) continue;
    const occupant = state.board[to];
    if (!occupant) out.push({ from, to, piece: { ...piece }, capture: false });
    else if (occupant.color !== piece.color) out.push({ from, to, piece: { ...piece }, capture: true, capturedType: occupant.type });
  }
}

function castlingMoves(state, from, out) {
  const color = state.board[from].color;
  const rank = color === "w" ? 0 : 7;
  const kingSide = color === "w" ? "wK" : "bK";
  const queenSide = color === "w" ? "wQ" : "bQ";

  if (state.castling[kingSide]) {
    const rookHome = sq(7, rank);
    const between = [sq(5, rank), sq(6, rank)];
    if (state.board[rookHome]?.type === "r" && state.board[rookHome]?.color === color
      && between.every((s) => !state.board[s])) {
      out.push({
        from, to: sq(6, rank), piece: { ...state.board[from] }, capture: false,
        castle: "K", rookFrom: rookHome, rookTo: sq(5, rank)
      });
    }
  }
  if (state.castling[queenSide]) {
    const rookHome = sq(0, rank);
    const between = [sq(1, rank), sq(2, rank), sq(3, rank)];
    if (state.board[rookHome]?.type === "r" && state.board[rookHome]?.color === color
      && between.every((s) => !state.board[s])) {
      out.push({
        from, to: sq(2, rank), piece: { ...state.board[from] }, capture: false,
        castle: "Q", rookFrom: rookHome, rookTo: sq(3, rank)
      });
    }
  }
}

function generatePseudoMoves(state) {
  const moves = [];
  for (let from = 0; from < 64; from++) {
    const piece = state.board[from];
    if (!piece || piece.color !== state.turn) continue;
    switch (piece.type) {
      case "p": pawnMoves(state, from, moves); break;
      case "n": {
        for (const [df, dr] of KNIGHT_OFFSETS) {
          const file = fileOf(from) + df;
          const rank = rankOf(from) + dr;
          if (file < 0 || file > 7 || rank < 0 || rank > 7) continue;
          const to = sq(file, rank);
          const occupant = state.board[to];
          if (!occupant) moves.push({ from, to, piece: { ...piece }, capture: false });
          else if (occupant.color !== piece.color) {
            moves.push({ from, to, piece: { ...piece }, capture: true, capturedType: occupant.type });
          }
        }
        break;
      }
      case "b": slideMoves(state, from, BISHOP_DIRS, moves); break;
      case "r": slideMoves(state, from, ROOK_DIRS, moves); break;
      case "q": slideMoves(state, from, QUEEN_DIRS, moves); break;
      case "k":
        kingStepMoves(state, from, moves);
        castlingMoves(state, from, moves);
        break;
    }
  }
  return moves;
}

/* -------------------------------------------- */
/*  Applying a move (assuming a given outcome)   */
/* -------------------------------------------- */

/**
 * Apply `move` to `state`, returning a new state. `success` only matters for
 * capture moves: true resolves it as a successful Schlagzug (defender
 * removed, attacker entrenched on the square), false as a failed one
 * (attacker dies, defender stands and becomes entrenched). Non-capture
 * moves ignore `success` entirely — they always happen.
 */
export function makeMove(state, move, { success = true } = {}) {
  const ns = cloneState(state);
  const piece = ns.board[move.from];
  const color = piece.color;

  ns.epSquare = move.double ? move.epSquareAfter : null;

  // Entrenchment carries over unless the entrenched piece is the one moving.
  if (ns.entrenched === move.from) ns.entrenched = null;

  if (move.castle) {
    ns.board[move.to] = piece;
    ns.board[move.from] = null;
    ns.board[move.rookTo] = ns.board[move.rookFrom];
    ns.board[move.rookFrom] = null;
    ns.halfmove += 1;
  } else if (move.capture) {
    const defenderSq = move.enPassant ? move.epCapturedSq : move.to;
    if (success) {
      ns.board[defenderSq] = null;
      ns.board[move.from] = null;
      ns.board[move.to] = move.promotion ? { type: move.promotion, color } : piece;
      ns.entrenched = move.promotion ? null : move.to;
    } else {
      ns.board[move.from] = null;
      // Defender (at defenderSq) is untouched, and becomes entrenched.
      ns.entrenched = defenderSq;
    }
    ns.halfmove = 0;
  } else {
    ns.board[move.to] = move.promotion ? { type: move.promotion, color } : piece;
    ns.board[move.from] = null;
    ns.halfmove = piece.type === "p" ? 0 : ns.halfmove + 1;
  }

  if (piece.type === "k") {
    ns.castling[`${color}K`] = false;
    ns.castling[`${color}Q`] = false;
  }
  const touchedSquares = [move.from, move.to, move.rookFrom, move.epCapturedSq].filter((s) => s != null);
  for (const home of Object.keys(ROOK_HOMES)) {
    if (touchedSquares.includes(ROOK_HOMES[home])) ns.castling[home] = false;
  }

  ns.turn = opponent(state.turn);
  if (color === "b") ns.fullmove += 1;

  return ns;
}

/* -------------------------------------------- */
/*  Legal move generation                        */
/* -------------------------------------------- */

function isLegal(state, move) {
  // Legality is judged on the success branch: if the capture works, is my king safe?
  // Since isSquareAttacked() now includes King attacks, this alone also
  // covers the standard "the two Kings can never stand adjacent" rule — no
  // separate check needed, exactly as in normal chess.
  const after = makeMove(state, move, { success: true });
  const kingSq = findKing(after.board, state.turn);
  if (kingSq != null && isSquareAttacked(after.board, kingSq, opponent(state.turn))) return false;

  if (move.castle) {
    const enemy = opponent(state.turn);
    if (isSquareAttacked(state.board, move.from, enemy)) return false; // can't castle out of check
    const passSquare = (move.from + move.to) / 2;
    if (isSquareAttacked(state.board, passSquare, enemy)) return false; // can't pass through check
  }

  return true;
}

/** All legal moves for the side to move (or, if `options.from` is given, from that square only). */
export function generateMoves(state, options = {}) {
  const pseudo = generatePseudoMoves(state);
  const legal = pseudo.filter((m) => isLegal(state, m));
  return options.from != null ? legal.filter((m) => m.from === options.from) : legal;
}

export function isInCheck(state) {
  const kingSq = findKing(state.board, state.turn);
  if (kingSq == null) return false;
  return isSquareAttacked(state.board, kingSq, opponent(state.turn));
}

/**
 * Game status for the side to move: "playing", "checkmate", "stalemate", or
 * "kingCaptured" (the King is simply gone — a failed defense against an
 * attack on it never happens, since attacks on the King always succeed).
 */
export function gameStatus(state, options = {}) {
  const kingSq = findKing(state.board, state.turn);
  if (kingSq == null) return "kingCaptured";
  const moves = generateMoves(state, options);
  if (moves.length > 0) return "playing";
  return isInCheck(state) ? "checkmate" : "stalemate";
}

/* -------------------------------------------- */
/*  Dragonchess capture odds                     */
/* -------------------------------------------- */

/**
 * DC 10 + defender value vs d20 + attacker value, entrenched defenders
 * imposing disadvantage. Returns the probability of a successful Schlagzug,
 * clamped for the natural-20-always-hits / natural-1-always-misses rule.
 */
export function hitChance(attackerValue, defenderValue, entrenched = false) {
  const dc = 10 + defenderValue;
  const needed = dc - attackerValue; // roll-on-the-die needed to hit
  const singleDieChance = Math.min(19, Math.max(1, 21 - needed)) / 20; // nat 1 always misses, nat 20 always hits
  if (!entrenched) return singleDieChance;
  // Disadvantage: take the lower of two d20s. P(min >= threshold) with the
  // same nat-1/nat-20 floor/ceiling folded in via singleDieChance already.
  return singleDieChance * singleDieChance;
}
