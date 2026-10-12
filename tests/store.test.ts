import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createNodeEngine, loadBook } from '../scripts/node-engine';

// The review queue with real engines: Node processes stand in for the browser's workers.
const started: ReturnType<typeof createNodeEngine>[] = [];
vi.mock('../src/lib/engine-browser', () => ({
  WASM_ENGINE: 'wasm',
  ASM_ENGINE: 'asm',
  createBrowserEngine: () => {
    const engine = createNodeEngine();
    started.push(engine);
    return engine;
  },
}));
vi.mock('../src/lib/book', () => ({ loadBook: () => Promise.resolve(loadBook()) }));

const { recordsFromPgn } = await import('../src/lib/importers');
const store = await import('../src/lib/store');
const { getState, subscribe } = store;

/** Resolves once `test` holds for the app state. */
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

const reviewed = (id: string) => store.isReviewed(getState().games.find((g) => g.id === id)!);

describe('review queue', () => {
  const { records } = recordsFromPgn(readFileSync('tests/games/fixtures.pgn', 'utf8'));
  const opera = recordsFromPgn(readFileSync('tests/games/opera.pgn', 'utf8')).records[0];

  beforeAll(async () => {
    // A computer with cores to spare: three engines.
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
    await store.init();
    store.updateSettings({ depth: 'quick' });
    await store.addGames([opera, ...records]);
  });
  afterAll(() => {
    store.cancelReviews();
    store.resetEngine();
    vi.unstubAllGlobals();
  });

  it('shares one game between all the engines and reviews every position', async () => {
    store.requestReview([opera.id]);
    await until(() => reviewed(opera.id));
    expect(started).toHaveLength(store.reviewLanes());
    expect(store.reviewLanes()).toBe(3);
    const review = getState().games.find((g) => g.id === opera.id)!.review!;
    expect(review.moves).toHaveLength(opera.plies);
    const byLabel = Object.fromEntries(review.moves.map((m) => [`${Math.ceil(m.ply / 2)}${m.color}${m.san}`, m]));
    expect(byLabel['16wQb8+'].mark).toBe('brilliant');
    expect(byLabel['17wRd8#'].mark).toBe('best');
    expect(review.accuracy.w).toBeGreaterThan(review.accuracy.b + 5);
    expect(getState().active).toEqual([]);
  });

  it('reviews a batch, and a game asked for first jumps the queue without losing work', async () => {
    const ids = records.map((r) => r.id);
    const finished: string[] = [];
    const stop = subscribe(() => {
      for (const id of ids) if (!finished.includes(id) && reviewed(id)) finished.push(id);
    });
    store.requestReview(ids);
    expect(getState().queue.length).toBeGreaterThan(0);
    const last = ids[ids.length - 1];
    store.requestReview([last], { first: true });
    await until(() => ids.every(reviewed));
    stop();
    expect(finished.indexOf(last)).toBeLessThanOrEqual(1);
    expect(getState().queue).toEqual([]);
    expect(getState().active).toEqual([]);
    expect(getState().failures).toEqual({});
    for (const id of ids) {
      const g = getState().games.find((x) => x.id === id)!;
      expect(g.review!.moves).toHaveLength(g.plies);
    }
  });

  it('stops cleanly when reviews are cancelled', async () => {
    const ids = records.map((r) => r.id);
    store.requestReview(ids, { again: true });
    await until((s) => s.active.some((a) => a.done > 3));
    store.cancelReviews();
    expect(getState().queue).toEqual([]);
    expect(getState().active).toEqual([]);
    // The engines are free again: a new request still completes.
    store.requestReview([ids[0]], { again: true });
    const before = getState().games.find((g) => g.id === ids[0])!.review!.analyzedAt;
    await until((s) => s.games.find((g) => g.id === ids[0])!.review!.analyzedAt !== before);
  });
});
