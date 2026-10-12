import { useSyncExternalStore } from 'react';
import { buildReview, evaluatePosition, positionsOf, repeatKey } from './analyze';
import { loadBook } from './book';
import { deleteGames, loadGames, saveGames } from './db';
import { noteError } from './diagnostics';
import { PREVIEW } from '../config';
import { ASM_ENGINE, WASM_ENGINE, createBrowserEngine } from './engine-browser';
import type { Platform } from './importers';
import { parsePgn } from './pgn';
import { isReviewed, type GameRecord, type GameReview, type ParsedGame, type PositionEval } from './types';
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
  /** Games waiting for an engine, front of the queue first. */
  queue: string[];
  /** The games being reviewed right now. */
  active: Progress[];
  engine: 'idle' | 'starting' | 'ready' | 'failed';
  engineError: string | null;
  /** True when the slow JavaScript engine is in use because WebAssembly is unavailable. */
  slowEngine: boolean;
  failures: Record<string, string>;
  settings: Settings;
}

const SETTINGS_KEY = 'chessdebrief.settings';
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
  for (const id of ids) cancelGame(id);
  set({ games: state.games.filter((g) => !drop.has(g.id)) });
  await deleteGames(ids);
}

export { isReviewed };

// ---- Review queue: a few engines sharing the work position by position ----
//
// Stockfish here is single-threaded, so one engine keeps one processor core busy. On a
// computer with cores to spare, a few engines run side by side. They all work on the game
// at the front of the queue, each on its own stretch of positions, so a single game opened
// on its own is reviewed several times faster too. An engine that runs out of work takes
// half of what another engine has left. Each engine works backwards through its stretch,
// so what it learns about later positions still sharpens the earlier ones.

/** Positions one engine works through, from `next` down to `lo`. */
interface Stretch {
  lo: number;
  /** The position being searched, or about to be. */
  next: number;
  /** The lane working on it, or null while it waits for one. */
  lane: number | null;
}

interface Job {
  id: string;
  /** Read from the PGN when an engine first takes the game. */
  game?: ParsedGame;
  fens: string[];
  evals: PositionEval[];
  done: number;
  /** Null until an engine takes the game; until then it is only queued. */
  stretches: Stretch[] | null;
  /** The position already evaluated for each repeat key. */
  seen: Map<string, number>;
  preset: { depth: number; movetime: number };
  lastPaint: number;
  cancelled: boolean;
}

/** Reviews still to finish, front of the queue first. */
const jobs: Job[] = [];
/** Engines by lane. Lane 0 is the main engine; the others are extras, started once it works. */
const engines: (UciEngine | null)[] = [];
const busyLanes = new Set<number>();
/** Set when an extra engine fails, so the rest of the visit uses the main engine only. */
let extrasFailed = false;
/** A stretch is only split while the engine on it has at least this many positions left after the current one. */
const SPLIT_MIN = 4;

/**
 * How many engines to run. Phones and tablets keep to one, to spare the battery and
 * avoid running hot; computers use about half their cores, up to three, leaving room
 * for the page itself and everything else that is open.
 */
export function reviewLanes(): number {
  if (state.slowEngine || extrasFailed) return 1;
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return 1;
  if (window.matchMedia?.('(pointer: coarse)').matches) return 1;
  const cores = navigator.hardwareConcurrency || 2;
  return Math.max(1, Math.min(3, Math.floor(cores / 2)));
}

/** Until the main engine is up, only one lane runs. */
const lanes = () => (state.engine === 'ready' ? reviewLanes() : 1);

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

const remaining = (s: Stretch) => s.next - s.lo + 1;

/** True when an engine could start on this job now: it is waiting, has a free stretch, or one worth splitting. */
function hasWork(job: Job): boolean {
  if (job.cancelled) return false;
  if (!job.stretches) return true;
  return job.stretches.some((s) => s.lane === null || remaining(s) > SPLIT_MIN);
}

/** Publishes which games are still waiting for an engine. */
function syncQueue() {
  set({ queue: jobs.filter((j) => !j.stretches).map((j) => j.id) });
}

function setProgress(job: Job, force = false) {
  const now = performance.now();
  if (!force && now - job.lastPaint < 150) return;
  job.lastPaint = now;
  const next = { id: job.id, done: job.done, total: job.fens.length };
  const at = state.active.findIndex((a) => a.id === job.id);
  set({ active: at < 0 ? [...state.active, next] : state.active.map((a, i) => (i === at ? next : a)) });
}

function dropJob(job: Job) {
  job.cancelled = true;
  const at = jobs.indexOf(job);
  if (at >= 0) jobs.splice(at, 1);
  // Engines still searching for it are told to stop; they drop the result.
  for (const s of job.stretches ?? []) if (s.lane !== null) engines[s.lane]?.stop();
  set({ active: state.active.filter((a) => a.id !== job.id) });
  syncQueue();
}

function cancelGame(id: string) {
  const job = jobs.find((j) => j.id === id);
  if (job) dropJob(job);
}

function failJob(job: Job, message: string) {
  noteError(`Review failed: ${message}`);
  dropJob(job);
  set({ failures: { ...state.failures, [job.id]: 'This game could not be reviewed.' } });
}

/**
 * Hands `lane` the next piece of work: a free stretch of the first game that has one, or
 * the lower half of what another engine has left on it. Null when there is nothing to take.
 */
function takeWork(lane: number): { job: Job; stretch: Stretch } | null {
  for (const job of [...jobs]) {
    if (!hasWork(job)) continue;
    if (!job.stretches) {
      const record = state.games.find((g) => g.id === job.id);
      try {
        if (!record) throw new Error('The game is no longer stored.');
        job.game = parsePgn(record.pgn);
      } catch (e) {
        failJob(job, e instanceof Error ? e.message : String(e));
        continue;
      }
      job.fens = positionsOf(job.game);
      job.evals = new Array(job.fens.length);
      job.preset = state.slowEngine ? SLOW_PRESET : DEPTHS[state.settings.depth];
      job.stretches = [{ lo: 0, next: job.fens.length - 1, lane: null }];
      syncQueue();
      setProgress(job, true);
    }
    const free = job.stretches.filter((s) => s.lane === null).sort((a, b) => b.next - a.next)[0];
    if (free) {
      free.lane = lane;
      return { job, stretch: free };
    }
    // Split the longest stretch still being worked on: this engine takes its lower half.
    const longest = job.stretches.reduce((a, b) => (remaining(b) > remaining(a) ? b : a));
    const ahead = longest.next - longest.lo;
    if (ahead < SPLIT_MIN) continue;
    const half = Math.floor(ahead / 2);
    const stretch: Stretch = { lo: longest.lo, next: longest.lo + half - 1, lane };
    longest.lo += half;
    job.stretches.push(stretch);
    return { job, stretch };
  }
  return null;
}

/** True when a game nearer the front of the queue could use this engine instead. */
function outranked(job: Job): boolean {
  for (const other of jobs) {
    if (other === job) return false;
    if (hasWork(other)) return true;
  }
  return false;
}

async function finish(job: Job, engineName: string) {
  const book = await loadBook().catch(() => undefined);
  if (job.cancelled) return;
  const review = buildReview(job.game!, job.evals, { book, depth: job.preset.depth, engine: engineName });
  dropJob(job);
  const current = state.games.find((g) => g.id === job.id);
  if (!current) return;
  const updated = { ...current, review };
  set({ games: state.games.map((g) => (g.id === job.id ? updated : g)) });
  await saveGames([updated]);
}

/** Starts an engine lane for each one the device can take, while there is work for it. */
function pump() {
  if (state.engine === 'failed') return;
  const count = lanes();
  for (let lane = 0; lane < count; lane++) {
    if (!jobs.some(hasWork)) return;
    if (!busyLanes.has(lane)) void runLane(lane);
  }
}

// The engines keep their hash tables when they move between games: entries from another
// game are never looked up, and a stretch handed back and taken up again still finds its own.
async function runLane(lane: number) {
  busyLanes.add(lane);
  try {
    while (lane < lanes() && jobs.some(hasWork)) {
      let eng: UciEngine;
      try {
        eng = await laneEngine(lane);
      } catch (e) {
        engineFailed(lane, e);
        return;
      }
      // The main engine is up: start the other lanes for whatever is waiting.
      if (lane === 0) pump();
      const work = takeWork(lane);
      if (!work) return;
      const { job, stretch } = work;
      try {
        // Another engine may take part of the stretch meanwhile, raising `lo`.
        while (stretch.next >= stretch.lo && !job.cancelled) {
          if (outranked(job)) {
            // Leave the rest for later and help with the game nearer the front.
            stretch.lane = null;
            break;
          }
          const i = stretch.next;
          const key = repeatKey(job.fens[i]);
          const twin = key ? job.seen.get(key) : undefined;
          const result = twin !== undefined ? job.evals[twin] : await evaluatePosition(job.fens[i], eng, job.preset);
          if (job.cancelled) break;
          job.evals[i] = result;
          if (key) job.seen.set(key, i);
          job.done++;
          stretch.next = i - 1;
          setProgress(job, job.done === job.fens.length);
        }
      } catch (e) {
        stretch.lane = null;
        if (eng.broken) {
          engineFailed(lane, e);
          return;
        }
        failJob(job, e instanceof Error ? e.message : String(e));
        continue;
      }
      if (job.cancelled) continue;
      job.stretches = job.stretches!.filter((s) => s.next >= s.lo);
      if (job.done === job.fens.length) {
        // Not awaited: the engine can start on the next game while the review is written.
        finish(job, eng.name).catch((e) => failJob(job, e instanceof Error ? e.message : String(e)));
      } else if (stretch.lane === null) {
        // A stretch handed back: wake any idle lane to pick it up.
        pump();
      }
    }
  } finally {
    busyLanes.delete(lane);
  }
}

function engineFailed(lane: number, e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  noteError(`Engine ${lane + 1} failed: ${message}`);
  engines[lane]?.dispose();
  engines[lane] = null;
  // Whatever it was working on goes back to the others.
  for (const job of jobs) for (const s of job.stretches ?? []) if (s.lane === lane) s.lane = null;
  if (lane > 0) {
    // An extra engine failed: carry on with the main one.
    extrasFailed = true;
    queueMicrotask(pump);
    return;
  }
  // The main engine never started, or died: nothing in the queue can run.
  for (const job of [...jobs]) dropJob(job);
  set({ engine: 'failed', engineError: message, queue: [] });
}

/** Queues games for review. With `first`, they go to the front, and the engines turn to them after the position they are on. */
export function requestReview(ids: string[], opts: { first?: boolean; again?: boolean } = {}) {
  const known = new Map(state.games.map((g) => [g.id, g]));
  const wanted = ids.filter((id) => {
    const g = known.get(id);
    return g && (opts.again || !isReviewed(g));
  });
  if (wanted.length === 0) return;
  const failures = { ...state.failures };
  for (const id of wanted) delete failures[id];
  const picked: Job[] = wanted.map(
    (id) =>
      jobs.find((j) => j.id === id) ?? {
        id,
        fens: [],
        evals: [],
        done: 0,
        stretches: null,
        seen: new Map(),
        preset: DEPTHS[state.settings.depth],
        lastPaint: 0,
        cancelled: false,
      },
  );
  const rest = jobs.filter((j) => !picked.includes(j));
  const fresh = picked.filter((j) => !jobs.includes(j));
  jobs.splice(0, jobs.length, ...(opts.first ? [...picked, ...rest] : [...rest, ...fresh]));
  set({ failures });
  syncQueue();
  pump();
}

export function cancelReviews() {
  for (const job of [...jobs]) dropJob(job);
}

/** Lets the person retry after the engine failed to start. */
export function resetEngine() {
  engines.forEach((e) => e?.dispose());
  engines.length = 0;
  extrasFailed = false;
  set({ engine: 'idle', engineError: null });
}
