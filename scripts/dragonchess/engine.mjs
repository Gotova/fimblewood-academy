/**
 * The Dragonchess bot. Plays the NPC side when the GM doesn't want to (or
 * isn't confident enough to) play it by hand.
 *
 * This is a small negamax search with alpha-beta pruning, but capture moves
 * are *chance nodes*: a Schlagzug branches into a success and a failure
 * continuation weighted by hitChance(), and the move's value is the
 * resulting expectation. That's the whole point of a dedicated Dragonchess
 * bot rather than a chess bot bolted onto dice — it lets the search
 * correctly discount a Knappe-takes-Drache lottery and correctly favour
 * attacking a non-entrenched piece over an entrenched one.
 *
 * Alpha-beta bounds are not strictly sound across an expectation node (you
 * can't safely prune a chance node the way you prune a min/max node), but at
 * the shallow depths used here (an NPC opponent, not a tournament engine)
 * the pruning is a reasonable heuristic speed-up and never crashes; it can
 * only ever cause the bot to occasionally miss a slightly-better tied move.
 */

import {
  generateMoves, makeMove, isInCheck, hitChance, PIECE_VALUES, fileOf, rankOf
} from "./rules.mjs";

const MATE_SCORE = 100000;

/** Difficulty presets: search depth (in plies), and a chance to ignore the search and play a random legal move instead. */
export const DIFFICULTIES = {
  knappe: { depth: 1, blunderChance: 0.40 },
  student: { depth: 2, blunderChance: 0.15 },
  magister: { depth: 3, blunderChance: 0.03 },
  drache: { depth: 4, blunderChance: 0 }
};

export function difficultyPreset(name) {
  return DIFFICULTIES[name] ?? DIFFICULTIES.student;
}

/* -------------------------------------------- */
/*  Evaluation                                   */
/* -------------------------------------------- */

/** 0 (edge) .. 6 (centre) — a light centralisation heuristic, nothing more. */
function centrality(square) {
  const f = fileOf(square), r = rankOf(square);
  return Math.min(f, 7 - f) + Math.min(r, 7 - r);
}

/** Positive is good for `state.turn` (the side about to move in `state`). */
function evaluate(state) {
  let score = 0;
  for (let s = 0; s < 64; s++) {
    const piece = state.board[s];
    if (!piece) continue;
    let pieceScore = PIECE_VALUES[piece.type];
    if (piece.type === "k") {
      const homeRank = piece.color === "w" ? 0 : 7;
      if (rankOf(s) === homeRank) pieceScore += 0.1; // mild "stay safe" nudge
    } else {
      const weight = piece.type === "n" || piece.type === "b" ? 1.5 : 1;
      pieceScore += centrality(s) * 0.05 * weight;
    }
    score += piece.color === state.turn ? pieceScore : -pieceScore;
  }
  if (state.entrenched != null) {
    const entrenchedPiece = state.board[state.entrenched];
    if (entrenchedPiece) score += entrenchedPiece.color === state.turn ? 0.3 : -0.3;
  }
  return score;
}

/* -------------------------------------------- */
/*  Search                                       */
/* -------------------------------------------- */

function negamaxPosition(state, depth, alpha, beta, options) {
  const moves = generateMoves(state, options);
  if (!moves.length) return isInCheck(state) ? -MATE_SCORE : 0; // checkmate : stalemate
  if (depth <= 0) return evaluate(state);

  let best = -Infinity;
  for (const move of moves) {
    const value = negamaxMove(state, move, depth, alpha, beta, options);
    if (value > best) best = value;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

/** Value of playing `move` in `state`, from the perspective of `state.turn` (the mover). */
function negamaxMove(state, move, depth, alpha, beta, options) {
  if (move.capturedType === "k") return MATE_SCORE; // attacks on the King always succeed and end the game

  if (!move.capture) {
    const next = makeMove(state, move, { success: true });
    return -negamaxPosition(next, depth - 1, -beta, -alpha, options);
  }

  const defenderSq = move.enPassant ? move.epCapturedSq : move.to;
  const entrenched = state.entrenched === defenderSq;
  const p = hitChance(PIECE_VALUES[move.piece.type], PIECE_VALUES[move.capturedType], entrenched);

  const succState = makeMove(state, move, { success: true });
  const failState = makeMove(state, move, { success: false });
  const succValue = -negamaxPosition(succState, depth - 1, -beta, -alpha, options);
  const failValue = -negamaxPosition(failState, depth - 1, -beta, -alpha, options);
  return p * succValue + (1 - p) * failValue;
}

function shuffled(array, rng) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Pick a move for the side to move in `state`.
 *
 * options: { depth, blunderChance, kingsMayTouch, rng }. `rng` defaults to
 * Math.random and may be overridden for deterministic tests. Returns null
 * if there is no legal move (the caller should not be asking in that case —
 * check gameStatus() first).
 */
export function chooseMove(state, options = {}) {
  const opts = { depth: 2, blunderChance: 0, kingsMayTouch: false, rng: Math.random, ...options };
  const moves = generateMoves(state, opts);
  if (!moves.length) return null;

  if (opts.rng() < opts.blunderChance) {
    return moves[Math.floor(opts.rng() * moves.length)];
  }

  // Shuffling the search order gives otherwise-tied moves (e.g. opening
  // choices at low depth) some variety instead of always picking the first
  // one generated.
  const ordered = shuffled(moves, opts.rng);
  let alpha = -Infinity;
  const beta = Infinity;
  let bestMove = ordered[0];
  let bestValue = -Infinity;
  for (const move of ordered) {
    const value = negamaxMove(state, move, opts.depth, alpha, beta, opts);
    if (value > bestValue) {
      bestValue = value;
      bestMove = move;
    }
    if (bestValue > alpha) alpha = bestValue;
  }
  return bestMove;
}
