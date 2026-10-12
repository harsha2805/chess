import { colorOf } from '../lib/insights';
import type { Color, GameRecord } from '../lib/types';

/** Folds case and accents for searching, so "grunfeld" finds "Grünfeld". */
export const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, "'");

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

/** The PGN tag value, or undefined when it is missing or unknown ("?"). */
function pgnTag(game: GameRecord, tag: string): string | undefined {
  const m = game.pgn.match(new RegExp(String.raw`\[${tag} "([^"]*)"\]`));
  const value = m?.[1].trim();
  return value && !/^\?+$/.test(value) ? value : undefined;
}

/**
 * When the game was played. A PGN date with only the year known (old games often have
 * "1858.??.??") shows the year alone, rather than the day the game was added.
 */
export function gameDateLabel(game: GameRecord): string {
  const date = pgnTag(game, 'Date');
  const m = date?.match(/^(\d{4})\.(\d{2}|\?\?)\.(\d{2}|\?\?)$/);
  if (m && (m[2] === '??' || m[3] === '??')) return m[1];
  return dateLabel(game.playedAt);
}

/** Where the game was played, for games pasted from a PGN. Online games name the site in their link instead. */
export function gameSite(game: GameRecord): string | undefined {
  if (game.source !== 'pgn' && game.source !== 'sample') return undefined;
  const site = pgnTag(game, 'Site');
  return site && !/^https?:|chess\.com|lichess/i.test(site) ? site : undefined;
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
