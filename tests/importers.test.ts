import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { recordsFromChessCom, recordsFromLichess, recordsFromPgn } from '../src/lib/importers';

const pgn = (white: string, black: string) =>
  `[Event "Live Chess"]\n[White "${white}"]\n[Black "${black}"]\n[Result "0-1"]\n[TimeControl "600"]\n\n1. f3 {[%clk 0:09:58]} 1... e5 {[%clk 0:09:57]} 2. g4 {[%clk 0:09:50]} 2... Qh4# {[%clk 0:09:55]} 0-1`;

describe('chess.com import', () => {
  // Shape documented at https://www.chess.com/news/view/published-data-api
  const games = [
    {
      url: 'https://www.chess.com/game/live/1',
      uuid: 'abc-1',
      pgn: pgn('Harshavardhan2805', 'someone'),
      time_control: '600',
      time_class: 'rapid',
      end_time: 1760000000,
      rules: 'chess',
      white: { username: 'Harshavardhan2805', rating: 1210, result: 'checkmated' },
      black: { username: 'someone', rating: 1250, result: 'win' },
    },
    { url: 'x', uuid: 'abc-2', pgn: pgn('a', 'b'), rules: 'chess960', white: { username: 'a' }, black: { username: 'b' } },
    { url: 'y', uuid: 'abc-3', rules: 'chess', white: { username: 'a' }, black: { username: 'b' } },
  ];

  it('builds a record and marks which side the player had, whatever the capitalisation', () => {
    const records = recordsFromChessCom(games, 'harshavardhan2805');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: 'chesscom:abc-1',
      account: 'chesscom:harshavardhan2805',
      me: 'w',
      result: '0-1',
      timeClass: 'rapid',
      timeControl: { base: 600, inc: 0 },
      playedAt: 1760000000000,
      plies: 4,
      white: { name: 'Harshavardhan2805', rating: 1210 },
    });
  });
});

describe('Lichess import', () => {
  const games = [
    {
      id: 'q7ZvsdUF',
      variant: 'standard',
      speed: 'blitz',
      createdAt: 1514505150384,
      status: 'mate',
      winner: 'black' as const,
      players: { white: { user: { name: 'Lance5500' }, rating: 2389 }, black: { user: { name: 'TryingHard87' }, rating: 2498 } },
      pgn: '1. f3 { [%clk 0:05:00] } 1... e5 { [%clk 0:05:00] } 2. g4 { [%clk 0:04:58] } 2... Qh4# { [%clk 0:04:59] } 0-1',
      clock: { initial: 300, increment: 3 },
    },
    { id: 'v', variant: 'atomic', players: { white: {}, black: {} }, pgn: '1. e4 *' },
    { id: 'ai', variant: 'standard', speed: 'rapid', players: { white: { aiLevel: 3 }, black: { user: { name: 'TryingHard87' } } }, pgn: '1. e4 e5 *' },
  ];

  it('builds records, skips variants and names computer opponents', () => {
    const records = recordsFromLichess(games, 'tryinghard87');
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      id: 'lichess:q7ZvsdUF',
      url: 'https://lichess.org/q7ZvsdUF',
      me: 'b',
      result: '0-1',
      timeClass: 'blitz',
      timeControl: { base: 300, inc: 3 },
    });
    expect(records[1].white.name).toBe('Stockfish level 3');
    expect(records[1].result).toBe('*');
  });
});

describe('pasted PGN', () => {
  it('imports several games and gives the same game the same id', () => {
    const text = readFileSync('tests/games/fixtures.pgn', 'utf8');
    const first = recordsFromPgn(text);
    const second = recordsFromPgn(text);
    expect(first.errors).toEqual([]);
    expect(first.records).toHaveLength(8);
    expect(new Set(first.records.map((r) => r.id)).size).toBe(8);
    expect(first.records.map((r) => r.id)).toEqual(second.records.map((r) => r.id));
    expect(first.records[0].url).toMatch(/^https:\/\/www\.chess\.com/);
    expect(first.records[0].timeControl).toEqual({ base: 180, inc: 0 });
  });

  it('reports a bad game without losing the good ones', () => {
    const { records, errors } = recordsFromPgn(`${pgn('a', 'b')}\n\n[Event "Broken"]\n\n1. e4 Ke7 2. Zz9 *`);
    expect(records).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^Game 2: /);
  });
});

describe('username box', () => {
  it('takes a plain username for the chosen site', async () => {
    const { readAccount } = await import('../src/lib/importers');
    expect(readAccount('  Harshavardhan2805 ', 'chesscom')).toEqual({ platform: 'chesscom', username: 'Harshavardhan2805' });
    expect(readAccount('@someone', 'lichess')).toEqual({ platform: 'lichess', username: 'someone' });
  });
  it('takes a pasted profile address and picks the site', async () => {
    const { readAccount } = await import('../src/lib/importers');
    expect(readAccount('https://www.chess.com/member/Harshavardhan2805', 'lichess')).toEqual({ platform: 'chesscom', username: 'Harshavardhan2805' });
    expect(readAccount('lichess.org/@/DrNykterstein?foo=1', 'chesscom')).toEqual({ platform: 'lichess', username: 'DrNykterstein' });
  });
});
