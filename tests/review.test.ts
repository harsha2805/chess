import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyzeGame, buildReview } from '../src/lib/analyze';
import { explain } from '../src/lib/explain';
import { recordsFromPgn } from '../src/lib/importers';
import { buildInsights, playerNames } from '../src/lib/insights';
import { parsePgn } from '../src/lib/pgn';
import type { GameRecord, GameReview, PositionEval } from '../src/lib/types';
import type { UciEngine } from '../src/lib/uci';
import { createNodeEngine, loadBook } from '../scripts/node-engine';

describe('review from given evaluations', () => {
  // 1. f3 e5 2. g4 Qh4#, with evaluations written by hand (White's point of view).
  const game = parsePgn('1. f3 e5 2. g4 Qh4# 0-1');
  const line = (move: string, cp: number) => ({ move, pv: [move], score: { cp }, depth: 10 });
  const evals: PositionEval[] = [
    { lines: [line('e2e4', 30), line('d2d4', 28)], score: { cp: 30 } },
    { lines: [line('e7e5', -60), line('d7d5', -55)], score: { cp: -60 } },
    { lines: [line('e2e4', -50), line('b1c3', -70)], score: { cp: -50 } },
    { lines: [{ move: 'd8h4', pv: ['d8h4'], score: { mate: -1 }, depth: 10 }, line('d7d5', -150)], score: { mate: -1 } },
    { lines: [], score: { mate: 0, cp: -100000 } },
  ];
  const review = buildReview(game, evals, { depth: 10, engine: 'test' });

  it('marks the blunder that allows mate and explains it', () => {
    const g4 = review.moves[2];
    expect(g4.mark).toBe('blunder');
    expect(g4.tags).toContainEqual({ kind: 'allowed_mate', in: 1, by: 'Qh4#' });
    expect(g4.best?.san).toBe('e4');
    const note = explain(g4);
    expect(note.lead).toBe('A blunder. e4 was the move.');
    expect(note.notes[0]).toBe('It allows mate in 1, starting with 2…Qh4#.');
  });

  it('marks the mating move as best and scores it as mate', () => {
    const mate = review.moves[3];
    expect(mate.mark).toBe('best');
    expect(mate.evalAfter.mate).toBe(0);
    expect(mate.tags).toContainEqual({ kind: 'checkmate' });
    expect(explain(mate).lead).toBe('Checkmate.');
  });

  it('gives the side that was mated the lower accuracy', () => {
    expect(review.accuracy.b).toBeGreaterThan(review.accuracy.w);
    expect(review.accuracy.b).toBeGreaterThan(95);
  });

  it('backs mate scores up the game so the previous position counts one more move', () => {
    // After 2. g4 Black mates in one; nothing earlier is a forced mate.
    expect(review.moves[2].evalAfter).toEqual({ mate: -1 });
    expect(review.moves[1].evalAfter.mate).toBeUndefined();
  });
});

describe('review with the real engine', () => {
  let engine: UciEngine;
  let opera: GameReview;
  const book = loadBook();

  beforeAll(async () => {
    engine = createNodeEngine();
    opera = await analyzeGame(parsePgn(readFileSync('tests/games/opera.pgn', 'utf8')), engine, { depth: 12, book });
  });
  afterAll(() => engine.dispose());

  it('names the opening and marks theory as book', () => {
    expect(opera.opening?.name).toMatch(/Philidor/);
    expect(opera.moves[0].mark).toBe('book');
  });

  it('finds the queen sacrifice and the mate in the Opera Game', () => {
    const byLabel = Object.fromEntries(opera.moves.map((m) => [`${Math.ceil(m.ply / 2)}${m.color}${m.san}`, m]));
    expect(byLabel['16wQb8+'].mark).toBe('brilliant');
    expect(byLabel['16wQb8+'].tags).toContainEqual({ kind: 'sacrifice', piece: 'q' });
    expect(byLabel['16bNxb8'].mark).toBe('forced');
    expect(byLabel['17wRd8#'].mark).toBe('best');
    expect(byLabel['10wNxb5'].mark).toBe('brilliant');
  });

  it('rates Morphy well above his opponents', () => {
    expect(opera.accuracy.w).toBeGreaterThan(90);
    expect(opera.accuracy.w).toBeGreaterThan(opera.accuracy.b + 5);
    for (const m of opera.moves) {
      expect(m.accuracy).toBeGreaterThanOrEqual(0);
      expect(m.accuracy).toBeLessThanOrEqual(100);
      expect(m.loss).toBeGreaterThanOrEqual(0);
    }
  });

  it('builds insights whose totals add up', async () => {
    const { records } = recordsFromPgn(readFileSync('tests/games/fixtures.pgn', 'utf8'));
    const games: GameRecord[] = [];
    for (const record of records.slice(0, 3)) {
      const review = await analyzeGame(parsePgn(record.pgn), engine, { depth: 8, book });
      games.push({ ...record, review });
    }
    games.push(records[3]); // imported but not reviewed
    expect(playerNames(games)[0]).toEqual({ name: 'harsha2805', games: 4 });

    const insights = buildInsights(games, 'HARSHA2805');
    expect(insights.games).toBe(4);
    expect(insights.reviewed).toBe(3);
    expect(insights.record.wins + insights.record.draws + insights.record.losses).toBe(3);
    const myMoves = games.slice(0, 3).reduce((n, g) => {
      const color = g.white.name === 'harsha2805' ? 'w' : 'b';
      return n + g.review!.moves.filter((m) => m.color === color).length;
    }, 0);
    expect(insights.moves).toBe(myMoves);
    expect(Object.values(insights.marks).reduce((a, b) => a + b, 0)).toBe(myMoves);
    expect(insights.byPhase.map((p) => p.phase)).toEqual(['opening', 'middlegame', 'endgame']);
    expect(insights.byClock.reduce((n, b) => n + b.moves, 0)).toBeLessThanOrEqual(myMoves);
    expect(insights.trend).toHaveLength(3);
    for (const motif of insights.motifs) expect(motif.examples.length).toBeGreaterThan(0);
  });
});
