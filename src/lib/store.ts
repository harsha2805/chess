import { useSyncExternalStore } from 'react';
import { analyzeGame, CancelledError } from './analyze';
import { loadBook } from './book';
import { deleteGames, loadGames, saveGames } from './db';
import { noteError } from './diagnostics';
import { PREVIEW } from '../config';
import { ASM_ENGINE, WASM_ENGINE, createBrowserEngine } from './engine-browser';
import type { Platform } from './importers';
import { parsePgn } from './pgn';
import { isReviewed, type GameRecord } from './types';
import type { UciEngine } from './uci';

export type DepthPreset = 'quick' | 'standard' | 'deep';

export const DEPTHS: Record<DepthPreset, { depth: number; movetime: number; label: string; hint: string }> = {
  quick: { depth: 10, movetime: 600, label: 'Quick', hint: 'A few seconds a game. Fine for spotting blunders.' },
  standard: { depth: 12, movetime: 1500, label: 'Standard', hint: 'About ten seconds a game on a laptop, longer on a phone.' },
  deep: { depth: 16, movetime: 5000, label: 'Deep', hint: 'A minute or two a game. Sees longer combinations.' },
};

export interface Settings {
  depth: DepthPreset;
  platform: Platform;
  username: string;
  /** Whose games the insights describe. */
  player: string;
}

export interface AppState {
  ready: boolean;
  games: GameRecord[];
  queue: string[];
  active: { id: string; done: number; total: number } | null;
  engine: 'idle' | 'starting' | 'ready' | 'failed';
  engineError: string | null;
  /** True when the slow JavaScript engine is in use because WebAssembly is unavailable. */
  slowEngine: boolean;
  failures: Record<string, string>;
  settings: Settings;
}

const SETTINGS_KEY = 'postmortem.settings';
const defaults: Settings = { depth: 'standard', platform: 'chesscom', username: '', player: '' };

function readSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...defaults, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // Storage can be blocked; the defaults are fine.
  }
  return defaults;
}

let state: AppState = {
  ready: false,
  games: [],
  queue: [],
  active: null,
  engine: 'idle',
  engineError: null,
  slowEngine: false,
  failures: {},
  settings: readSettings(),
};

const listeners = new Set<() => void>();

function set(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const getState = () => state;

/** Subscribes a component to one slice of the app state. The selector must return a stable reference. */
export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}

const byDate = (a: GameRecord, b: GameRecord) => b.playedAt - a.playedAt || b.addedAt - a.addedAt;

export async function init() {
  const games = await loadGames();
  set({ ready: true, games: games.sort(byDate) });
}

export function updateSettings(patch: Partial<Settings>) {
  const settings = { ...state.settings, ...patch };
  set({ settings });
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Not saved; the choice still holds for this visit.
  }
}

/** Adds games, keeping any review already stored for a game seen before. Returns how many were new. */
export async function addGames(records: GameRecord[]): Promise<number> {
  const existing = new Map(state.games.map((g) => [g.id, g]));
  let added = 0;
  const changed: GameRecord[] = [];
  for (const r of records) {
    const old = existing.get(r.id);
    if (!old) added++;
    const merged = old ? { ...r, addedAt: old.addedAt, review: old.review, me: r.me ?? old.me, account: r.account ?? old.account } : r;
    existing.set(r.id, merged);
    changed.push(merged);
  }
  set({ games: [...existing.values()].sort(byDate) });
  await saveGames(changed);
  return added;
}

export async function removeGames(ids: string[]) {
  const drop = new Set(ids);
  if (state.active && drop.has(state.active.id)) cancelActive();
  set({ games: state.games.filter((g) => !drop.has(g.id)), queue: state.queue.filter((id) => !drop.has(id)) });
  await deleteGames(ids);
}

export { isReviewed };

// ---- Review queue: one engine, one game at a time ----

let engine: UciEngine | null = null;
let running = false;
let token = { cancelled: false };

async function start(file: string, patience: number): Promise<UciEngine> {
  const created = createBrowserEngine(file);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      created.whenReady(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('The chess engine took too long to start.')), patience);
      }),
    ]);
  } catch (e) {
    created.dispose();
    throw e;
  } finally {
    clearTimeout(timer);
  }
  return created;
}

async function ensureEngine(): Promise<UciEngine> {
  if (engine) return engine;
  set({ engine: 'starting', engineError: null });
  let slow = false;
  let created: UciEngine;
  try {
    created = await start(WASM_ENGINE, PREVIEW ? 20000 : 45000);
  } catch (e) {
    // The preview build ships a plain JavaScript engine for frames that refuse WebAssembly.
    if (!PREVIEW) throw e;
    noteError(`WebAssembly engine failed: ${e instanceof Error ? e.message : String(e)}`);
    created = await start(ASM_ENGINE, 60000);
    slow = true;
  }
  engine = created;
  set({ engine: 'ready', slowEngine: slow });
  return created;
}

/** The backup engine is several times slower, so it looks less far ahead. */
const SLOW_PRESET = { depth: 8, movetime: 400 };

function cancelActive() {
  token.cancelled = true;
  engine?.stop();
}

/** Queues games for review. With `first`, they jump the queue and interrupt the game being reviewed. */
export function requestReview(ids: string[], opts: { first?: boolean; again?: boolean } = {}) {
  const known = new Map(state.games.map((g) => [g.id, g]));
  const wanted = ids.filter((id) => {
    const g = known.get(id);
    return g && (opts.again || !isReviewed(g)) && state.active?.id !== id;
  });
  if (wanted.length === 0) return;
  const failures = { ...state.failures };
  for (const id of wanted) delete failures[id];
  const rest = state.queue.filter((id) => !wanted.includes(id));
  if (opts.first) {
    const interrupted = state.active ? [state.active.id] : [];
    if (state.active) cancelActive();
    set({ queue: [...wanted, ...interrupted, ...rest], failures });
  } else {
    set({ queue: [...rest, ...wanted], failures });
  }
  void run();
}

export function cancelReviews() {
  set({ queue: [] });
  cancelActive();
}

async function run() {
  if (running) return;
  running = true;
  try {
    while (state.queue.length > 0) {
      const [id, ...rest] = state.queue;
      set({ queue: rest });
      const game = state.games.find((g) => g.id === id);
      if (!game) continue;
      set({ active: { id, done: 0, total: game.plies + 1 } });
      const mine = (token = { cancelled: false });
      try {
        const eng = await ensureEngine();
        const book = await loadBook().catch(() => undefined);
        const preset = state.slowEngine ? SLOW_PRESET : DEPTHS[state.settings.depth];
        let lastPaint = 0;
        const review = await analyzeGame(parsePgn(game.pgn), eng, {
          depth: preset.depth,
          movetime: preset.movetime,
          book,
          isCancelled: () => mine.cancelled,
          onProgress: (done, total) => {
            const now = performance.now();
            if (now - lastPaint > 150 || done === total) {
              lastPaint = now;
              if (!mine.cancelled) set({ active: { id, done, total } });
            }
          },
        });
        const current = state.games.find((g) => g.id === id);
        if (current) {
          const updated = { ...current, review };
          set({ games: state.games.map((g) => (g.id === id ? updated : g)) });
          await saveGames([updated]);
        }
      } catch (e) {
        if (e instanceof CancelledError) continue;
        const message = e instanceof Error ? e.message : String(e);
        noteError(`Review failed: ${message}`);
        if (!engine || engine.broken) {
          // The engine never started, or died: nothing else in the queue can run either.
          engine?.dispose();
          engine = null;
          set({ engine: 'failed', engineError: message, queue: [] });
          break;
        }
        set({ failures: { ...state.failures, [id]: 'This game could not be reviewed.' } });
      }
    }
  } finally {
    running = false;
    set({ active: null });
  }
}

/** Lets the person retry after the engine failed to start. */
export function resetEngine() {
  engine?.dispose();
  engine = null;
  set({ engine: 'idle', engineError: null });
}
