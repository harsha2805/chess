import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createNodeEngine, loadBook } from '../scripts/node-engine';

// Background Deep reviews, with real engines: Node processes stand in for the browser's workers.
vi.mock('../src/lib/engine-browser', () => ({
  WASM_ENGINE: 'wasm',
  ASM_ENGINE: 'asm',
  createBrowserEngine: () => createNodeEngine(),
}));
vi.mock('../src/lib/book', () => ({ loadBook: () => Promise.resolve(loadBook()) }));

const { recordsFromPgn } = await import('../src/lib/importers');
const store = await import('../src/lib/store');
const { getState, subscribe, DEPTHS } = store;

function until(test: (s: ReturnType<typeof getState>) => boolean): Promise<void> {
  return new Promise((resolve) => {
    if (test(getState())) return resolve();
    const stop = subscribe(() => {
      if (!test(getState())) return;
      stop();
      resolve();
    });
  });
}

const game = (id: string) => getState().games.find((g) => g.id === id);
const depthOf = (id: string) => game(id)?.review?.depth ?? 0;

/** Stands in for the account: grants every claim except for the games in `held`. */
const claims = {
  held: new Map<string, number>(),
  claimed: [] as string[],
  released: [] as string[],
  claim(id: string) {
    const progress = this.held.get(id);
    if (progress !== undefined) return Promise.resolve({ granted: false, progress });
    this.claimed.push(id);
    return Promise.resolve({ granted: true });
  },
  renew: () => Promise.resolve(true),
  release(id: string) {
    this.released.push(id);
  },
};

describe('background Deep reviews', () => {
  const opera = recordsFromPgn(readFileSync('tests/games/opera.pgn', 'utf8')).records[0];
  const r = recordsFromPgn(readFileSync('tests/games/fixtures.pgn', 'utf8')).records;

  beforeAll(async () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
    // Deep, made quicker for the tests. It has no time limit.
    expect(DEPTHS.deep.movetime).toBeUndefined();
    DEPTHS.deep.depth = 11;
    store.idleTuning.graceMs = 0;
    store.idleTuning.startDelayMs = 0;
    store.setDeepenClaims(claims);
    await store.init();
    store.updateSettings({ depth: 'quick', deepenIdle: false });
  });
  afterAll(() => {
    store.updateSettings({ deepenIdle: false });
    store.cancelReviews();
    store.resetEngine();
    vi.unstubAllGlobals();
  });

  it('deepens reviewed games one at a time, apart from the reviews asked for', async () => {
    const ids = [opera.id, r[0].id, r[1].id];
    await store.addGames([opera, r[0], r[1]]);
    store.requestReview(ids);
    await until(() => ids.every((id) => depthOf(id) === DEPTHS.quick.depth));

    const seen: string[] = [];
    const stop = subscribe(() => {
      const s = getState();
      if (!s.deepening) return;
      // A background review is never shown as queued, under way or failed.
      expect(s.queue).toEqual([]);
      expect(s.active).toEqual([]);
      expect(s.failures).toEqual({});
      if (seen[seen.length - 1] !== s.deepening.id) seen.push(s.deepening.id);
    });
    store.updateSettings({ deepenIdle: true });
    await until(() => ids.every((id) => depthOf(id) === DEPTHS.deep.depth));
    stop();

    // Newest first, each once.
    expect(seen).toEqual([...ids].sort((a, b) => getState().games.findIndex((g) => g.id === a) - getState().games.findIndex((g) => g.id === b)));
    for (const id of ids) {
      const review = game(id)!.review!;
      expect(review.moves).toHaveLength(game(id)!.plies);
      expect(review.reached).toBe(DEPTHS.deep.depth);
      expect(review.capped).toBe(0);
    }
    expect(claims.claimed).toEqual(seen);
    // Finished reviews keep their claim until their upload ends it on the server.
    expect(claims.released).toEqual([]);
    await until((s) => s.deepening === null);
  });

  it('gives way to a review asked for, then finishes what it was doing', async () => {
    await store.addGames([r[2], r[3]]);
    await until((s) => s.deepening !== null && s.deepening.done > 3);
    const deepening = getState().deepening!.id;
    const asked = deepening === r[2].id ? r[3].id : r[2].id;
    store.requestReview([asked], { first: true });
    await until((s) => s.active.some((a) => a.id === asked));
    await until(() => depthOf(asked) === DEPTHS.quick.depth);
    expect(depthOf(deepening)).toBe(0);
    // Both end up with a full Deep review.
    await until(() => depthOf(deepening) === DEPTHS.deep.depth && depthOf(asked) === DEPTHS.deep.depth);
    expect(game(deepening)!.review!.capped).toBe(0);
  });

  it('skips a game another device is working on', async () => {
    claims.held.set(r[4].id, 40);
    await store.addGames([r[4]]);
    await until((s) => s.elsewhere[r[4].id] === 40);
    expect(game(r[4].id)!.review).toBeUndefined();
  });

  it('drops the background review of a game removed meanwhile, and stops when turned off', async () => {
    await store.addGames([r[5], r[6]]);
    await until((s) => s.deepening !== null && s.deepening.done > 2);
    const removed = getState().deepening!.id;
    await store.removeGames([removed]);
    expect(game(removed)).toBeUndefined();
    // Abandoned before it finished: the claim is given up at once.
    expect(claims.released).toContain(removed);
    await until((s) => s.deepening !== null && s.deepening.id !== removed);
    store.updateSettings({ deepenIdle: false });
    expect(getState().deepening).toBeNull();
  });

  it('never replaces a stronger review, even with one asked for', async () => {
    const before = game(opera.id)!.review!;
    store.requestReview([opera.id], { first: true, again: true, target: 'quick' });
    await until((s) => s.notices[opera.id] !== undefined);
    expect(game(opera.id)!.review).toEqual(before);
  });

  it('keeps the setting a review was asked with when the setting changes', async () => {
    await store.addGames([r[7]]);
    store.updateSettings({ depth: 'deep' });
    // The first keeps the engines busy, so the second is still waiting when the setting changes.
    store.requestReview([r[0].id, r[7].id], { again: true });
    store.updateSettings({ depth: 'quick' });
    await until(() => depthOf(r[7].id) === DEPTHS.deep.depth);
    expect(game(r[7].id)!.review!.reached).toBe(DEPTHS.deep.depth);
  });

  it('says when the time limit stopped the engine short', async () => {
    const id = game(r[5].id) ? r[5].id : r[6].id;
    const saved = { ...DEPTHS.quick };
    DEPTHS.quick.movetime = 1;
    try {
      await store.removeGames([id]);
      await store.addGames([r.find((x) => x.id === id)!]);
      store.requestReview([id], { first: true });
      await until(() => depthOf(id) === DEPTHS.quick.depth);
    } finally {
      Object.assign(DEPTHS.quick, saved);
    }
    const review = game(id)!.review!;
    expect(review.capped).toBeGreaterThan(0);
    expect(review.reached).toBeLessThan(DEPTHS.quick.depth);
    expect(store.reviewShortfall(review)).toMatch(/time limit/);
  });
});
