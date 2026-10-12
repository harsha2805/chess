import { useSyncExternalStore } from 'react';
import { analyzeGame, CancelledError } from './analyze';
import { loadBook } from './book';
import { deleteGames, loadGames, saveGames } from './db';
import { noteError } from './diagnostics';
import { PREVIEW } from '../config';
import { ASM_ENGINE, WASM_ENGINE, createBrowserEngine } from './engine-browser';
import type { Platform } from './importers';
import { parsePgn } from './pgn';
import { isReviewed, type GameRecord, type GameReview } from './types';
import type { UciEngine } from './uci';

export type DepthPreset = 'quick' | 'standard' | 'deep';

export const DEPTHS: Record<DepthPreset, { depth: number; movetime: number; label: string; hint: string; summary: string }> = {
  quick: {
    depth: 10,
    movetime: 600,
    label: 'Quick',
    hint: 'A few seconds a game.',
    summary: 'Catches hung pieces and plain blunders, but can misjudge sacrifices and long combinations.',
  },
  standard: {
    depth: 12,
    movetime: 1500,
    label: 'Standard',
    hint: 'About ten seconds a game on a laptop, longer on a phone.',
    summary: 'Right for most games: it finds the mistakes that decided the game.',
  },
  deep: {
    depth: 16,
    movetime: 5000,
    label: 'Deep',
    hint: 'A minute or two a game.',
    summary: 'Looks furthest ahead, so it sees long combinations and judges sacrifices more fairly.',
  },
};

/** The setting a saved review was made with, by the engine depth it records. */
export function reviewSetting(review: GameReview): string {
  const preset = (Object.keys(DEPTHS) as DepthPreset[]).find((d) => DEPTHS[d].depth === review.depth);
  return preset ? `${DEPTHS[preset].label} review` : 'Backup engine review';
}

/** True when the chosen setting would look further ahead than the review already saved. */
export function canDeepen(game: GameRecord, preset: DepthPreset): boolean {
  return isReviewed(game) && game.review!.depth < DEPTHS[preset].depth;
}

export interface Settings {
  depth: DepthPreset;
  platform: Platform;
  username: string;
  /** Whose games the insights describe. */
  player: string;
  /** Seconds each move stays on the board while a game plays itself. */
  autoplay: number;
  /** How the games list is ordered. */
  sort: GameSort;
}

export type GameSort = 'newest' | 'oldest' | 'added' | 'best' | 'worst';

export const AUTOPLAY_SPEEDS = [0.5, 1, 2, 3, 5, 10, 15, 30];

export interface Progress {
  id: string;
  done: number;
  total: number;
}

export interface AppState {
  ready: boolean;
  games: GameRecord[];
  queue: string[];
  /** The games being reviewed right now, one per engine. */
  active: Progress[];
  engine: 'idle' | 'starting' | 'ready' | 'failed';
  engineError: string | null;
  /** True when the slow JavaScript engine is in use because WebAssembly is unavailable. */
  slowEngine: boolean;
  failures: Record<string, string>;
  settings: Settings;
}

const SETTINGS_KEY = 'postmortem.settings';
const defaults: Settings = { depth: 'standard', platform: 'chesscom', username: '', player: '', autoplay: 1, sort: 'newest' };

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
  active: [],
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
  for (const a of state.active) if (drop.has(a.id)) cancelGame(a.id);
  set({ games: state.games.filter((g) => !drop.has(g.id)), queue: state.queue.filter((id) => !drop.has(id)) });
  await deleteGames(ids);
}

export { isReviewed };

// ---- Review queue: a few engines, each reviewing one game at a time ----
//
// Stockfish here is single-threaded, so one engine keeps one processor core busy. On a
// computer with cores to spare, a few engines side by side get through a batch of games
// that many times faster. Each still reviews its game exactly as it would alone.

/** Engines by lane. Lane 0 is the main engine; the others are extras, started once it works. */
const engines: (UciEngine | null)[] = [];
const busyLanes = new Set<number>();
/** The lane reviewing each game, and the flag that cancels that review. */
const running = new Map<string, { lane: number; cancelled: boolean }>();
/** Set when an extra engine fails, so the rest of the visit uses the main engine only. */
let extrasFailed = false;

/**
 * How many games to review at once. Phones and tablets keep to one, to spare the battery
 * and avoid running hot; computers use about half their cores, up to three, leaving room
 * for the page itself and everything else that is open.
 */
export function reviewLanes(): number {
  if (state.slowEngine || extrasFailed) return 1;
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return 1;
  if (window.matchMedia?.('(pointer: coarse)').matches) return 1;
  const cores = navigator.hardwareConcurrency || 2;
  return Math.max(1, Math.min(3, Math.floor(cores / 2)));
}

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

async function mainEngine(): Promise<UciEngine> {
  if (engines[0]) return engines[0];
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
  engines[0] = created;
  set({ engine: 'ready', slowEngine: slow });
  return created;
}

async function laneEngine(lane: number): Promise<UciEngine> {
  if (lane === 0) return mainEngine();
  return (engines[lane] ??= await start(WASM_ENGINE, 45000));
}

/** The backup engine is several times slower, so it looks less far ahead. */
const SLOW_PRESET = { depth: 8, movetime: 400 };

function cancelGame(id: string) {
  const run = running.get(id);
  if (!run) return;
  run.cancelled = true;
  engines[run.lane]?.stop();
}

function setProgress(id: string, done: number, total: number) {
  const next = { id, done, total };
  const at = state.active.findIndex((a) => a.id === id);
  set({ active: at < 0 ? [...state.active, next] : state.active.map((a, i) => (i === at ? next : a)) });
}

/** Queues games for review. With `first`, they jump the queue, interrupting a review if every engine is busy. */
export function requestReview(ids: string[], opts: { first?: boolean; again?: boolean } = {}) {
  const known = new Map(state.games.map((g) => [g.id, g]));
  const wanted = ids.filter((id) => {
    const g = known.get(id);
    return g && (opts.again || !isReviewed(g)) && !running.has(id);
  });
  if (wanted.length === 0) return;
  const failures = { ...state.failures };
  for (const id of wanted) delete failures[id];
  const rest = state.queue.filter((id) => !wanted.includes(id));
  if (opts.first) {
    // Until the main engine is up, only one lane runs.
    const lanes = state.engine === 'ready' ? reviewLanes() : 1;
    const newest = state.active[state.active.length - 1];
    const interrupted = busyLanes.size >= lanes && newest ? [newest.id] : [];
    set({ queue: [...wanted, ...interrupted, ...rest], failures });
    if (interrupted.length) cancelGame(newest.id);
  } else {
    set({ queue: [...rest, ...wanted], failures });
  }
  pump();
}

export function cancelReviews() {
  set({ queue: [] });
  for (const id of running.keys()) cancelGame(id);
}

/** Starts an engine lane for each game waiting, up to the number the device can take. */
function pump() {
  const lanes = state.engine === 'ready' ? reviewLanes() : 1;
  for (let lane = 0; lane < lanes; lane++) {
    if (state.queue.length === 0) return;
    if (!busyLanes.has(lane)) void runLane(lane);
  }
}

async function runLane(lane: number) {
  busyLanes.add(lane);
  try {
    while (state.queue.length > 0 && lane < reviewLanes()) {
      const [id, ...rest] = state.queue;
      set({ queue: rest });
      const game = state.games.find((g) => g.id === id);
      if (!game) continue;
      const mine = { lane, cancelled: false };
      running.set(id, mine);
      setProgress(id, 0, game.plies + 1);
      try {
        const eng = await laneEngine(lane);
        // The main engine is up: start the other lanes for whatever is still waiting.
        if (lane === 0) pump();
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
              if (!mine.cancelled) setProgress(id, done, total);
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
        noteError(`Review failed${lane ? ` (engine ${lane + 1})` : ''}: ${message}`);
        const eng = engines[lane];
        if (!eng || eng.broken) {
          eng?.dispose();
          engines[lane] = null;
          if (lane > 0) {
            // An extra engine failed: hand the game back and carry on with the main one.
            extrasFailed = true;
            set({ queue: [id, ...state.queue] });
            break;
          }
          // The main engine never started, or died: nothing else in the queue can run either.
          set({ engine: 'failed', engineError: message, queue: [] });
          break;
        }
        set({ failures: { ...state.failures, [id]: 'This game could not be reviewed.' } });
      } finally {
        running.delete(id);
        set({ active: state.active.filter((a) => a.id !== id) });
      }
    }
  } finally {
    busyLanes.delete(lane);
    // A lane that stopped early leaves its games to the others.
    if (state.queue.length > 0 && state.engine !== 'failed') pump();
  }
}

/** Lets the person retry after the engine failed to start. */
export function resetEngine() {
  engines.forEach((e) => e?.dispose());
  engines.length = 0;
  extrasFailed = false;
  set({ engine: 'idle', engineError: null });
}
