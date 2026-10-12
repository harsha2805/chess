import type { Chess, Move, Square } from 'chess.js';
import type { Color, PieceType } from './types';

export const PIECE_VALUE: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');

// chess.js builds a full Move object (SAN, FEN before and after) for every move it lists
// in verbose form, so listing all moves is far too slow to call inside an exchange. These
// helpers ask only for the attackers of one square, and play a single move to test it.

/** Plays the least valuable legal capture on `square`, queening when a pawn promotes. Null when there is none. */
function captureWithLeast(chess: Chess, square: Square): Move | null {
  const attackers = chess
    .attackers(square, chess.turn())
    .map((from) => ({ from, value: PIECE_VALUE[chess.get(from)!.type as PieceType] }))
    .sort((a, b) => a.value - b.value);
  for (const { from } of attackers) {
    try {
      // Illegal when the attacker is pinned to its king, or the king would walk into check.
      return chess.move({ from, to: square, promotion: 'q' });
    } catch {
      // Try the next attacker.
    }
  }
  return null;
}

/**
 * Static exchange evaluation: the material the side to move wins by starting a
 * capture sequence on `square`, assuming both sides capture with their least
 * valuable piece and may stop at any time. Only legal captures are considered,
 * so pins against the king are respected.
 */
export function see(chess: Chess, square: Square): number {
  const target = chess.get(square);
  if (!target || target.color === chess.turn()) return 0;
  const pick = captureWithLeast(chess, square);
  if (!pick) return 0;
  const won = PIECE_VALUE[pick.captured as PieceType] + (pick.promotion ? PIECE_VALUE[pick.promotion as PieceType] - 1 : 0);
  const gain = won - see(chess, square);
  chess.undo();
  return Math.max(0, gain);
}

export interface Threat {
  square: Square;
  piece: PieceType;
  gain: number;
}

/** Pieces of the side that just moved which the side to move can capture with a material gain. */
export function hangingPieces(chess: Chess): Threat[] {
  const us = chess.turn();
  const out: Threat[] = [];
  for (const row of chess.board()) {
    for (const cell of row) {
      if (!cell || cell.color === us || cell.type === 'k') continue;
      if (!chess.isAttacked(cell.square, us)) continue;
      const gain = see(chess, cell.square);
      if (gain > 0) out.push({ square: cell.square, piece: cell.type as PieceType, gain });
    }
  }
  return out.sort((a, b) => b.gain - a.gain);
}

/**
 * Pieces attacked at once by the piece standing on `square`, when that amounts to a fork:
 * at least two targets that are the king, worth more than the attacker, or undefended.
 * Call with the opponent of the forking piece to move. Returns [] when there is no fork
 * or the forking piece can simply be taken.
 */
export function forkTargets(chess: Chess, square: Square): PieceType[] {
  const attacker = chess.get(square);
  if (!attacker) return [];
  const us: Color = attacker.color;
  const them = other(us);
  if (chess.turn() !== them) return [];
  const targets: PieceType[] = [];
  for (const row of chess.board()) {
    for (const cell of row) {
      if (!cell || cell.color !== them) continue;
      if (!chess.attackers(cell.square, us).includes(square)) continue;
      const type = cell.type as PieceType;
      const worthMore = PIECE_VALUE[type] > PIECE_VALUE[attacker.type as PieceType];
      const loose = type !== 'p' && !chess.isAttacked(cell.square, them);
      if (type === 'k' || worthMore || loose) targets.push(type);
    }
  }
  if (targets.length < 2) return [];
  // A fork only counts if the forking piece is not simply lost.
  if (see(chess, square) > 0) return [];
  return targets.sort((a, b) => PIECE_VALUE[b] - PIECE_VALUE[a]);
}
