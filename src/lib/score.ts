import type { Color, Score } from './types';

/**
 * Winning chances for White, 0 to 100, from a centipawn score.
 * Logistic curve fitted on real games (the model Lichess publishes for its accuracy metric).
 */
export function winFromCp(cp: number): number {
  const clamped = Math.max(-2000, Math.min(2000, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * clamped)) - 1);
}

/** White's winning chances, 0 to 100. */
export function whiteWin(score: Score): number {
  if (score.mate !== undefined) {
    if (score.mate > 0) return 100;
    if (score.mate < 0) return 0;
    return (score.cp ?? 0) >= 0 ? 100 : 0;
  }
  return winFromCp(score.cp ?? 0);
}

export function winFor(score: Score, color: Color): number {
  const w = whiteWin(score);
  return color === 'w' ? w : 100 - w;
}

/** Accuracy of a single move, 0 to 100, from the winning chances it gave up. */
export function moveAccuracy(loss: number): number {
  if (loss <= 0) return 100;
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * loss) - 3.166924740191411 + 1;
  return Math.max(0, Math.min(100, raw));
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function stdDev(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

function harmonicMean(xs: number[]): number {
  if (!xs.length) return 0;
  const sum = xs.reduce((a, x) => a + 1 / Math.max(x, 0.01), 0);
  return xs.length / sum;
}

/**
 * Game accuracy per side. Moves played in sharp phases (where winning chances swing)
 * weigh more, and the result is averaged with the harmonic mean so that a few very bad
 * moves cost more than many small ones.
 *
 * @param whiteWins White's winning chances for every position, starting position included.
 * @param accuracies Accuracy of each move, in game order (White moves first when `firstMover` is 'w').
 */
export function gameAccuracy(
  whiteWins: number[],
  accuracies: number[],
  firstMover: Color,
): { w: number; b: number } {
  const n = accuracies.length;
  if (n === 0) return { w: 0, b: 0 };
  const size = Math.min(whiteWins.length, Math.max(2, Math.min(8, Math.floor(n / 10))));
  const weights: number[] = [];
  for (let i = 0; i < n; i++) {
    // The window ends on the position this move produced.
    const start = Math.max(0, i + 2 - size);
    const window = whiteWins.slice(start, start + size);
    weights.push(Math.max(0.5, Math.min(12, stdDev(window))));
  }

  const side = (color: Color) => {
    const acc: number[] = [];
    const wts: number[] = [];
    for (let i = 0; i < n; i++) {
      const mover: Color = (i % 2 === 0) === (firstMover === 'w') ? 'w' : 'b';
      if (mover !== color) continue;
      acc.push(accuracies[i]);
      wts.push(weights[i]);
    }
    if (!acc.length) return 0;
    const totalWeight = wts.reduce((a, b) => a + b, 0);
    const weighted = acc.reduce((a, x, i) => a + x * wts[i], 0) / totalWeight;
    return (weighted + harmonicMean(acc)) / 2;
  };

  return { w: side('w'), b: side('b') };
}

/** "+1.3", "−0.4", "M3", "−M2", "#". */
export function formatScore(score: Score): string {
  if (score.mate !== undefined) {
    if (score.mate === 0) return '#';
    return `${score.mate < 0 ? '−' : ''}M${Math.abs(score.mate)}`;
  }
  const pawns = (score.cp ?? 0) / 100;
  if (Math.abs(pawns) < 0.05) return '0.0';
  return `${pawns > 0 ? '+' : '−'}${Math.abs(pawns).toFixed(1)}`;
}

/** Converts an engine score (side to move's point of view) to White's point of view. */
export function toWhite(raw: { cp?: number; mate?: number }, turn: Color): Score {
  const sign = turn === 'w' ? 1 : -1;
  if (raw.mate !== undefined) return { mate: raw.mate * sign };
  return { cp: (raw.cp ?? 0) * sign };
}

/**
 * A number that orders scores from `color`'s point of view: higher is better.
 * Mates rank beyond any centipawn score, and a quicker mate ranks beyond a slower one.
 */
export function rank(score: Score, color: Color): number {
  let white: number;
  if (score.mate !== undefined) {
    if (score.mate > 0) white = 1_000_000 - score.mate;
    else if (score.mate < 0) white = -1_000_000 - score.mate;
    else white = (score.cp ?? 0) >= 0 ? 1_000_000 : -1_000_000;
  } else {
    white = score.cp ?? 0;
  }
  return color === 'w' ? white : -white;
}
