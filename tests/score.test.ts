import { describe, expect, it } from 'vitest';
import { formatScore, gameAccuracy, moveAccuracy, rank, toWhite, whiteWin, winFor, winFromCp } from '../src/lib/score';

describe('winning chances', () => {
  it('is 50% in an equal position and symmetric', () => {
    expect(winFromCp(0)).toBeCloseTo(50, 5);
    expect(winFromCp(150) + winFromCp(-150)).toBeCloseTo(100, 5);
  });
  it('rises with the score and stays inside 0 to 100', () => {
    const values = [-3000, -500, -100, 0, 100, 500, 3000].map(winFromCp);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThan(values[i - 1] - 1e-9);
    expect(values[0]).toBeGreaterThanOrEqual(0);
    expect(values[values.length - 1]).toBeLessThanOrEqual(100);
  });
  it('treats mates as certain', () => {
    expect(whiteWin({ mate: 3 })).toBe(100);
    expect(whiteWin({ mate: -1 })).toBe(0);
    expect(whiteWin({ mate: 0, cp: -100000 })).toBe(0);
    expect(winFor({ mate: -2 }, 'b')).toBe(100);
  });
});

describe('accuracy', () => {
  it('is 100 for no loss and falls as more is given away', () => {
    expect(moveAccuracy(0)).toBe(100);
    expect(moveAccuracy(5)).toBeGreaterThan(moveAccuracy(20));
    expect(moveAccuracy(100)).toBeGreaterThanOrEqual(0);
  });
  it('gives a perfect game 100 for both sides', () => {
    const wins = [50, 50, 50, 50, 50, 50, 50];
    const acc = gameAccuracy(wins, [100, 100, 100, 100, 100, 100], 'w');
    expect(acc.w).toBeCloseTo(100, 5);
    expect(acc.b).toBeCloseTo(100, 5);
  });
  it('charges an error to the side that made it', () => {
    const wins = [50, 50, 50, 50, 90, 90, 90];
    // Black's second move (index 3) threw the game away.
    const acc = gameAccuracy(wins, [100, 100, 100, moveAccuracy(40), 100, 100], 'w');
    expect(acc.w).toBeCloseTo(100, 5);
    expect(acc.b).toBeLessThan(80);
  });
});

describe('scores', () => {
  it('formats pawns and mates', () => {
    expect(formatScore({ cp: 134 })).toBe('+1.3');
    expect(formatScore({ cp: -40 })).toBe('−0.4');
    expect(formatScore({ cp: 2 })).toBe('0.0');
    expect(formatScore({ mate: 3 })).toBe('M3');
    expect(formatScore({ mate: -2 })).toBe('−M2');
    expect(formatScore({ mate: 0, cp: 100000 })).toBe('#');
  });
  it('converts engine scores to the white point of view', () => {
    expect(toWhite({ cp: 30 }, 'b')).toEqual({ cp: -30 });
    expect(toWhite({ mate: 2 }, 'b')).toEqual({ mate: -2 });
    expect(toWhite({ cp: 30 }, 'w')).toEqual({ cp: 30 });
  });
  it('ranks a quicker mate above a slower one and any mate above material', () => {
    expect(rank({ mate: 1 }, 'w')).toBeGreaterThan(rank({ mate: 4 }, 'w'));
    expect(rank({ mate: 4 }, 'w')).toBeGreaterThan(rank({ cp: 2500 }, 'w'));
    expect(rank({ mate: -1 }, 'b')).toBeGreaterThan(rank({ mate: -4 }, 'b'));
    expect(rank({ mate: -5 }, 'w')).toBeGreaterThan(rank({ mate: -1 }, 'w'));
    expect(rank({ cp: -50 }, 'b')).toBeGreaterThan(rank({ cp: 50 }, 'b'));
  });
});
