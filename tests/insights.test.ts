import { describe, expect, it } from 'vitest';
import { resolvePlayer } from '../src/lib/insights';
import type { GameRecord } from '../src/lib/types';

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
