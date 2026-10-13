import { detectEnding } from './ending';
import { parsePgn, parseTimeControl, playedAtFromHeaders, splitPgn, timeClassOf, PgnError } from './pgn';
import type { Color, GameRecord, ParsedGame, PlayerInfo, Result, TimeClass } from './types';

export type Platform = 'chesscom' | 'lichess';

/** An import problem with a message that can be shown as is. */
export class ImportError extends Error {}

function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function rating(value: string | number | undefined): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

interface Extras {
  id: string;
  source: GameRecord['source'];
  account?: string;
  url?: string;
  white?: PlayerInfo;
  black?: PlayerInfo;
  result?: Result;
  playedAt?: number;
  timeControl?: { base: number; inc: number };
  timeClass?: TimeClass;
  me?: Color;
  /** Lichess's game status ("resign", "outoftime", "timeout"...), which says how it ended. */
  status?: string;
}

function toRecord(pgn: string, parsed: ParsedGame, extras: Extras): GameRecord {
  const h = parsed.headers;
  const now = Date.now();
  const result = extras.result ?? parsed.result;
  return {
    id: extras.id,
    source: extras.source,
    account: extras.account,
    url: extras.url,
    pgn,
    white: extras.white ?? { name: h.White && h.White !== '?' ? h.White : 'White', rating: rating(h.WhiteElo) },
    black: extras.black ?? { name: h.Black && h.Black !== '?' ? h.Black : 'Black', rating: rating(h.BlackElo) },
    result,
    ending: detectEnding(parsed, result, extras.status) ?? null,
    playedAt: extras.playedAt ?? playedAtFromHeaders(h) ?? now,
    timeControl: extras.timeControl ?? parseTimeControl(h.TimeControl),
    timeClass: extras.timeClass ?? timeClassOf(h.TimeControl),
    me: extras.me,
    plies: parsed.moves.length,
    addedAt: now,
  };
}

/** Builds game records from pasted PGN text. Games that cannot be read are reported, not thrown. */
export function recordsFromPgn(text: string, source: GameRecord['source'] = 'pgn'): { records: GameRecord[]; errors: string[] } {
  const records: GameRecord[] = [];
  const errors: string[] = [];
  const parts = splitPgn(text);
  parts.forEach((pgn, i) => {
    try {
      const parsed = parsePgn(pgn);
      const h = parsed.headers;
      const moves = parsed.moves.map((m) => m.san).join(' ');
      const link = [h.Link, h.Site, h.GameId].find((v) => v && /^https?:\/\//.test(v));
      records.push(
        toRecord(pgn, parsed, {
          id: `${source}:${hash(`${h.White}|${h.Black}|${h.Date}|${moves}`)}`,
          source,
          url: link,
        }),
      );
    } catch (e) {
      const label = parts.length > 1 ? `Game ${i + 1}: ` : '';
      errors.push(label + (e instanceof PgnError ? e.message : 'This game could not be read.'));
    }
  });
  return { records, errors };
}

async function getJson(url: string, platformName: string, username: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new ImportError(`Could not reach ${platformName}. Check your connection and try again.`);
  }
  if (response.status === 404) throw new ImportError(`No ${platformName} player is called "${username}". Check the spelling.`);
  if (response.status === 429) throw new ImportError(`${platformName} is limiting requests right now. Wait a minute and try again.`);
  if (!response.ok) throw new ImportError(`${platformName} answered with an error (${response.status}). Try again in a moment.`);
  return response;
}

interface ChessComPlayer {
  username: string;
  rating?: number;
  result?: string;
}
interface ChessComGame {
  url?: string;
  uuid?: string;
  pgn?: string;
  time_control?: string;
  time_class?: string;
  end_time?: number;
  rules?: string;
  white: ChessComPlayer;
  black: ChessComPlayer;
}

/** Converts games from chess.com's public API into records. Exported for tests. */
export function recordsFromChessCom(games: ChessComGame[], username: string): GameRecord[] {
  const lower = username.toLowerCase();
  const out: GameRecord[] = [];
  for (const g of games) {
    if (!g.pgn || (g.rules && g.rules !== 'chess')) continue;
    try {
      const parsed = parsePgn(g.pgn);
      const timeClass = (['bullet', 'blitz', 'rapid', 'daily'] as const).find((c) => c === g.time_class);
      out.push(
        toRecord(g.pgn, parsed, {
          id: `chesscom:${g.uuid ?? g.url ?? hash(g.pgn)}`,
          source: 'chesscom',
          account: `chesscom:${lower}`,
          url: g.url,
          white: { name: g.white.username, rating: rating(g.white.rating) },
          black: { name: g.black.username, rating: rating(g.black.rating) },
          playedAt: g.end_time ? g.end_time * 1000 : undefined,
          timeControl: parseTimeControl(g.time_control),
          timeClass: timeClass ?? timeClassOf(g.time_control),
          me: g.white.username.toLowerCase() === lower ? 'w' : g.black.username.toLowerCase() === lower ? 'b' : undefined,
        }),
      );
    } catch {
      // A game in a variant or with a damaged PGN is skipped.
    }
  }
  return out;
}

/** Fetches a player's most recent standard games from chess.com's public API. */
export async function importChessCom(username: string, limit: number): Promise<GameRecord[]> {
  const name = username.trim();
  const base = `https://api.chess.com/pub/player/${encodeURIComponent(name.toLowerCase())}`;
  const archivesResponse = await getJson(`${base}/games/archives`, 'chess.com', name);
  const { archives = [] } = (await archivesResponse.json()) as { archives?: string[] };
  const records: GameRecord[] = [];
  // Newest month first; stop once there are enough games. At most a year back.
  for (const url of archives.slice(-12).reverse()) {
    const response = await getJson(url, 'chess.com', name);
    const { games = [] } = (await response.json()) as { games?: ChessComGame[] };
    records.push(...recordsFromChessCom(games, name));
    if (records.length >= limit) break;
  }
  return records.sort((a, b) => b.playedAt - a.playedAt).slice(0, limit);
}

interface LichessPlayer {
  user?: { name: string };
  rating?: number;
  aiLevel?: number;
}
interface LichessGame {
  id: string;
  variant?: string;
  speed?: string;
  createdAt?: number;
  status?: string;
  winner?: 'white' | 'black';
  players: { white: LichessPlayer; black: LichessPlayer };
  pgn?: string;
  clock?: { initial: number; increment: number };
}

const LICHESS_SPEED: Record<string, TimeClass> = {
  ultraBullet: 'bullet',
  bullet: 'bullet',
  blitz: 'blitz',
  rapid: 'rapid',
  classical: 'classical',
  correspondence: 'daily',
};

/** Converts games from the Lichess API into records. Exported for tests. */
export function recordsFromLichess(games: LichessGame[], username: string): GameRecord[] {
  const lower = username.toLowerCase();
  const out: GameRecord[] = [];
  const player = (p: LichessPlayer): PlayerInfo => ({
    name: p.user?.name ?? (p.aiLevel ? `Stockfish level ${p.aiLevel}` : 'Anonymous'),
    rating: rating(p.rating),
  });
  for (const g of games) {
    if (!g.pgn || (g.variant && g.variant !== 'standard')) continue;
    try {
      const parsed = parsePgn(g.pgn);
      const white = player(g.players.white);
      const black = player(g.players.black);
      const result: Result | undefined =
        g.winner === 'white' ? '1-0' : g.winner === 'black' ? '0-1' : g.status === 'draw' || g.status === 'stalemate' ? '1/2-1/2' : undefined;
      out.push(
        toRecord(g.pgn, parsed, {
          id: `lichess:${g.id}`,
          source: 'lichess',
          account: `lichess:${lower}`,
          url: `https://lichess.org/${g.id}`,
          white,
          black,
          result,
          playedAt: g.createdAt,
          timeControl: g.clock ? { base: g.clock.initial, inc: g.clock.increment } : undefined,
          timeClass: (g.speed && LICHESS_SPEED[g.speed]) || 'unknown',
          me: white.name.toLowerCase() === lower ? 'w' : black.name.toLowerCase() === lower ? 'b' : undefined,
          status: g.status,
        }),
      );
    } catch {
      // Skipped: not a standard game we can read.
    }
  }
  return out;
}

/** Fetches a player's most recent standard games from the Lichess API. */
export async function importLichess(username: string, limit: number): Promise<GameRecord[]> {
  const name = username.trim();
  const url =
    `https://lichess.org/api/games/user/${encodeURIComponent(name)}` +
    `?max=${limit}&clocks=true&pgnInJson=true&perfType=ultraBullet,bullet,blitz,rapid,classical,correspondence`;
  const response = await getJson(url, 'Lichess', name, { headers: { Accept: 'application/x-ndjson' } });
  const text = await response.text();
  const games: LichessGame[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      games.push(JSON.parse(line) as LichessGame);
    } catch {
      // Ignore a truncated last line.
    }
  }
  return recordsFromLichess(games, name).slice(0, limit);
}

/**
 * Turns one game the server fetched, stored as chess.com or Lichess sent it, into a record,
 * with the same rules as an import from this browser. Null when it is not a game the app reads.
 */
export function recordFromRaw(source: string, account: string | null, raw: unknown): GameRecord | null {
  const username = account?.split(':')[1];
  if (!username || !raw || typeof raw !== 'object') return null;
  if (source === 'chesscom') return recordsFromChessCom([raw as ChessComGame], username)[0] ?? null;
  if (source === 'lichess') return recordsFromLichess([raw as LichessGame], username)[0] ?? null;
  return null;
}

/**
 * Reads what was typed into the username box. A pasted profile address such as
 * "https://www.chess.com/member/name" or "lichess.org/@/name" gives the name and the site.
 */
export function readAccount(input: string, fallback: Platform): { platform: Platform; username: string } {
  const text = input.trim();
  const chesscom = /chess\.com\/(?:member|players|stats\/[a-z]+\/[a-z]+)\/([A-Za-z0-9_-]+)/i.exec(text);
  if (chesscom) return { platform: 'chesscom', username: chesscom[1] };
  const lichess = /lichess\.org\/@\/([A-Za-z0-9_-]+)/i.exec(text);
  if (lichess) return { platform: 'lichess', username: lichess[1] };
  return { platform: fallback, username: text.replace(/^@/, '') };
}

export function importAccount(platform: Platform, username: string, limit: number): Promise<GameRecord[]> {
  if (!/^[A-Za-z0-9_-]{2,30}$/.test(username.trim())) {
    return Promise.reject(new ImportError('Enter the username exactly as it appears in the profile address, without spaces.'));
  }
  return platform === 'chesscom' ? importChessCom(username, limit) : importLichess(username, limit);
}
