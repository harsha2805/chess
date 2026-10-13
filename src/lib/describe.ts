import type { Move } from 'chess.js';

const PIECE_NAME: Record<string, string> = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
const SIDE = { w: 'White', b: 'Black' } as const;

/** Where each side's knights and bishops start. A move from one of these brings the piece into play. */
const HOME: Record<string, string[]> = {
  wn: ['b1', 'g1'],
  wb: ['c1', 'f1'],
  bn: ['b8', 'g8'],
  bb: ['c8', 'f8'],
};
const CENTRE = new Set(['d4', 'e4', 'd5', 'e5']);
const LONG_DIAGONAL = new Set(['b2', 'g2', 'b7', 'g7']);

/** "the e-pawn", "the knight". */
function pieceName(piece: string, square: string): string {
  return piece === 'p' ? `${square[0]}-pawn` : PIECE_NAME[piece];
}

/**
 * One move in plain words, from what the move itself shows, for someone learning the moves:
 * "White's knight comes out from g1 to f3." Only facts about the move are stated; why it is
 * played is left to the opening's description.
 */
export function describeMove(m: Move): string {
  const side = SIDE[m.color];
  const other = SIDE[m.color === 'w' ? 'b' : 'w'];
  let text: string;

  if (m.flags.includes('k') || m.flags.includes('q')) {
    const king = m.flags.includes('k');
    const rank = m.color === 'w' ? '1' : '8';
    text = `${side} castles on the ${king ? 'king’s' : 'queen’s'} side: the king goes to ${m.to} and the rook from ${king ? 'h' : 'a'}${rank} to ${king ? 'f' : 'd'}${rank}, tucking the king away and bringing the rook towards the centre.`;
  } else {
    const who = `${side}’s ${pieceName(m.piece, m.from)}`;
    if (m.captured) {
      const victim = m.flags.includes('e') ? `${other}’s pawn en passant, landing on ${m.to}` : `${other}’s ${PIECE_NAME[m.captured]} on ${m.to}`;
      text = `${who} takes ${victim}.`;
    } else if (m.piece === 'p' && m.flags.includes('b')) {
      text = `${who} moves two squares, from ${m.from} to ${m.to}${CENTRE.has(m.to) ? ', claiming space in the centre' : ''}.`;
    } else if (m.piece === 'p') {
      text = `${who} moves one square, from ${m.from} to ${m.to}${CENTRE.has(m.to) ? ', into the centre' : ''}.`;
    } else if (HOME[m.color + m.piece]?.includes(m.from)) {
      const fianchetto = m.piece === 'b' && LONG_DIAGONAL.has(m.to);
      text = `${who} comes out from ${m.from} to ${m.to}${fianchetto ? ', onto the long diagonal: a fianchetto' : ''}.`;
    } else {
      text = `${who} goes from ${m.from} to ${m.to}.`;
    }
    if (m.promotion) text = `${text.slice(0, -1)} and becomes a ${PIECE_NAME[m.promotion]}.`;
  }

  if (m.san.endsWith('#')) text += ' Checkmate.';
  else if (m.san.endsWith('+')) text += ` Check: ${other}’s king is attacked.`;
  return text;
}
