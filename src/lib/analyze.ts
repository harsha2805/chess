import { Chess, type Move, type Square } from 'chess.js';
import { gameAccuracy, moveAccuracy, rank, toWhite, whiteWin, winFor } from './score';
import { PIECE_VALUE, forkTargets, hangingPieces, see } from './see';
import { isStandardStart, parseTimeControl } from './pgn';
import {
  REVIEW_VERSION,
  type Color,
  type Engine,
  type GameReview,
  type Mark,
  type MoveReview,
  type ParsedGame,
  type ParsedMove,
  type Phase,
  type PieceType,
  type PositionEval,
  type Score,
  type Tag,
} from './types';

/** Looks a position up in the openings book: "ECO|Name", "" (on a known line), or undefined. */
export type BookLookup = (fen: string) => string | undefined;

export interface AnalyzeOptions {
  depth: number;
  /** Cap per position in milliseconds, so slow devices still finish. */
  movetime?: number;
  book?: BookLookup;
  onProgress?: (done: number, total: number) => void;
  isCancelled?: () => boolean;
}

export class CancelledError extends Error {
  constructor() {
    super('Review cancelled');
  }
}

export const bookKey = (fen: string) => fen.split(' ').slice(0, 3).join(' ');

/** Every position of the game: the start, then the position after each move. */
export const positionsOf = (game: ParsedGame) => [game.startFen, ...game.moves.map((m) => m.fenAfter)];

/**
 * A key shared by positions that can share one evaluation: same pieces, side to move,
 * castling rights and en passant square. A game that repeats moves comes back to the
 * same positions, and they need not be searched again. Near the fifty-move rule the move
 * counter changes what a position is worth, so those positions get no key.
 */
export function repeatKey(fen: string): string | null {
  const fields = fen.split(' ');
  return Number(fields[4]) >= 80 ? null : fields.slice(0, 4).join(' ');
}

/** Evaluates one position. Terminal positions are scored without the engine. */
export async function evaluatePosition(fen: string, engine: Engine, opts: AnalyzeOptions): Promise<PositionEval> {
  const chess = new Chess(fen);
  const turn = chess.turn();
  if (chess.isCheckmate()) {
    return { lines: [], score: { mate: 0, cp: turn === 'w' ? -100000 : 100000 } };
  }
  if (chess.isStalemate() || chess.isInsufficientMaterial()) {
    return { lines: [], score: { cp: 0 } };
  }
  const raw = await engine.search(fen, { depth: opts.depth, multipv: 2, movetime: opts.movetime });
  if (raw.length === 0) return { lines: [], score: { cp: 0 } };
  const lines = raw.map((r) => ({ move: r.move, pv: r.pv, score: toWhite(r, turn), depth: r.depth }));
  return { lines, score: lines[0].score };
}

/** Runs the engine over every position of the game and builds the review. */
export async function analyzeGame(game: ParsedGame, engine: Engine, opts: AnalyzeOptions): Promise<GameReview> {
  const fens = positionsOf(game);
  const evals: PositionEval[] = new Array(fens.length);
  const seen = new Map<string, number>();
  await engine.newGame();
  // Last position first: what the engine learns about later positions stays in its
  // hash table and sharpens the earlier ones, so a combination found at move 20 is
  // already known when move 19 is judged.
  for (let i = fens.length - 1; i >= 0; i--) {
    if (opts.isCancelled?.()) throw new CancelledError();
    const key = repeatKey(fens[i]);
    const twin = key ? seen.get(key) : undefined;
    evals[i] = twin !== undefined ? evals[twin] : await evaluatePosition(fens[i], engine, opts);
    if (key) seen.set(key, i);
    opts.onProgress?.(fens.length - i, fens.length);
  }
  if (opts.isCancelled?.()) throw new CancelledError();
  return buildReview(game, evals, { book: opts.book, depth: opts.depth, engine: engine.name });
}

/** Moves until `color` mates, when the score is a forced mate for that side. Otherwise 0. */
function mateFor(score: Score, color: Color): number {
  if (score.mate === undefined || score.mate === 0) return 0;
  const n = color === 'w' ? score.mate : -score.mate;
  return n > 0 ? n : 0;
}

function uciToMove(chess: Chess, uci: string): Move | null {
  try {
    return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  } catch {
    return null;
  }
}

/** How many moves of an engine line a review keeps, in SAN. */
const LINE_LENGTH = 4;

/** Converts an engine line to SAN, as far as it stays legal. */
function pvToSan(fen: string, pv: string[], limit: number): string[] {
  const out: string[] = [];
  if (pv.length === 0) return out;
  const chess = new Chess(fen);
  for (const uci of pv.slice(0, limit)) {
    const m = uciToMove(chess, uci);
    if (!m) break;
    out.push(m.san);
  }
  return out;
}

function nextPhase(chess: Chess, ply: number, current: Phase, inBook: boolean): Phase {
  if (current === 'endgame') return current;
  let pieces = 0;
  const backRank = { w: 0, b: 0 };
  for (const row of chess.board()) {
    for (const cell of row) {
      if (!cell) continue;
      if (cell.type !== 'p' && cell.type !== 'k') pieces++;
      if (cell.color === 'w' && cell.square[1] === '1') backRank.w++;
      if (cell.color === 'b' && cell.square[1] === '8') backRank.b++;
    }
  }
  if (pieces <= 6) return 'endgame';
  if (current === 'middlegame') return current;
  if (inBook) return 'opening';
  if (pieces <= 10 || backRank.w < 4 || backRank.b < 4 || ply > 24) return 'middlegame';
  return 'opening';
}

interface BuildContext {
  book?: BookLookup;
  depth: number;
  engine: string;
  /** Set when the critical positions were searched again this deep: how deep, and how many. */
  verify?: { depth: number; positions: number };
}

/** The score of a position, seen one move earlier: a mate takes one more move for the side delivering it. */
function backUp(child: Score, mover: Color): Score {
  if (child.mate === undefined) return child;
  const whiteMates = child.mate > 0 || (child.mate === 0 && (child.cp ?? 0) > 0);
  const moverMates = whiteMates === (mover === 'w');
  const distance = Math.abs(child.mate) + (moverMates ? 1 : 0);
  return { mate: whiteMates ? distance : -distance };
}

/**
 * Makes the evaluations consistent along the game. The position after a move was searched
 * one move deeper than the same move seen from the position before, so its score replaces
 * the shallower estimate, and each position is then worth its best known option. Without
 * this, a combination the engine only sees a move later shows up as a false error.
 */
function reconcile(game: ParsedGame, evals: PositionEval[]) {
  const n = game.moves.length;
  const scores: Score[] = new Array(n + 1);
  /** Index into evals[i].lines of the best alternative to the move played, or -1. */
  const alternative: number[] = new Array(n).fill(-1);
  /** True when nothing the engine listed beats the move played. */
  const playedIsTop: boolean[] = new Array(n).fill(false);
  scores[n] = evals[n].score;
  for (let i = n - 1; i >= 0; i--) {
    const mover = game.moves[i].color;
    const lines = evals[i].lines;
    const child = backUp(scores[i + 1], mover);
    let alt = -1;
    lines.forEach((line, k) => {
      if (line.move === game.moves[i].uci) return;
      if (alt < 0 || rank(line.score, mover) > rank(lines[alt].score, mover)) alt = k;
    });
    alternative[i] = alt;
    if (alt >= 0 && rank(lines[alt].score, mover) > rank(child, mover)) {
      scores[i] = lines[alt].score;
    } else {
      scores[i] = child;
      playedIsTop[i] = true;
    }
  }
  return { scores, alternative, playedIsTop };
}

/** Turns raw position evaluations into marks, accuracy and explanations. Pure and synchronous. */
export function buildReview(game: ParsedGame, evals: PositionEval[], ctx: BuildContext): GameReview {
  const moves: MoveReview[] = [];
  const timeControl = parseTimeControl(game.headers.TimeControl);
  const lastClock: Partial<Record<Color, number>> = {};
  let phase: Phase = 'opening';
  let inBook = !!ctx.book && isStandardStart(game);
  let opening: GameReview['opening'];
  const { scores, alternative, playedIsTop } = reconcile(game, evals);
  const standingOffers: Record<Color, Set<string>> = { w: new Set(), b: new Set() };

  /** The strongest known move in position `j` (the move played there, when nothing beats it). */
  const bestUciAt = (j: number): string | undefined => {
    if (j >= game.moves.length) return evals[j].lines[0]?.move;
    if (playedIsTop[j]) return game.moves[j].uci;
    return evals[j].lines[alternative[j]]?.move;
  };

  /** The engine line that starts with that move, when it has one. */
  const bestPvAt = (j: number): string[] => {
    const uci = bestUciAt(j);
    if (!uci) return [];
    return evals[j].lines.find((l) => l.move === uci)?.pv ?? [uci];
  };

  /** The same engine line is often shown twice: as what follows one move and as the better choice at the next. */
  const sanLines = new Map<string, string[]>();
  const sanLine = (fen: string, pv: string[]): string[] => {
    const key = `${fen}|${pv.slice(0, LINE_LENGTH).join(' ')}`;
    let san = sanLines.get(key);
    if (!san) sanLines.set(key, (san = pvToSan(fen, pv, LINE_LENGTH)));
    return san;
  };

  game.moves.forEach((m, i) => {
    const lines = evals[i].lines;
    const scoreBefore = scores[i];
    const scoreAfter = scores[i + 1];
    const mover = m.color;
    const opponent: Color = mover === 'w' ? 'b' : 'w';

    // Opening book: only while the game has followed known theory from move one.
    let isBook = false;
    if (inBook) {
      const entry = ctx.book!(m.fenAfter);
      if (entry === undefined) inBook = false;
      else {
        isBook = true;
        if (entry) {
          const [eco, name] = entry.split('|');
          opening = { eco, name, ply: m.ply };
        }
      }
    }

    const posBefore = new Chess(m.fenBefore);
    phase = nextPhase(posBefore, m.ply, phase, isBook);
    const legalCount = posBefore.moves().length;
    const posAfter = new Chess(m.fenAfter);

    const winBefore = winFor(scoreBefore, mover);
    const winAfter = winFor(scoreAfter, mover);
    const altLine = alternative[i] >= 0 ? lines[alternative[i]] : undefined;
    const listed = lines.some((l) => l.move === m.uci);
    /** The engine chose this move, or listed it and a deeper look confirms nothing beats it. */
    const playedBest = playedIsTop[i] && listed;
    /** What to show as the engine's choice: the stronger alternative, or the move itself. */
    const bestLine = playedIsTop[i] ? lines.find((l) => l.move === m.uci) ?? lines[0] : altLine;

    const mateBefore = mateFor(scoreBefore, mover);
    const mateAfter = mateFor(scoreAfter, mover);
    const deliversMate = scoreAfter.mate === 0;
    const keepsMate = mateBefore > 0 && (deliversMate || (mateAfter > 0 && mateAfter <= mateBefore - 1));

    const isBest = playedBest || keepsMate || deliversMate;
    const loss = isBest ? 0 : Math.max(0, winBefore - winAfter);

    // Material offered by the move: the most the opponent can win by capturing a piece.
    const captureValue = m.captured ? PIECE_VALUE[m.captured] : 0;
    const threats = hangingPieces(posAfter).filter((t) => t.piece !== 'p');
    // Only a fresh offer counts: a piece that was already hanging a move ago is old news.
    const offered = threats.find((t) => t.square === m.to || !standingOffers[mover].has(t.square));
    standingOffers[mover] = new Set(threats.map((t) => t.square));
    const isSacrifice = !!offered && offered.gain - captureValue >= 1;

    // The best alternative to the move played, to judge how necessary it was.
    const altWin = altLine ? winFor(altLine.score, mover) : undefined;

    const prev = moves[i - 1];
    const isRecapture = !!prev && !!m.captured && game.moves[i - 1].captured !== undefined && game.moves[i - 1].to === m.to;
    const plainWin = !!m.captured && captureValue - see(posAfter, m.to as Square) >= 1;

    let mark: Mark;
    if (isBook) mark = 'book';
    else if (legalCount === 1) mark = 'forced';
    else if (
      isSacrifice &&
      loss <= 2 &&
      winAfter >= 45 &&
      // Not already winning without it, unless the sacrifice is what forces mate.
      (altWin === undefined || altWin <= 85 || (mateAfter > 0 && mateFor(altLine!.score, mover) === 0)) &&
      !deliversMateTrivially(m, mateBefore)
    ) {
      mark = 'brilliant';
    } else if (deliversMate) mark = 'best';
    else if (
      playedBest &&
      altWin !== undefined &&
      // Every other move throws away the win, or the draw.
      winAfter - altWin >= 12 &&
      altWin <= 75 &&
      winAfter >= 35 &&
      !isRecapture &&
      !plainWin
    ) {
      mark = 'great';
    } else if (isBest) mark = 'best';
    else if (loss <= 2) mark = 'excellent';
    else if (loss <= 5) mark = 'good';
    else if (
      loss >= 10 &&
      prev &&
      prev.loss >= 10 &&
      // Not worse off than before the opponent's error: the chance was missed, nothing more.
      winAfter >= 100 - prev.winBefore - 5
    ) {
      mark = 'miss';
    } else if (loss <= 10) mark = 'inaccuracy';
    else if (loss <= 20) mark = 'mistake';
    else mark = 'blunder';

    // Engine's reply to the move played.
    let reply: MoveReview['reply'];
    let replyMove: Move | null = null;
    const replyUci = bestUciAt(i + 1);
    if (replyUci) {
      replyMove = uciToMove(posAfter, replyUci);
      if (replyMove) {
        reply = { uci: replyUci, san: replyMove.san };
      }
    }
    // posAfter now has the reply played (when there is one).

    const tags: Tag[] = [];
    if (deliversMate) tags.push({ kind: 'checkmate' });
    if (mark === 'brilliant' && offered) tags.push({ kind: 'sacrifice', piece: offered.piece });
    if (mark === 'great') tags.push({ kind: 'only_move' });

    if (!isBook) {
      if (mateBefore > 0 && !isBest) tags.push({ kind: 'missed_mate', in: mateBefore });
      const mateAgainst = mateFor(scoreAfter, opponent);
      if (mateAgainst > 0 && mateFor(scoreBefore, opponent) === 0 && reply) {
        tags.push({ kind: 'allowed_mate', in: mateAgainst, by: reply.san });
      }

      if (loss >= 5 && replyMove) {
        if (replyMove.captured && !tags.some((t) => t.kind === 'allowed_mate')) {
          const net = PIECE_VALUE[replyMove.captured as PieceType] - see(posAfter, replyMove.to) - captureValue;
          if (net >= 1) {
            tags.push({
              kind: 'hung',
              piece: replyMove.captured as PieceType,
              square: replyMove.to,
              by: replyMove.san,
              moved: replyMove.to === m.to,
            });
          }
        }
        const targets = forkTargets(posAfter, replyMove.to);
        if (targets.length >= 2) tags.push({ kind: 'allowed_fork', san: replyMove.san, targets });
      }

      if (!isBest && loss >= 5 && bestLine) {
        const bestMove = uciToMove(posBefore, bestLine.move);
        if (bestMove) {
          if (bestMove.captured && PIECE_VALUE[bestMove.captured as PieceType] - see(posBefore, bestMove.to) >= 1) {
            tags.push({ kind: 'missed_capture', san: bestMove.san, piece: bestMove.captured as PieceType });
          }
          const targets = forkTargets(posBefore, bestMove.to);
          if (targets.length >= 2) tags.push({ kind: 'missed_fork', san: bestMove.san, targets });
          posBefore.undo();
        }
      }

      if (loss <= 5 && !deliversMate) {
        if (replyMove) posAfter.undo();
        const targets = forkTargets(posAfter, m.to as Square);
        if (targets.length >= 2) tags.push({ kind: 'fork', targets });
      }
    }

    // Walking into a forced mate is never a clean move, even from a lost position.
    if (tags.some((t) => t.kind === 'allowed_mate') && (mark === 'excellent' || mark === 'good')) mark = 'inaccuracy';

    // Clocks.
    let spent: number | undefined;
    if (m.clock !== undefined) {
      const previous = lastClock[mover] ?? timeControl?.base;
      if (previous !== undefined) spent = Math.max(0, previous - m.clock + (timeControl?.inc ?? 0));
      const available = previous ?? m.clock;
      if (timeControl && loss >= 5 && available <= Math.max(5, timeControl.base * 0.1)) {
        tags.push({ kind: 'time_pressure', clock: available });
      }
      lastClock[mover] = m.clock;
    }

    // Converting engine lines to SAN is the slowest part of building a review, so only the
    // moves the page shows are converted. When the move played was the engine's choice, its
    // line is the move itself followed by the expected continuation.
    const follow = sanLine(m.fenAfter, bestPvAt(i + 1));
    let best: MoveReview['best'];
    if (bestLine && bestLine.move === m.uci) {
      best = { uci: m.uci, san: m.san, pv: [m.san, ...follow.slice(0, LINE_LENGTH - 1)] };
    } else if (bestLine) {
      const pv = sanLine(m.fenBefore, bestLine.pv);
      best = { uci: bestLine.move, san: pv[0] ?? bestLine.move, pv };
    }

    moves.push({
      ply: m.ply,
      color: mover,
      san: m.san,
      uci: m.uci,
      mark,
      loss,
      accuracy: moveAccuracy(loss),
      winBefore,
      winAfter,
      evalAfter: scoreAfter,
      best,
      reply,
      follow,
      tags,
      phase,
      clock: m.clock,
      spent,
    });
  });

  const whiteWins = scores.map((sc) => whiteWin(sc));
  const accuracy = gameAccuracy(
    whiteWins,
    moves.map((m) => m.accuracy),
    game.moves[0]?.color ?? 'w',
  );

  return {
    version: REVIEW_VERSION,
    engine: ctx.engine,
    depth: ctx.depth,
    ...depthReached(evals, ctx.depth),
    ...(ctx.verify ? { verifyDepth: ctx.verify.depth, verified: ctx.verify.positions } : {}),
    analyzedAt: Date.now(),
    startEval: scores[0],
    moves,
    accuracy,
    opening,
  };
}

/**
 * How far the engine really looked. The time limit can stop a search before the depth asked
 * for, and the review says so rather than claim more than was done. A forced mate the engine
 * found is exact, so it counts as reaching the depth asked for.
 */
function depthReached(evals: PositionEval[], target: number): { reached: number; capped: number } {
  let searched = 0;
  let total = 0;
  let capped = 0;
  for (const e of evals) {
    const top = e?.lines[0];
    if (!top) continue;
    const depth = top.score.mate !== undefined ? Math.max(top.depth, target) : top.depth;
    searched++;
    total += Math.min(depth, target);
    if (depth < target) capped++;
  }
  if (searched === 0) return { reached: target, capped: 0 };
  return { reached: Math.round((total / searched) * 10) / 10, capped };
}

/** A queen "sacrifice" that is simply mate in one is best play, not brilliance. */
function deliversMateTrivially(m: ParsedMove, mateBefore: number): boolean {
  return mateBefore === 1 || m.san.endsWith('#');
}
