import { useSyncExternalStore } from 'react';
import { buildReview, evaluatePosition, positionsOf, repeatKey } from './analyze';
import { loadBook } from './book';
import { clearGames, deleteGames, isPersistent, loadGame, loadGames, saveGames } from './db';
import { noteError } from './diagnostics';
import { detectEnding } from './ending';
import { PREVIEW } from '../config';
import { ASM_ENGINE, WASM_ENGINE, createBrowserEngine } from './engine-browser';
import type { Platform } from './importers';
import { parsePgn } from './pgn';
import {
  REVIEW_VERSION,
  betterReview,
  compareReviews,
  isReviewed,
  type GameRecord,
  type GameReview,
  type ParsedGame,
  type PositionEval,
  type PracticeLine,
} from './types';
import type { UciEngine } from './uci';

export type DepthPreset = 'quick' | 'standard' | 'deep';

/**
 * How far each setting looks. Quick and Standard cap each position's search, so slow devices
 * still finish; Deep has no time limit, so it always reaches its full depth, however long a
 * position takes on a slow device.
 */
export const DEPTHS: Record<DepthPreset, { depth: number; movetime?: number; label: string; hint: string; summary: string }> = {
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
    label: 'Deep',
    hint: 'A minute or two a game on a laptop, longer on a phone: it never cuts a position short.',
    summary: 'Looks furthest ahead, so it sees long combinations and judges sacrifices more fairly.',
  },
};

const PRESETS = Object.keys(DEPTHS) as DepthPreset[];

/** The setting a saved review was made with, by the engine depth it records. */
export function reviewSetting(review: GameReview): string {
  const preset = PRESETS.find((d) => DEPTHS[d].depth === review.depth);
  return preset ? `${DEPTHS[preset].label} review` : 'Backup engine review';
}

/**
 * Says when the time limit stopped the engine short of the depth asked for, so a review is
 * never presented as stronger than it is. Null when every position reached it.
 */
export function reviewShortfall(review: GameReview): string | null {
  if (!review.capped || review.reached === undefined) return null;
  const n = review.capped === 1 ? 'one position' : `${review.capped} positions`;
  return `The time limit stopped the engine early in ${n} (it looked ${review.reached} moves ahead on average, not ${review.depth}).`;
}

/**
 * True when the review is a full Deep review in the current format: one the time limit Deep
 * used to have did not cut short.
 */
export const isDeep = (review: GameReview | undefined) =>
  !!review && review.version === REVIEW_VERSION && review.depth >= DEPTHS.deep.depth && !review.capped;

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
  /** Give games a Deep review in the background while nothing else is being reviewed. */
  deepenIdle: boolean;
  /** Show games played against the bot in the games list and count them in the insights. */
  includeBots: boolean;
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
  /** Said about a game whose new review was not kept, because a stronger one was already saved. */
  notices: Record<string, string>;
  /** The game getting a Deep review in the background, apart from the reviews asked for. */
  deepening: Progress | null;
  /** Background Deep reviews were paused for this visit. */
  deepenPaused: boolean;
  /** Games another of the person's devices is giving a Deep review, with how far it has got (0 to 100). */
  elsewhere: Record<string, number>;
  settings: Settings;
}

const SETTINGS_KEY = 'chessdebrief.settings';
/**
 * Whether this device suits background Deep reviews: a computer, not a phone or tablet,
 * with cores to spare, since one engine keeps one core busy for as long as it runs.
 */
export function suitsDeepening(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  if (window.matchMedia?.('(pointer: coarse)').matches) return false;
  return (navigator.hardwareConcurrency || 2) >= 4;
}

const defaults: Settings = {
  depth: 'standard',
  platform: 'chesscom',
  username: '',
  player: '',
  autoplay: 1,
  sort: 'newest',
  deepenIdle: suitsDeepening(),
  includeBots: false,
};

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
  notices: {},
  deepening: null,
  deepenPaused: false,
  elsewhere: {},
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
  openedAt = Date.now();
  scheduleIdle();
  void fillEndings();
}

/** Reads how a game ended from its PGN, for a game saved before that was kept. */
function withEnding(g: GameRecord): GameRecord {
  if (g.ending !== undefined) return g;
  try {
    return { ...g, ending: detectEnding(parsePgn(g.pgn), g.result) ?? null };
  } catch {
    return { ...g, ending: null };
  }
}

/** Fills in how each older game ended, a few games at a time so the page stays responsive. */
async function fillEndings() {
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const batch = state.games.filter((g) => g.ending === undefined).slice(0, 25);
    if (batch.length === 0) return;
    const filled = new Map(batch.map((g) => [g.id, withEnding(g)]));
    set({ games: state.games.map((g) => filled.get(g.id) ?? g) });
    await saveGames([...filled.values()]);
  }
}

export function updateSettings(patch: Partial<Settings>) {
  const settings = { ...state.settings, ...patch };
  set({ settings });
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Not saved; the choice still holds for this visit.
  }
  if (patch.deepenIdle === false) stopDeepening();
  if (patch.deepenIdle) scheduleIdle();
}

/** Adds games, keeping any review already stored for a game seen before. Returns how many were new. */
export async function addGames(records: GameRecord[]): Promise<number> {
  // Another tab may have saved a stronger review since this one loaded its games.
  const stored = new Map<string, GameRecord | undefined>();
  await Promise.all(records.filter((r) => state.games.some((g) => g.id === r.id)).map(async (r) => stored.set(r.id, await loadGame(r.id))));
  const existing = new Map(state.games.map((g) => [g.id, g]));
  let added = 0;
  const changed: GameRecord[] = [];
  for (const r of records) {
    const old = existing.get(r.id);
    if (!old) added++;
    const review = betterReview(old?.review, stored.get(r.id)?.review);
    const merged = old
      ? { ...r, addedAt: old.addedAt, review, practice: r.practice ?? old.practice, bot: r.bot ?? old.bot, me: r.me ?? old.me, account: r.account ?? old.account }
      : r;
    if (!merged.review) delete merged.review;
    if (!merged.practice) delete merged.practice;
    if (!merged.bot) delete merged.bot;
    existing.set(r.id, merged);
    changed.push(merged);
  }
  set({ games: [...existing.values()].sort(byDate) });
  await saveGames(changed);
  changeListener?.({ saved: changed.map((g) => g.id), deleted: [] });
  scheduleIdle();
  return added;
}

export async function removeGames(ids: string[]) {
  const drop = new Set(ids);
  for (const id of ids) cancelGame(id);
  set({ games: state.games.filter((g) => !drop.has(g.id)) });
  await deleteGames(ids);
  changeListener?.({ saved: [], deleted: ids });
}

// ---- Changes from elsewhere: the account's other browsers and the scheduled fetch ----

export interface GamesChange {
  saved: string[];
  deleted: string[];
}

let changeListener: ((change: GamesChange) => void) | null = null;

/** Hears about games added, reviewed or removed here, so they can be sent to the account. */
export function onGamesChanged(listener: (change: GamesChange) => void) {
  changeListener = listener;
}

/**
 * Stores games that changed on the account. Unlike `addGames`, nothing is reported back,
 * except a review made here while the changes were being pulled that is stronger than the
 * one pulled: it is kept, and sent to the account.
 */
export async function applyRemote(saved: GameRecord[], deleted: string[]) {
  if (saved.length === 0 && deleted.length === 0) return;
  for (const id of deleted) cancelGame(id);
  const games = new Map(state.games.map((g) => [g.id, g]));
  for (const id of deleted) games.delete(id);
  const stronger: string[] = [];
  const records = saved.map(withEnding).map((g) => {
    const mine = games.get(g.id)?.review;
    const review = betterReview(g.review, mine);
    if (review === g.review) return g;
    if (!g.review || compareReviews(mine!, g.review) > 0) stronger.push(g.id);
    return { ...g, review };
  });
  for (const g of records) {
    games.set(g.id, g);
    // A Deep review came from another device: there is nothing left to do here.
    const job = jobs.find((j) => j.id === g.id && j.background);
    if (job && isDeep(g.review)) dropJob(job);
  }
  set({ games: [...games.values()].sort(byDate) });
  await Promise.all([saveGames(records), deleteGames(deleted)]);
  if (stronger.length > 0) changeListener?.({ saved: stronger, deleted: [] });
  scheduleIdle();
}

/** Forgets every game in this browser, as when the person signs out. */
export async function clearLocal() {
  cancelReviews();
  bgTried.clear();
  set({ games: [], failures: {}, notices: {}, elsewhere: {}, deepenPaused: false });
  await clearGames();
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
//
// When nothing is asked for, one engine gives the games a Deep review in the background,
// newest first (see "Deep reviews in the background" below). That job always stays at the
// back of the queue, runs on the main engine only, and gives way the moment a review is asked for.

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
  /** The setting asked for, fixed when the review is requested. */
  target: DepthPreset;
  /** Set from `target` when an engine first takes the game. */
  preset: { depth: number; movetime?: number };
  lastPaint: number;
  cancelled: boolean;
  /** A Deep review nobody asked for, done while the engines are idle. */
  background: boolean;
  /** The background job was told to give way: the search in progress is thrown away. */
  interrupted: boolean;
  /** Every position is done. A claim on the game is then left for the upload of its review to end. */
  finished?: boolean;
  /** Called when the job leaves the queue, for whatever it holds (a tab lock, a claim). */
  release?: () => void;
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

/** Publishes which games are still waiting for an engine. A background review is not one of them. */
function syncQueue() {
  set({ queue: jobs.filter((j) => !j.stretches && !j.background).map((j) => j.id) });
}

function setProgress(job: Job, force = false) {
  const now = performance.now();
  if (!force && now - job.lastPaint < 150) return;
  job.lastPaint = now;
  const next = { id: job.id, done: job.done, total: job.fens.length };
  if (job.background) {
    set({ deepening: next });
    return;
  }
  const at = state.active.findIndex((a) => a.id === job.id);
  set({ active: at < 0 ? [...state.active, next] : state.active.map((a, i) => (i === at ? next : a)) });
}

function dropJob(job: Job) {
  job.cancelled = true;
  const at = jobs.indexOf(job);
  if (at >= 0) jobs.splice(at, 1);
  // Engines still searching for it are told to stop; they drop the result.
  for (const s of job.stretches ?? []) if (s.lane !== null) engines[s.lane]?.stop();
  job.release?.();
  job.release = undefined;
  if (job.background) set({ deepening: null });
  else set({ active: state.active.filter((a) => a.id !== job.id) });
  syncQueue();
  if (jobs.length === 0) scheduleIdle();
}

function cancelGame(id: string) {
  const job = jobs.find((j) => j.id === id);
  if (job) dropJob(job);
}

function failJob(job: Job, message: string) {
  noteError(`Review failed: ${message}`);
  dropJob(job);
  // Nobody asked for a background review: it is not offered again this visit, and not shown as failed.
  if (job.background) bgTried.add(job.id);
  else set({ failures: { ...state.failures, [job.id]: 'This game could not be reviewed.' } });
}

/**
 * Hands `lane` the next piece of work: a free stretch of the first game that has one, or
 * the lower half of what another engine has left on it. Null when there is nothing to take.
 */
function takeWork(lane: number): { job: Job; stretch: Stretch } | null {
  for (const job of [...jobs]) {
    if (!hasWork(job)) continue;
    // A background review keeps to the main engine, leaving the other cores free, and waits while held.
    if (job.background && (lane !== 0 || holds > 0)) continue;
    if (job.background && state.slowEngine) {
      // The backup engine cannot look as far as a Deep review does: no background reviews this visit.
      idleBlocked = true;
      dropJob(job);
      continue;
    }
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
      // The backup engine always uses its own lighter setting, so its reviews are never taken for deeper ones.
      job.preset = state.slowEngine ? SLOW_PRESET : DEPTHS[job.target];
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
  job.finished = true;
  dropJob(job);
  if (job.background) bgTried.add(job.id);
  // Another tab, or another device through the account, may have saved a stronger review meanwhile.
  const stored = (await loadGame(job.id))?.review;
  const current = state.games.find((g) => g.id === job.id);
  if (!current) return;
  const kept = betterReview(betterReview(current.review, stored), review)!;
  if (kept !== review) {
    // A review is never replaced by a weaker one, even one asked for.
    const updated = { ...current, review: kept };
    if (kept !== current.review) set({ games: state.games.map((g) => (g.id === job.id ? updated : g)) });
    if (kept !== stored) await saveGames([updated]);
    if (!job.background) set({ notices: { ...state.notices, [job.id]: 'A stronger review of this game was already saved, so it was kept.' } });
    return;
  }
  const updated = { ...current, review };
  const notices = { ...state.notices };
  delete notices[job.id];
  set({ games: state.games.map((g) => (g.id === job.id ? updated : g)), notices });
  await saveGames([updated]);
  tabs?.postMessage({ saved: [job.id] });
  changeListener?.({ saved: [job.id], deleted: [] });
}

/** Starts an engine lane for each one the device can take, while there is work for it. */
function pump() {
  if (state.engine === 'failed') return;
  // A background review only uses the main engine: the others are not even started for it.
  const count = jobs.some((j) => !j.background && hasWork(j)) ? lanes() : 1;
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
          if (job.interrupted || outranked(job) || (job.background && holds > 0)) {
            // Leave the rest for later and help with the game nearer the front.
            job.interrupted = false;
            stretch.lane = null;
            break;
          }
          const i = stretch.next;
          const key = repeatKey(job.fens[i]);
          const twin = key ? job.seen.get(key) : undefined;
          const result = twin !== undefined ? job.evals[twin] : await evaluatePosition(job.fens[i], eng, job.preset);
          if (job.cancelled) break;
          if (job.interrupted) {
            // The search was stopped to make way for a review asked for, so it did not look
            // as far as it should have: it is thrown away and done again later.
            job.interrupted = false;
            stretch.lane = null;
            break;
          }
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

function newJob(id: string, target: DepthPreset, background: boolean): Job {
  return {
    id,
    fens: [],
    evals: [],
    done: 0,
    stretches: null,
    seen: new Map(),
    target,
    preset: DEPTHS[target],
    lastPaint: 0,
    cancelled: false,
    background,
    interrupted: false,
  };
}

/** Stops the background review's search at once, so the engine can turn to a review asked for. */
function yieldBackground() {
  for (const job of jobs) {
    if (!job.background) continue;
    for (const s of job.stretches ?? []) {
      if (s.lane === null) continue;
      job.interrupted = true;
      engines[s.lane]?.stop();
    }
  }
}

/**
 * Queues games for review at `target` (the chosen setting unless given). With `first`, they go
 * to the front, and the engines turn to them after the position they are on. The setting is
 * fixed now, so changing it later does not change a review already asked for.
 */
export function requestReview(ids: string[], opts: { first?: boolean; again?: boolean; target?: DepthPreset } = {}) {
  const target = opts.target ?? state.settings.depth;
  const known = new Map(state.games.map((g) => [g.id, g]));
  const wanted = ids.filter((id) => {
    const g = known.get(id);
    return g && (opts.again || !isReviewed(g));
  });
  if (wanted.length === 0) return;
  const failures = { ...state.failures };
  const notices = { ...state.notices };
  for (const id of wanted) {
    delete failures[id];
    delete notices[id];
  }
  const promoted: Job[] = [];
  const picked: Job[] = wanted.map((id) => {
    const job = jobs.find((j) => j.id === id);
    if (!job) return newJob(id, target, false);
    const deeper = DEPTHS[job.target].depth >= DEPTHS[target].depth;
    if (job.background && deeper) {
      // The game being reviewed in the background was asked for: it carries on from where it is.
      job.background = false;
      promoted.push(job);
      set({ deepening: null });
      return job;
    }
    if (!job.background && deeper) return job;
    if (!job.background && !job.stretches) {
      // Still waiting: it simply looks further when it starts.
      job.target = target;
      return job;
    }
    // Asked for at a different setting than the review under way: start again at the one asked for.
    dropJob(job);
    return newJob(id, target, false);
  });
  const fresh = picked.filter((j) => !jobs.includes(j));
  const asked = jobs.filter((j) => !j.background);
  const background = jobs.filter((j) => j.background);
  const order = opts.first ? [...picked, ...asked.filter((j) => !picked.includes(j))] : [...asked, ...fresh];
  jobs.splice(0, jobs.length, ...order, ...background);
  set({ failures, notices });
  syncQueue();
  for (const job of promoted) if (job.stretches) setProgress(job, true);
  yieldBackground();
  pump();
}

/** Stops every review, and the background reviews too, until the person resumes them. */
export function cancelReviews() {
  set({ deepenPaused: true });
  clearTimeout(idleTimer);
  for (const job of [...jobs]) dropJob(job);
}

/** Lets the person retry after the engine failed to start. */
export function resetEngine() {
  engines.forEach((e) => e?.dispose());
  engines.length = 0;
  extrasFailed = false;
  set({ engine: 'idle', engineError: null });
  scheduleIdle();
}

// ---- Deep reviews in the background ----
//
// While nothing is asked for, the main engine gives one game at a time a Deep review: games
// never reviewed, and games reviewed at a lighter setting, newest first. It is the same review
// a Deep review asked for makes, position by position; only when it runs differs. It gives way
// the moment a review is asked for, and carries on afterwards. Only one tab does this at a
// time, and with an account, only one device works on a given game (see `DeepenClaims`).

/** Delays, in milliseconds; tests shorten them. */
export const idleTuning = {
  /** After the last review asked for, so a run of requests is not interrupted. */
  graceMs: 3000,
  /** After the page opens, so the engine is not started the moment someone arrives. */
  startDelayMs: 20000,
  /** Before trying again while another tab is doing this. */
  retryMs: 60000,
  /** Between telling the account how far a game has got. */
  renewMs: 60000,
};

/**
 * Keeps two of the person's devices from giving the same game a Deep review. Set while signed in.
 * Each call settles even when the server cannot be reached: the work then goes ahead, since two
 * devices doing the same game only costs time, never a weaker review.
 */
export interface DeepenClaims {
  /** Not granted when another device is working on the game, with how far it has got (0 to 100). */
  claim(id: string): Promise<{ granted: boolean; progress?: number }>;
  /** False when another device has taken the game over. */
  renew(id: string, progress: number): Promise<boolean>;
  release(id: string): void;
}

let claims: DeepenClaims | null = null;

export function setDeepenClaims(c: DeepenClaims | null) {
  claims = c;
}

let openedAt = 0;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let idleStarting = false;
/** Set when the backup engine is in use: it cannot look as far as a Deep review does. */
let idleBlocked = false;
/** Games not to start again this visit: done, failed, or being done on another device. */
const bgTried = new Set<string>();

/** Tells the other tabs which games got a new review, so they show it too. */
const tabs = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('chessdebrief.reviews');
(tabs as unknown as { unref?: () => void } | null)?.unref?.();
tabs?.addEventListener('message', (e: MessageEvent) => {
  const ids = (e.data as { saved?: unknown } | null)?.saved;
  if (Array.isArray(ids)) for (const id of ids) if (typeof id === 'string') void adoptStored(id);
});

/** Takes up a review another tab saved, when it is stronger than the one shown here. */
async function adoptStored(id: string) {
  const stored = await loadGame(id);
  const current = state.games.find((g) => g.id === id);
  if (!stored?.review || !current) return;
  if (betterReview(current.review, stored.review) === current.review) return;
  const updated = { ...current, review: stored.review };
  set({ games: state.games.map((g) => (g.id === id ? updated : g)) });
  const job = jobs.find((j) => j.id === id && j.background);
  if (job && isDeep(stored.review)) dropJob(job);
}

/** True when a game would gain from a Deep review. */
function wantsDeep(g: GameRecord): boolean {
  if (g.source === 'sample') return false;
  if (!g.review) return true;
  // A review in a newer format than this page knows is left alone; reloading the page shows it.
  if (g.review.version !== REVIEW_VERSION) return g.review.version < REVIEW_VERSION;
  return !isDeep(g.review);
}

function idleReady(): boolean {
  return (
    holds === 0 &&
    state.settings.deepenIdle &&
    state.ready &&
    !state.deepenPaused &&
    state.engine !== 'failed' &&
    !state.slowEngine &&
    !idleBlocked &&
    jobs.length === 0
  );
}

/** Starts the next background review after `delay`, if there is nothing else to do by then. */
function scheduleIdle(delay = idleTuning.graceMs) {
  if (!state.settings.deepenIdle || state.deepenPaused || idleBlocked) return;
  clearTimeout(idleTimer);
  const wait = Math.max(delay, openedAt + idleTuning.startDelayMs - Date.now());
  idleTimer = setTimeout(() => void startIdleDeepen(), Math.max(0, wait));
}

type Battery = { charging: boolean; addEventListener?: (type: string, listener: () => void) => void };
/** Undefined until asked; null when the browser does not say (then mains power is assumed). */
let battery: Battery | null | undefined;

/** False while a laptop runs on its battery: a background review would drain it. */
async function onMains(): Promise<boolean> {
  if (battery === undefined) {
    battery = null;
    try {
      const nav = navigator as Navigator & { getBattery?: () => Promise<Battery> };
      battery = (await nav.getBattery?.()) ?? null;
      battery?.addEventListener?.('chargingchange', () => scheduleIdle());
    } catch {
      battery = null;
    }
  }
  return !battery || battery.charging;
}

const TAB = Math.random().toString(36).slice(2);
const LEASE_KEY = 'chessdebrief.deepening';
/** Long enough to outlast the once-a-minute timers of a hidden tab. */
const LEASE_MS = 3 * 60000;

/**
 * Makes this the one tab doing background reviews, until the returned function is called.
 * Null when another tab is. Pages served without https have no Web Locks, so a lease kept in
 * localStorage stands in; where neither works, every tab goes ahead, which only costs time.
 */
async function tabLock(): Promise<(() => void) | null> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (locks) {
    try {
      return await new Promise<(() => void) | null>((resolve, reject) => {
        locks
          .request('chessdebrief.deepening', { ifAvailable: true }, (lock) => {
            if (!lock) {
              resolve(null);
              return undefined;
            }
            return new Promise<void>((unlock) => resolve(() => unlock()));
          })
          .catch(reject);
      });
    } catch {
      // Refused (some frames): fall back to the lease.
    }
  }
  try {
    const held = JSON.parse(localStorage.getItem(LEASE_KEY) ?? 'null') as { tab: string; until: number } | null;
    if (held && held.tab !== TAB && held.until > Date.now()) return null;
    const write = () => localStorage.setItem(LEASE_KEY, JSON.stringify({ tab: TAB, until: Date.now() + LEASE_MS }));
    write();
    const timer = setInterval(() => {
      try {
        write();
      } catch {
        // Storage went away; the lease simply runs out.
      }
    }, 30000);
    return () => {
      clearInterval(timer);
      try {
        const now = JSON.parse(localStorage.getItem(LEASE_KEY) ?? 'null') as { tab?: string } | null;
        if (now?.tab === TAB) localStorage.removeItem(LEASE_KEY);
      } catch {
        // Nothing to clear.
      }
    };
  } catch {
    return () => undefined;
  }
}

async function startIdleDeepen() {
  if (idleStarting || !idleReady()) return;
  idleStarting = true;
  try {
    if (!(await onMains())) return; // Plugging in schedules another try.
    // Without an account, a page that cannot store games would lose the work when it closes.
    if (!isPersistent() && !claims) return;
    // Real games first; games against the bot after them.
    const order = [...state.games.filter((g) => g.source !== 'bot'), ...state.games.filter((g) => g.source === 'bot')];
    for (const game of order) {
      if (!idleReady()) return;
      if (bgTried.has(game.id) || state.failures[game.id] || !wantsDeep(game)) continue;
      // Another tab may have done it already.
      const stored = await loadGame(game.id);
      if (!stored || !wantsDeep(stored)) {
        bgTried.add(game.id);
        if (stored) await adoptStored(game.id);
        continue;
      }
      const unlock = await tabLock();
      if (!unlock) {
        scheduleIdle(idleTuning.retryMs);
        return;
      }
      const claimed = claims;
      const claim = claimed ? await claimed.claim(game.id) : { granted: true };
      if (!claim.granted) {
        unlock();
        bgTried.add(game.id);
        set({ elsewhere: { ...state.elsewhere, [game.id]: claim.progress ?? 0 } });
        continue;
      }
      if (!idleReady() || !state.games.some((g) => g.id === game.id)) {
        unlock();
        claimed?.release(game.id);
        if (jobs.length === 0) scheduleIdle();
        return;
      }
      const job = newJob(game.id, 'deep', true);
      const renewal = claimed
        ? setInterval(() => {
            const progress = job.fens.length ? Math.floor((job.done / job.fens.length) * 100) : 0;
            void claimed.renew(job.id, progress).then((mine) => {
              if (mine || job.cancelled) return;
              // Another device took the game over.
              bgTried.add(job.id);
              if (job.background) dropJob(job);
            });
          }, idleTuning.renewMs)
        : undefined;
      job.release = () => {
        clearInterval(renewal);
        // A finished review keeps the claim until it reaches the account, which ends the claim
        // (or it runs out), so no other device starts on the game in between.
        if (!job.finished) claimed?.release(job.id);
        unlock();
      };
      jobs.push(job);
      set({ deepening: { id: job.id, done: 0, total: game.plies + 1 } });
      pump();
      return;
    }
  } finally {
    idleStarting = false;
  }
}

/** Pauses background Deep reviews for this visit. */
export function pauseDeepening() {
  set({ deepenPaused: true });
  clearTimeout(idleTimer);
  for (const job of jobs.filter((j) => j.background)) dropJob(job);
}

export function resumeDeepening() {
  set({ deepenPaused: false });
  scheduleIdle(0);
}

/** The setting was turned off: the background review in progress stops. */
function stopDeepening() {
  clearTimeout(idleTimer);
  for (const job of jobs.filter((j) => j.background)) dropJob(job);
}

/** How many games are still waiting for a Deep review in the background. */
export function deepenRemaining(games: GameRecord[]): number {
  return games.filter((g) => wantsDeep(g) && !bgTried.has(g.id)).length;
}

/** Holds the background Deep reviews back, as while the person practises: the engine they need comes first. */
let holds = 0;

/** While held, the background review stops at once and waits; it carries on, from where it was, once released. */
export function holdDeepening(): () => void {
  holds++;
  clearTimeout(idleTimer);
  yieldBackground();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds--;
    if (holds === 0) {
      pump();
      scheduleIdle();
    }
  };
}

// ---- Practice kept with a game, and games against the bot ----

/** The games to list and count: real games only, unless the person chose to include games against the bot. */
export function shownGames(games: GameRecord[], includeBots: boolean): GameRecord[] {
  return includeBots ? games : games.filter((g) => g.source !== 'bot');
}

async function updateGame(id: string, change: (g: GameRecord) => GameRecord) {
  const current = state.games.find((g) => g.id === id);
  if (!current) return;
  const updated = change(current);
  set({ games: state.games.map((g) => (g.id === id ? updated : g)) });
  await saveGames([updated]);
  changeListener?.({ saved: [id], deleted: [] });
}

/** Keeps an explored line with its game, or updates one kept before. The review is not touched. */
export function savePracticeLine(gameId: string, line: PracticeLine): Promise<void> {
  return updateGame(gameId, (g) => ({ ...g, practice: [...(g.practice ?? []).filter((l) => l.id !== line.id), line] }));
}

/** Removes a kept line. A marker stays, so the removal reaches the person's other devices. */
export function removePracticeLine(gameId: string, lineId: string): Promise<void> {
  const now = Date.now();
  return updateGame(gameId, (g) => ({
    ...g,
    practice: (g.practice ?? []).map((l) => (l.id === lineId ? { id: l.id, fromPly: l.fromPly, moves: [], createdAt: l.createdAt, updatedAt: now, deleted: true } : l)),
  }));
}
