import { describe, expect, it } from 'vitest';
import { buildInsights, insightPlayers, resolvePlayer } from '../src/lib/insights';
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

describe('whose insights can be shown', () => {
  const imported = (white: string, black: string, me: 'w' | 'b'): GameRecord => ({ ...game(white, black), source: 'chesscom', me });

  it('lists the account of imported games, not an opponent met more than once', () => {
    const games = [imported('Harsha', 'rival', 'w'), imported('rival', 'Harsha', 'b'), imported('Harsha', 'other', 'w')];
    expect(insightPlayers(games)).toEqual([{ name: 'Harsha', games: 3 }]);
  });
  it('lists anyone in two or more pasted games, and the account holder', () => {
    const games = [game('Morphy', 'Duke'), game('Morphy', 'Anderssen'), game('Anderssen', 'Paulsen'), imported('me', 'Morphy', 'w')];
    expect(insightPlayers(games).map((p) => p.name)).toEqual(['Morphy', 'Anderssen', 'me']);
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

describe('accuracy by phase', () => {
  it('leaves out moves made once the game was already won or lost', () => {
    const decided = { ...move(3, 'good'), accuracy: 100, winBefore: 97 };
    const insights = buildInsights([reviewed([{ ...move(1, 'blunder'), winBefore: 55 }, decided])], 'me');
    const middlegame = insights.byPhase.find((p) => p.phase === 'middlegame')!;
    expect(middlegame.moves).toBe(1);
    expect(middlegame.accuracy).toBe(20);
  });
});

describe('ratings', () => {
  it('follows the rating in each time control, most played first', () => {
    const rated = (playedAt: number, rating: number, timeClass: GameRecord['timeClass']): GameRecord => ({
      ...game('me', 'them'),
      white: { name: 'me', rating },
      playedAt,
      timeClass,
    });
    const insights = buildInsights([rated(3, 1530, 'blitz'), rated(1, 1500, 'blitz'), rated(2, 1490, 'blitz'), rated(1, 1300, 'rapid')], 'me');
    expect(insights.ratings).toEqual([
      { timeClass: 'blitz', latest: 1530, change: 30, games: 3 },
      { timeClass: 'rapid', latest: 1300, change: 0, games: 1 },
    ]);
  });
});
