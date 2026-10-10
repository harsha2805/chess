import type { Chess, Move, Square } from 'chess.js';
import type { Color, PieceType } from './types';

export const PIECE_VALUE: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

/**
 * Static exchange evaluation: the material the side to move wins by starting a
 * capture sequence on `square`, assuming both sides capture with their least
 * valuable piece and may stop at any time. Only legal captures are considered,
 * so pins against the king are respected.
 */
export function see(chess: Chess, square: Square): number {
  const captures = (chess.moves({ verbose: true }) as Move[]).filter((m) => m.to === square && m.captured);
  if (captures.length === 0) return 0;
  let pick = captures[0];
  for (const m of captures) {
    const better = PIECE_VALUE[m.piece as PieceType] < PIECE_VALUE[pick.piece as PieceType];
    const samePieceQueening = m.from === pick.from && m.promotion === 'q';
    if (better || samePieceQueening) pick = m;
  }
  const won = PIECE_VALUE[pick.captured as PieceType] + (pick.promotion ? PIECE_VALUE[pick.promotion as PieceType] - 1 : 0);
  chess.move(pick);
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
  const targets = new Map<Square, PieceType>();
  for (const m of chess.moves({ verbose: true }) as Move[]) {
    if (m.captured && !m.isEnPassant()) targets.set(m.to, m.captured as PieceType);
  }
  const out: Threat[] = [];
  for (const [square, piece] of targets) {
    const gain = see(chess, square);
    if (gain > 0) out.push({ square, piece, gain });
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
  const them: Color = us === 'w' ? 'b' : 'w';
  if (chess.turn() !== them) return [];
  const targets: PieceType[] = [];
  for (const row of chess.board()) {
    for (const cell of row) {
      if (!cell || cell.color !== them) continue;
      if (!chess.attackers(cell.square, us).includes(square)) continue;
      const type = cell.type as PieceType;
      const worthMore = PIECE_VALUE[type] > PIECE_VALUE[attacker.type as PieceType];
      const loose = type !== 'p' && chess.attackers(cell.square, them).length === 0;
      if (type === 'k' || worthMore || loose) targets.push(type);
    }
  }
  if (targets.length < 2) return [];
  // A fork only counts if the forking piece is not simply lost.
  if (see(chess, square) > 0) return [];
  return targets.sort((a, b) => PIECE_VALUE[b] - PIECE_VALUE[a]);
}
