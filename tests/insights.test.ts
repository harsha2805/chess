import { describe, expect, it } from 'vitest';
import { buildInsights, resolvePlayer } from '../src/lib/insights';
import { REVIEW_VERSION, type GameRecord, type Mark, type MoveReview, type PieceType, type Tag } from '../src/lib/types';

const game = (white: string, black: string): GameRecord => ({
  id: `${white}-${black}-${Math.random()}`,
  source: 'pgn',
  pgn: '',
  white: { name: white },
  black: { name: black },
  result: '1-0',
  playedAt: 0,
  timeClass: 'blitz',
  plies: 2,
  addedAt: 0,
});

describe('whose games these are', () => {
  it('keeps the stored name, with the spelling used in the games', () => {
    expect(resolvePlayer([game('Harsha', 'a'), game('b', 'Harsha')], 'harsha')).toBe('Harsha');
  });
  it('picks the one player who is in most of the games', () => {
    expect(resolvePlayer([game('me', 'a'), game('b', 'me'), game('me', 'c')], '')).toBe('me');
  });
  it('does not guess from a single game or a tie', () => {
    expect(resolvePlayer([game('x', 'y')], '')).toBe('');
    expect(resolvePlayer([game('x', 'y'), game('x', 'y')], '')).toBe('');
  });
  it('drops a stored name that no longer appears', () => {
    expect(resolvePlayer([game('x', 'y')], 'gone')).toBe('');
  });
});

/** One of White's moves, with the opponent's reply in between left out. */
function move(ply: number, mark: Mark, tags: Tag[] = []): MoveReview {
  return {
    ply,
    color: 'w',
    san: 'a3',
    uci: 'a2a3',
    mark,
    loss: mark === 'blunder' ? 30 : 0,
    accuracy: mark === 'blunder' ? 20 : 100,
    winBefore: 50,
    winAfter: 50,
    evalAfter: { cp: 0 },
    tags,
    phase: 'middlegame',
  };
}

const hung = (piece: PieceType, square: string): Tag => ({ kind: 'hung', piece, square, by: `x${square}`, moved: false });

function reviewed(moves: MoveReview[]): GameRecord {
  return {
    ...game('me', 'them'),
    plies: moves.length * 2,
    review: { version: REVIEW_VERSION, engine: 'test', depth: 12, analyzedAt: 0, startEval: { cp: 0 }, moves, accuracy: { w: 50, b: 50 } },
  };
}

describe('the errors behind the numbers', () => {
  it('counts a piece left hanging move after move once, and pawns apart from pieces', () => {
    const insights = buildInsights(
      [
        reviewed([
          move(1, 'blunder', [hung('n', 'f3')]),
          move(3, 'blunder', [hung('n', 'f3')]), // the same knight, still there
          move(5, 'good'),
          move(7, 'blunder', [hung('n', 'f3')]), // left hanging again later: a new error
          move(9, 'blunder', [hung('p', 'e4')]),
        ]),
      ],
      'me',
    );
    const pieces = insights.motifs.find((m) => m.key === 'hung');
    const pawns = insights.motifs.find((m) => m.key === 'hung-pawn');
    expect(pieces?.count).toBe(2);
    expect(pieces?.label).toBe('Left a piece to be taken');
    expect(pawns?.count).toBe(1);
    expect(pawns?.label).toBe('Left a pawn to be taken');
  });
});
