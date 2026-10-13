import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePgn, parseTimeControl, PgnError, splitPgn, timeClassOf } from '../src/lib/pgn';

const opera = readFileSync('tests/games/opera.pgn', 'utf8');

describe('PGN parsing', () => {
  it('reads moves, positions and the result', () => {
    const game = parsePgn(opera);
    expect(game.moves).toHaveLength(33);
    expect(game.result).toBe('1-0');
    expect(game.moves[0]).toMatchObject({ ply: 1, color: 'w', san: 'e4', uci: 'e2e4' });
    expect(game.moves[32].san).toBe('Rd8#');
    expect(game.moves[22].uci).toBe('e1c1');
  });

  it('reads chess.com clocks', () => {
    const pgn = '[Event "Live Chess"]\n[TimeControl "600"]\n\n1. e4 {[%clk 0:09:58.3]} 1... e5 {[%clk 0:09:57]} 2. Nf3 {[%clk 0:09:50.1]} 1-0';
    const game = parsePgn(pgn);
    expect(game.moves.map((m) => m.clock)).toEqual([598.3, 597, 590.1]);
  });

  it('reads Lichess clocks next to evaluations', () => {
    const pgn = '1. d4 { [%eval 0.2] [%clk 0:05:00] } 1... d5 { [%clk 1:00:03] } *';
    const game = parsePgn(pgn);
    expect(game.moves[0].clock).toBe(300);
    expect(game.moves[1].clock).toBe(3603);
  });

  it('works out the result when the header is missing', () => {
    expect(parsePgn('1. f3 e5 2. g4 Qh4#').result).toBe('0-1');
  });

  it('rejects text that is not a game, with a message to show', () => {
    expect(() => parsePgn('hello there')).toThrow(PgnError);
    expect(() => parsePgn('[Event "x"]\n\n*')).toThrow(/no moves/);
  });

  it('rejects variants', () => {
    expect(() => parsePgn('[Variant "Chess960"]\n\n1. e4 e5 *')).toThrow(/standard chess/);
  });

  it('splits a file of several games', () => {
    const fixtures = readFileSync('tests/games/fixtures.pgn', 'utf8');
    expect(splitPgn(fixtures)).toHaveLength(8);
    expect(splitPgn(opera)).toHaveLength(1);
    expect(splitPgn('   ')).toHaveLength(0);
  });
});

describe('time controls', () => {
  it('parses the common formats', () => {
    expect(parseTimeControl('600')).toEqual({ base: 600, inc: 0 });
    expect(parseTimeControl('180+2')).toEqual({ base: 180, inc: 2 });
    expect(parseTimeControl('1/86400')).toEqual({ base: 86400, inc: 0 });
    expect(parseTimeControl('-')).toBeUndefined();
  });
  it('names the speed', () => {
    expect(timeClassOf('60')).toBe('bullet');
    expect(timeClassOf('180+2')).toBe('blitz');
    expect(timeClassOf('600')).toBe('rapid');
    expect(timeClassOf('1/86400')).toBe('daily');
    expect(timeClassOf(undefined)).toBe('unknown');
  });
});

describe('games set up from a position', () => {
  it('number their moves as in that position, Black first when Black is to move', () => {
    // After 1. e4 e5 2. Nf3 Nc6 3. Bc4: Black to move on move 3.
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3';
    const game = parsePgn(`[SetUp "1"]\n[FEN "${fen}"]\n\n3... Nf6 4. Ng5 d5 *`);
    expect(game.startFen).toBe(fen);
    expect(game.moves.map((m) => m.ply)).toEqual([6, 7, 8]);
    expect(game.moves.map((m) => m.color)).toEqual(['b', 'w', 'b']);
  });
});
