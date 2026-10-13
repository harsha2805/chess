import { recordFromRaw } from './importers';
import { betterReview, compareReviews, type GameRecord, type GameReview } from './types';

/** A game as the server sends it when changes are pulled. `record`, `raw` and `review` are JSON text. */
export interface RemoteGame {
  id: string;
  source: GameRecord['source'];
  account: string | null;
  playedAt: number;
  addedAt: number;
  deleted: boolean;
  updatedAt: number;
  /** This browser made the last change, so the contents were left out. */
  same?: boolean;
  /** Sent by a browser. */
  record?: string | null;
  /** Fetched by the server from chess.com or Lichess, as they sent it. */
  raw?: string | null;
  review?: string | null;
}

/** A game as a browser sends it to the server. */
export interface PushGame {
  id: string;
  source: GameRecord['source'];
  account: string | null;
  playedAt: number;
  addedAt: number;
  record: string;
  review: string | null;
  reviewAt: number | null;
}

export function toPush(game: GameRecord): PushGame {
  const { review, ...record } = game;
  return {
    id: game.id,
    source: game.source,
    account: game.account ?? null,
    playedAt: Math.max(0, Math.round(game.playedAt)),
    addedAt: Math.max(0, Math.round(game.addedAt)),
    record: JSON.stringify(record),
    review: review ? JSON.stringify(review) : null,
    reviewAt: review ? Math.round(review.analyzedAt) : null,
  };
}

/** What to do with one pulled game. */
export type Merge =
  /** Nothing to change here. */
  | { kind: 'skip' }
  /** The game was removed on the account. */
  | { kind: 'delete' }
  /** The server left the contents out, but this browser no longer has the game: ask for it in full. */
  | { kind: 'missing' }
  /** Store this record. With `pushBack`, this browser's review is newer and goes back to the server. */
  | { kind: 'put'; record: GameRecord; pushBack: boolean };

function parse<T>(text: string | null | undefined): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Combines a pulled game with this browser's copy, if it has one. */
export function mergeRemote(row: RemoteGame, local: GameRecord | undefined): Merge {
  if (row.deleted) return local ? { kind: 'delete' } : { kind: 'skip' };
  if (row.same) return local ? { kind: 'skip' } : { kind: 'missing' };

  const base = row.record ? parse<GameRecord>(row.record) : recordFromRaw(row.source, row.account, parse<unknown>(row.raw));
  if (!base) return { kind: 'skip' };
  const remoteReview = parse<GameReview>(row.review);
  // The stronger review wins wherever it was made; on a tie, this browser keeps its own.
  const review = betterReview(local?.review, remoteReview);
  const record: GameRecord = { ...base, id: row.id, addedAt: row.addedAt || base.addedAt };
  if (review) record.review = review;
  else delete record.review;
  const pushBack = !!local?.review && review === local.review && (!remoteReview || compareReviews(local.review, remoteReview) > 0);
  return { kind: 'put', record, pushBack };
}
