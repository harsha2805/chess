import { describe, expect, it } from 'vitest';
import { recordsFromPgn } from '../src/lib/importers';
import { mergeRemote, toPush, type RemoteGame } from '../src/lib/remote';
import { REVIEW_VERSION, type GameRecord, type GameReview } from '../src/lib/types';

const pgn = `[Event "Live Chess"]\n[White "me"]\n[Black "them"]\n[Result "0-1"]\n[TimeControl "600"]\n\n1. f3 {[%clk 0:09:58]} 1... e5 {[%clk 0:09:57]} 2. g4 {[%clk 0:09:50]} 2... Qh4# {[%clk 0:09:55]} 0-1`;

const review = (analyzedAt: number): GameReview => ({
  version: REVIEW_VERSION,
  engine: 'test',
  depth: 12,
  analyzedAt,
  startEval: { cp: 20 },
  moves: [],
  accuracy: { w: 50, b: 90 },
});

const local = (extra: Partial<GameRecord> = {}): GameRecord => ({ ...recordsFromPgn(pgn).records[0], ...extra });

function row(game: GameRecord, extra: Partial<RemoteGame> = {}): RemoteGame {
  const push = toPush(game);
  return {
    id: game.id,
    source: game.source,
    account: push.account,
    playedAt: push.playedAt,
    addedAt: push.addedAt,
    deleted: false,
    updatedAt: 1,
    record: push.record,
    raw: null,
    review: push.review,
    ...extra,
  };
}

describe('sending games', () => {
  it('sends the review apart from the record', () => {
    const game = local({ review: review(500) });
    const push = toPush(game);
    expect(JSON.parse(push.record).review).toBeUndefined();
    expect(JSON.parse(push.record).pgn).toBe(game.pgn);
    expect(push.reviewAt).toBe(500);
    expect(JSON.parse(push.review!)).toEqual(review(500));
  });
});

describe('pulling games', () => {
  it('stores a game from another browser', () => {
    const game = local({ review: review(100), addedAt: 42 });
    const merge = mergeRemote(row(game), undefined);
    expect(merge).toEqual({ kind: 'put', record: game, pushBack: false });
  });

  it('never replaces a review with an older one, and sends the newer one back', () => {
    const remote = row(local({ review: review(100) }));
    const mine = local({ review: review(200) });
    const merge = mergeRemote(remote, mine);
    expect(merge.kind).toBe('put');
    if (merge.kind !== 'put') return;
    expect(merge.record.review!.analyzedAt).toBe(200);
    expect(merge.pushBack).toBe(true);
  });

  it('takes a newer review from the account', () => {
    const merge = mergeRemote(row(local({ review: review(300) })), local({ review: review(200) }));
    expect(merge.kind === 'put' && merge.record.review!.analyzedAt).toBe(300);
    expect(merge.kind === 'put' && merge.pushBack).toBe(false);
  });

  it('keeps a review made here when the account has none yet', () => {
    const merge = mergeRemote(row(local()), local({ review: review(200) }));
    expect(merge.kind === 'put' && merge.record.review!.analyzedAt).toBe(200);
    expect(merge.kind === 'put' && merge.pushBack).toBe(true);
  });

  it('removes games removed on the account', () => {
    const gone: RemoteGame = { ...row(local()), deleted: true, record: undefined, review: undefined };
    expect(mergeRemote(gone, local())).toEqual({ kind: 'delete' });
    expect(mergeRemote(gone, undefined)).toEqual({ kind: 'skip' });
  });

  it('asks again for a game it was told it has but no longer does', () => {
    const same: RemoteGame = { ...row(local()), same: true, record: undefined, review: undefined };
    expect(mergeRemote(same, local())).toEqual({ kind: 'skip' });
    expect(mergeRemote(same, undefined)).toEqual({ kind: 'missing' });
  });

  it('turns a game the server fetched from chess.com into a record', () => {
    const raw = {
      url: 'https://www.chess.com/game/live/9',
      uuid: 'uuid-9',
      pgn,
      time_control: '600',
      time_class: 'rapid',
      end_time: 1760000000,
      rules: 'chess',
      white: { username: 'Me', rating: 1210 },
      black: { username: 'them', rating: 1250 },
    };
    const fetched: RemoteGame = {
      id: 'chesscom:uuid-9',
      source: 'chesscom',
      account: 'chesscom:me',
      playedAt: 1760000000000,
      addedAt: 1760000500000,
      deleted: false,
      updatedAt: 1,
      record: null,
      raw: JSON.stringify(raw),
      review: null,
    };
    const merge = mergeRemote(fetched, undefined);
    expect(merge.kind).toBe('put');
    if (merge.kind !== 'put') return;
    expect(merge.record).toMatchObject({ id: 'chesscom:uuid-9', me: 'w', account: 'chesscom:me', addedAt: 1760000500000, plies: 4, timeClass: 'rapid' });
    expect(merge.record.review).toBeUndefined();
  });

  it('skips what it cannot read', () => {
    expect(mergeRemote({ ...row(local()), record: '{broken' }, undefined)).toEqual({ kind: 'skip' });
    expect(mergeRemote({ ...row(local()), record: null, raw: '{"rules":"chess960"}', source: 'chesscom', account: 'chesscom:me' }, undefined)).toEqual({
      kind: 'skip',
    });
  });
});
