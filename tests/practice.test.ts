import { Chess } from 'chess.js';
import { afterAll, describe, expect, it } from 'vitest';
import { createNodeEngine } from '../scripts/node-engine';
import {
  ANALYSIS_DEPTH,
  ENGINE_ELO_MIN,
  analyse,
  botMove,
  botStyle,
  closePractice,
  pickMove,
  setPracticeEngineFactory,
  startingElo,
  type Analysis,
} from '../src/lib/practice';
import { mergePractice } from '../src/lib/remote';
import type { PracticeLine, RawLine } from '../src/lib/types';

setPracticeEngineFactory(createNodeEngine);
afterAll(() => closePractice());

const line = (move: string, cp: number): RawLine => ({ move, pv: [move], cp, depth: 10 });

describe('the bot', () => {
  it('lets Stockfish limit itself from 1320 up, and weakens itself smoothly below', () => {
    expect(botStyle(ENGINE_ELO_MIN)).toMatchObject({ limit: true });
    const low = botStyle(800);
    const mid = botStyle(1230);
    expect(low.limit).toBe(false);
    expect(low.depth).toBeLessThan(mid.depth);
    expect(low.temperature).toBeGreaterThan(mid.temperature);
    // Steps of 10 change the bot, not just whole levels.
    expect(botStyle(1220).temperature).toBeGreaterThan(botStyle(1230).temperature);
  });

  it('picks worse moves less often, and the best when it may not choose', () => {
    const lines = [line('e2e4', 30), line('d2d4', 20), line('g1h3', -400)];
    expect(pickMove(lines, 0)).toBe('e2e4');
    const counts: Record<string, number> = {};
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 2000; i++) {
      const m = pickMove(lines, 60, random);
      counts[m] = (counts[m] ?? 0) + 1;
    }
    expect(counts['e2e4']).toBeGreaterThan(counts['d2d4']);
    expect(counts['g1h3'] ?? 0).toBeLessThan(20);
  });

  it('starts at the person’s rating, inside the range it can play', () => {
    expect(startingElo(1227)).toBe(1227);
    expect(startingElo(undefined)).toBe(1200);
    expect(startingElo(150)).toBe(400);
    expect(startingElo(3500)).toBe(3190);
  });

  it('answers with a legal move at a low and a limited rating', async () => {
    const fen = new Chess().fen();
    for (const elo of [900, 1500]) {
      const uci = await botMove(fen, elo);
      expect(() => new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })).not.toThrow();
    }
  });
});

describe('live analysis', () => {
  it('reports deeper results as they come, at full strength, until the end', async () => {
    // White mates in one with Qxf7#.
    const fen = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
    const updates: Analysis[] = [];
    await new Promise<void>((resolve) => {
      analyse(
        fen,
        (a) => {
          updates.push(a);
          if (a.done) resolve();
        },
        20,
      );
    });
    const last = updates[updates.length - 1];
    expect(ANALYSIS_DEPTH).toBe(30);
    expect(last.depth).toBe(20);
    expect(last.lines[0].san).toBe('Qxf7#');
    expect(last.score.mate).toBe(1);
  });

  it('needs no engine once the game is over', async () => {
    const mated = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
    const a = await new Promise<Analysis>((resolve) => analyse(mated, resolve));
    expect(a).toMatchObject({ done: true, lines: [] });
  });
});

describe('kept lines on two devices', () => {
  const kept = (id: string, updatedAt: number, moves: string[] = ['e4']): PracticeLine => ({ id, fromPly: 3, moves, createdAt: 1, updatedAt });

  it('keeps every line, each in its latest version, and says when this browser has news', () => {
    const merged = mergePractice([kept('a', 5, ['Nf3']), kept('b', 1)], [kept('a', 3), kept('c', 2)]);
    expect(merged.lines.map((l) => l.id).sort()).toEqual(['a', 'b', 'c']);
    expect(merged.lines.find((l) => l.id === 'a')!.moves).toEqual(['Nf3']);
    expect(merged.ahead).toBe(true);
    expect(mergePractice([kept('a', 3)], [kept('a', 3), kept('c', 2)]).ahead).toBe(false);
  });

  it('carries a removal over', () => {
    const removed = { ...kept('a', 9), moves: [], deleted: true };
    expect(mergePractice([kept('a', 3)], [removed]).lines[0].deleted).toBe(true);
  });
});
