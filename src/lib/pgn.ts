import { Chess, DEFAULT_POSITION } from 'chess.js';
import type { ParsedGame, ParsedMove, PieceType, Result, TimeClass } from './types';

const RESULTS: Result[] = ['1-0', '0-1', '1/2-1/2', '*'];

/** Splits a text containing one or more PGN games. */
export function splitPgn(text: string): string[] {
  const clean = text.replace(/\r\n?/g, '\n').trim();
  if (!clean) return [];
  const parts = clean.split(/\n\s*\n(?=\[Event\s)/);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function parseClock(comment: string | undefined): number | undefined {
  if (!comment) return undefined;
  const m = /\[%clk\s+(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)\]/.exec(comment);
  if (!m) return undefined;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

export class PgnError extends Error {}

/** Parses one PGN game into positions and moves. Throws PgnError with a message fit to show. */
export function parsePgn(pgn: string): ParsedGame {
  const chess = new Chess();
  try {
    chess.loadPgn(pgn.trim());
  } catch {
    throw new PgnError('This PGN could not be read. Check that it is one complete game in standard notation.');
  }
  const headers = chess.getHeaders();
  const variant = headers.Variant;
  if (variant && !/^(standard|from position)$/i.test(variant)) {
    throw new PgnError(`Only standard chess can be reviewed. This game is ${variant}.`);
  }
  const history = chess.history({ verbose: true });
  if (history.length === 0) {
    throw new PgnError('This PGN has no moves to review.');
  }
  const comments = new Map<string, string>();
  for (const c of chess.getComments()) comments.set(c.fen, c.comment);

  // A game set up from a position starts part-way: its first move is numbered as in that position.
  const first = history[0]?.before.split(' ') ?? ['', 'w', '', '', '0', '1'];
  const offset = (Math.max(1, Number(first[5]) || 1) - 1) * 2 + (first[1] === 'b' ? 1 : 0);
  const moves: ParsedMove[] = history.map((m, i) => ({
    ply: offset + i + 1,
    color: m.color,
    san: m.san,
    uci: m.lan,
    from: m.from,
    to: m.to,
    piece: m.piece as PieceType,
    captured: m.captured as PieceType | undefined,
    promotion: m.promotion as PieceType | undefined,
    fenBefore: m.before,
    fenAfter: m.after,
    clock: parseClock(comments.get(m.after)),
  }));

  const headerResult = headers.Result as Result | undefined;
  let result: Result = headerResult && RESULTS.includes(headerResult) ? headerResult : '*';
  if (result === '*') {
    const end = new Chess(moves[moves.length - 1].fenAfter);
    if (end.isCheckmate()) result = end.turn() === 'w' ? '0-1' : '1-0';
    else if (end.isStalemate() || end.isInsufficientMaterial()) result = '1/2-1/2';
  }

  return {
    headers,
    startFen: history[0]?.before ?? DEFAULT_POSITION,
    moves,
    result,
  };
}

export function isStandardStart(game: ParsedGame): boolean {
  return game.startFen === DEFAULT_POSITION;
}

/** Parses a PGN TimeControl header such as "600", "180+2" or "1/86400". */
export function parseTimeControl(tc: string | undefined): { base: number; inc: number } | undefined {
  if (!tc || tc === '-' || tc === '?') return undefined;
  if (tc.includes('/')) {
    const perMove = Number(tc.split('/')[1]);
    return Number.isFinite(perMove) ? { base: perMove, inc: 0 } : undefined;
  }
  const [base, inc] = tc.split('+').map(Number);
  if (!Number.isFinite(base)) return undefined;
  return { base, inc: Number.isFinite(inc) ? inc : 0 };
}

export function timeClassOf(tc: string | undefined): TimeClass {
  if (!tc) return 'unknown';
  if (tc.includes('/')) return 'daily';
  const parsed = parseTimeControl(tc);
  if (!parsed) return 'unknown';
  const estimate = parsed.base + 40 * parsed.inc;
  if (estimate < 180) return 'bullet';
  if (estimate < 600) return 'blitz';
  if (estimate < 3600) return 'rapid';
  return 'classical';
}

/** Milliseconds since the epoch from PGN date headers, or undefined when unknown. */
export function playedAtFromHeaders(headers: Record<string, string>): number | undefined {
  const date = headers.UTCDate || headers.Date;
  if (!date || /\?/.test(date)) return undefined;
  const [y, mo, d] = date.split('.').map(Number);
  const time = headers.UTCTime || headers.StartTime || '00:00:00';
  const [h, mi, s] = time.split(':').map(Number);
  const ms = Date.UTC(y, (mo || 1) - 1, d || 1, h || 0, mi || 0, s || 0);
  return Number.isFinite(ms) ? ms : undefined;
}
