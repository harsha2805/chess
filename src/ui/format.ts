import { colorOf } from '../lib/insights';
import type { Color, GameRecord } from '../lib/types';

export function timeLabel(game: GameRecord): string {
  const tc = game.timeControl;
  if (game.timeClass === 'daily') return 'Daily';
  if (!tc) return game.timeClass === 'unknown' ? '' : game.timeClass[0].toUpperCase() + game.timeClass.slice(1);
  const base = tc.base % 60 === 0 ? `${tc.base / 60}` : (tc.base / 60).toFixed(1);
  return tc.inc ? `${base}+${tc.inc}` : `${base} min`;
}

export function dateLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function resultText(game: GameRecord): string {
  if (game.result === '1-0') return 'White won';
  if (game.result === '0-1') return 'Black won';
  if (game.result === '1/2-1/2') return 'Draw';
  return 'Unfinished';
}

export const resultMark = (result: GameRecord['result']) => (result === '1/2-1/2' ? '½–½' : result.replace('-', '–'));

/** Which side the reviewer played, from the import or from the chosen player name. */
export function perspective(game: GameRecord, player: string): Color | null {
  return game.me ?? (player ? colorOf(game, player) : null);
}
