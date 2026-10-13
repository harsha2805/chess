import { useSyncExternalStore } from 'react';
import { ACCOUNTS, FETCH_EVERY_HOURS } from '../config';
import { ApiError, api } from './api';
import { noteError } from './diagnostics';
import type { Platform } from './importers';
import { mergeRemote, toPush, type PushGame, type RemoteGame } from './remote';
import { applyRemote, clearLocal, getState as getGames, onGamesChanged, setDeepenClaims, type DeepenClaims, type GamesChange } from './store';
import type { GameRecord } from './types';

// ---- Accounts: optional sign-in that keeps games on the server and brings in new ones ----
//
// IndexedDB stays the working copy, so the app works the same signed in or not. Signed in,
// every game added, reviewed or removed here goes into an outbox that is sent to the server,
// and changes made elsewhere (another browser, or the server's scheduled fetch) are pulled.

export interface User {
  id: number;
  email: string;
  /** False for someone who signs in only with Google. */
  hasPassword: boolean;
  google: boolean;
  /** May open the admin page (#/admin). */
  isAdmin: boolean;
}

export interface ChessAccount {
  id: number;
  platform: Platform;
  username: string;
  lastFetchedAt: number | null;
  lastError: string | null;
}

export interface AccountState {
  /** `unavailable`: no backend here (the preview build, or a static-only deploy). */
  status: 'checking' | 'unavailable' | 'signed-out' | 'signed-in';
  user: User | null;
  /** Chess accounts the server checks for new games. */
  accounts: ChessAccount[];
  syncing: boolean;
  /** The server is checking chess.com or Lichess right now. */
  checking: boolean;
  /** Games the last check brought in, or null before the first check this visit. */
  lastAdded: number | null;
  syncError: string | null;
  /** Ways to sign in besides email and password that the server has set up. */
  providers: { google: boolean };
  /** The "Support ChessDebrief" page, when the server has one set. */
  donateUrl: string | null;
}

let state: AccountState = {
  status: ACCOUNTS ? 'checking' : 'unavailable',
  user: null,
  accounts: [],
  syncing: false,
  checking: false,
  lastAdded: null,
  syncError: null,
  providers: { google: false },
  donateUrl: null,
};
const listeners = new Set<() => void>();

function set(patch: Partial<AccountState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const getAccount = () => state;

export function useAccount<T>(selector: (s: AccountState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}

// ---- What this browser remembers about the account it holds ----

/** Kept in localStorage. Its `user` is the account whose games IndexedDB holds. */
interface Memo {
  user: number;
  /** Names this browser to the server, so it is not sent back its own changes. */
  device: string;
  /** Pull cursor: the last change seen. */
  ms: number;
  id: number;
  /** Games waiting to be sent, and removals waiting to be sent. */
  upsert: string[];
  delete: string[];
  /** When this browser last asked the server to check for new games. */
  checkedAt: number;
}

const MEMO_KEY = 'chessdebrief.account';
let memo: Memo | null = readMemo();

function readMemo(): Memo | null {
  try {
    const raw = localStorage.getItem(MEMO_KEY);
    return raw ? (JSON.parse(raw) as Memo) : null;
  } catch {
    return null;
  }
}

function saveMemo() {
  try {
    if (memo) localStorage.setItem(MEMO_KEY, JSON.stringify(memo));
    else localStorage.removeItem(MEMO_KEY);
  } catch {
    // Storage blocked: the outbox lasts for this visit only.
  }
}

function deviceId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

// ---- Starting, signing in and out ----

/** Asks who is signed in. Called once the stored games are loaded. */
export async function initAccount() {
  if (!ACCOUNTS) return;
  onGamesChanged(localChange);
  let user: User | null;
  try {
    const session = await api<{ user: User | null; providers?: { google?: boolean }; donate?: string | null }>('session');
    user = session.user;
    set({ providers: { google: !!session.providers?.google }, donateUrl: session.donate ?? null });
  } catch {
    // No backend at this address, or it could not be reached: the app works as before.
    set({ status: 'unavailable' });
    return;
  }
  if (user) await begin(user);
  else if (memo) await end(true); // Signed out elsewhere, or the session ran out.
  else set({ status: 'signed-out' });
}

async function begin(user: User) {
  if (memo && memo.user !== user.id) {
    // Another account's games are in this browser: they stay on that account only.
    memo = null;
    await clearLocal();
  }
  if (!memo) {
    // Games made here before signing in join the account.
    memo = { user: user.id, device: deviceId(), ms: 0, id: 0, upsert: getGames().games.map((g) => g.id), delete: [], checkedAt: 0 };
    saveMemo();
  }
  set({ status: 'signed-in', user, syncError: null });
  setDeepenClaims(claims);
  startTimer();
  void loadAccounts();
  // Not awaited: the first upload can take a while, and the person can carry on meanwhile.
  void checkForGames(false);
}

/** Leaves the account. With `forget`, this browser's copy of its games is removed too. */
async function end(forget: boolean) {
  stopTimer();
  setDeepenClaims(null);
  memo = null;
  saveMemo();
  if (forget) await clearLocal();
  set({ status: 'signed-out', user: null, accounts: [], lastAdded: null, syncError: null, syncing: false, checking: false });
}

/** Where the Google button goes: the server takes it from there and comes back to the app. */
export const GOOGLE_SIGN_IN = 'auth/google/redirect';

export async function signIn(email: string, password: string) {
  const { user } = await api<{ user: User }>('login', { method: 'POST', body: { email, password } });
  await begin(user);
}

export async function register(email: string, password: string) {
  const { user } = await api<{ user: User }>('register', { method: 'POST', body: { email, password } });
  await begin(user);
}

/** Sends whatever is waiting, then signs out and clears this browser's copy of the games. */
export async function signOut() {
  await sync().catch(() => undefined);
  await api('logout', { method: 'POST' }).catch(() => undefined);
  await end(true);
}

export async function requestPasswordReset(email: string): Promise<string> {
  const { message } = await api<{ message: string }>('forgot-password', { method: 'POST', body: { email } });
  return message;
}

export async function resetPassword(token: string, email: string, password: string) {
  const { user } = await api<{ user: User }>('reset-password', { method: 'POST', body: { token, email, password } });
  await begin(user);
}

/** Stops signing in with Google. The server refuses when the account has no password to fall back on. */
export async function disconnectGoogle() {
  const { user } = await api<{ user: User }>('user/google', { method: 'DELETE' });
  set({ user });
}

/**
 * Deletes the account and what the server holds. The games stay in this browser, as before
 * signing up. Confirmed with the password, or, for someone who signs in only with Google,
 * with their email address typed out.
 */
export async function deleteAccount(confirmation: string) {
  const body = state.user?.hasPassword === false ? { confirm: confirmation } : { password: confirmation };
  await api('user', { method: 'DELETE', body });
  await end(false);
}

// ---- Chess accounts checked for new games ----

async function loadAccounts() {
  try {
    const { accounts } = await api<{ accounts: ChessAccount[] }>('accounts');
    set({ accounts });
  } catch (e) {
    await problem(e);
  }
}

/** Starts checking an account for new games. Returns why it could not, or null. */
export async function linkAccount(platform: Platform, username: string): Promise<string | null> {
  if (state.status !== 'signed-in') return null;
  try {
    const { accounts } = await api<{ accounts: ChessAccount[] }>('accounts', { method: 'POST', body: { platform, username } });
    set({ accounts });
    return null;
  } catch (e) {
    await problem(e);
    return e instanceof ApiError ? e.message : 'The account could not be added.';
  }
}

export async function unlinkAccount(id: number) {
  await api(`accounts/${id}`, { method: 'DELETE' });
  set({ accounts: state.accounts.filter((a) => a.id !== id) });
}

/**
 * Asks the server to check chess.com and Lichess, then pulls what came in. Without `force`,
 * the server only checks accounts that are due; with it (the Refresh button), all of them.
 */
export async function checkForGames(force = true) {
  if (state.status !== 'signed-in' || state.checking) return;
  set({ checking: true });
  try {
    if (state.accounts.length > 0 || !force) {
      const { added, accounts } = await api<{ added: number; accounts: ChessAccount[] }>('refresh', { method: 'POST', body: { force } });
      set({ accounts, lastAdded: added });
      if (memo) {
        memo.checkedAt = Date.now();
        saveMemo();
      }
    }
  } catch (e) {
    await problem(e);
  }
  await sync().catch(() => undefined);
  set({ checking: false });
}

// ---- Background Deep reviews: one device at a time per game ----

type ClaimAnswer = { granted: boolean; progress: number | null };

function askClaim(id: string, action: 'claim' | 'renew' | 'release', progress = 0): Promise<ClaimAnswer> {
  if (!memo) return Promise.resolve({ granted: true, progress: null });
  return api<ClaimAnswer>('games/claim', { method: 'POST', body: { id, device: memo.device, action, progress } });
}

/**
 * When the server cannot answer (offline, a game it has not been sent yet, a server not yet
 * updated), the review goes ahead: two devices on one game only cost time.
 */
const claims: DeepenClaims = {
  claim: (id) =>
    askClaim(id, 'claim').then(
      (a) => ({ granted: a.granted, progress: a.progress ?? undefined }),
      () => ({ granted: true }),
    ),
  renew: (id, progress) =>
    askClaim(id, 'renew', progress).then(
      (a) => a.granted,
      () => true,
    ),
  release: (id) => void askClaim(id, 'release').catch(() => undefined),
};

// ---- Sending and pulling games ----

/** Ids sent in the request in flight, and those changed again meanwhile (to be sent again). */
const inFlight = new Set<string>();
const changedAgain = new Set<string>();
let pushTimer: ReturnType<typeof setTimeout> | undefined;

function localChange({ saved, deleted }: GamesChange) {
  if (!memo || state.status !== 'signed-in') return;
  const gone = new Set(deleted);
  const fresh = new Set(saved);
  memo.upsert = [...memo.upsert.filter((id) => !gone.has(id) && !fresh.has(id)), ...saved];
  memo.delete = [...memo.delete.filter((id) => !fresh.has(id) && !gone.has(id)), ...deleted];
  for (const id of saved) if (inFlight.has(id)) changedAgain.add(id);
  saveMemo();
  // A batch of reviews finishing close together goes in one request.
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void sync().catch(() => undefined), 2000);
}

let running: Promise<void> | null = null;
let again = false;

/** Sends the outbox, then pulls changes. Calls made while one runs join it. */
export function sync(): Promise<void> {
  if (state.status !== 'signed-in') return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  set({ syncing: true });
  running = (async () => {
    try {
      do {
        again = false;
        await push();
        await pull();
      } while (again && state.status === 'signed-in');
      set({ syncError: null });
    } catch (e) {
      await problem(e);
    } finally {
      running = null;
      set({ syncing: false });
    }
  })();
  return running;
}

/** At most this much JSON in one request. */
const MAX_BYTES = 1_500_000;

async function push() {
  if (!memo) return;
  while (memo && memo.delete.length > 0) {
    const chunk = memo.delete.slice(0, 500);
    await api('games/sync', { method: 'POST', body: { device: memo.device, delete: chunk } });
    if (!memo) return;
    const sent = new Set(chunk);
    memo.delete = memo.delete.filter((id) => !sent.has(id));
    saveMemo();
  }

  const games = new Map(getGames().games.map((g) => [g.id, g]));
  while (memo && memo.upsert.length > 0) {
    const chunk: PushGame[] = [];
    const sent = new Set<string>();
    let bytes = 0;
    for (const id of memo.upsert) {
      if (sent.has(id)) continue;
      sent.add(id);
      const game = games.get(id);
      if (!game) continue; // Removed since; the removal is in the other list.
      const item = toPush(game);
      const size = item.record.length + (item.review?.length ?? 0);
      if (chunk.length > 0 && (chunk.length >= 25 || bytes + size > MAX_BYTES)) {
        sent.delete(id);
        break;
      }
      chunk.push(item);
      bytes += size;
    }
    sent.forEach((id) => inFlight.add(id));
    try {
      if (chunk.length > 0) await api('games/sync', { method: 'POST', body: { device: memo.device, upsert: chunk } });
    } catch (e) {
      // A game the server refuses would block the rest: it is dropped from the outbox and noted.
      if (!(e instanceof ApiError && e.status === 422)) throw e;
      noteError(`Games not saved to the account: ${e.message}`);
    } finally {
      inFlight.clear();
    }
    if (!memo) return;
    memo.upsert = memo.upsert.filter((id) => !sent.has(id) || changedAgain.has(id));
    changedAgain.clear();
    saveMemo();
  }
}

interface Page {
  games: RemoteGame[];
  more: boolean;
  cursor: { ms: number; id: number };
}

/** Changes made at nearly the same moment can be saved out of order, so each pull starts a little earlier. */
const OVERLAP_MS = 5000;

async function pull() {
  if (!memo) return;
  const start = { ms: memo.ms, id: memo.id };
  let since = Math.max(0, start.ms - OVERLAP_MS);
  let after = 0;
  for (;;) {
    const page = await api<Page>('games', { query: { since, after, device: memo.device } });
    await apply(page.games);
    since = page.cursor.ms;
    after = page.cursor.id;
    if (!page.more || !memo) break;
  }
  if (!memo) return;
  // Keep the furthest cursor: a pull that found nothing echoes back the earlier starting point.
  if (since > start.ms || (since === start.ms && after > start.id)) {
    memo.ms = since;
    memo.id = after;
    saveMemo();
  }
}

async function apply(rows: RemoteGame[]) {
  if (!memo || rows.length === 0) return;
  const local = new Map(getGames().games.map((g) => [g.id, g]));
  const waiting = new Set(memo.delete);
  const put: GameRecord[] = [];
  const remove: string[] = [];
  const missing: string[] = [];
  const back: string[] = [];
  const take = (row: RemoteGame) => {
    // Removed here but not yet sent: the removal wins.
    if (waiting.has(row.id)) return;
    const merge = mergeRemote(row, local.get(row.id));
    if (merge.kind === 'delete') remove.push(row.id);
    else if (merge.kind === 'missing') missing.push(row.id);
    else if (merge.kind === 'put') {
      put.push(merge.record);
      if (merge.pushBack) back.push(row.id);
    }
  };
  rows.forEach(take);
  for (let i = 0; i < missing.length; i += 50) {
    const { games } = await api<{ games: RemoteGame[] }>('games', { query: { ids: missing.slice(i, i + 50) } });
    games.forEach(take);
  }
  await applyRemote(put, remove);
  if (back.length > 0 && memo) {
    memo.upsert = [...new Set([...memo.upsert, ...back])];
    saveMemo();
    again = true;
  }
}

/** Shows a failed call. Signed out on the server: this browser signs out too. */
async function problem(e: unknown) {
  if (e instanceof ApiError && e.status === 401) {
    await end(true);
    return;
  }
  set({ syncError: e instanceof ApiError ? e.message : 'Your games could not be saved to your account. They are safe here; it will try again.' });
  if (!(e instanceof ApiError)) noteError(`Account sync failed: ${e instanceof Error ? e.message : String(e)}`);
}

// ---- While the app is open: check for new games every few hours ----

const EVERY_MS = FETCH_EVERY_HOURS * 3_600_000;
let timer: ReturnType<typeof setInterval> | undefined;
let lastSync = 0;

function tick() {
  if (state.status !== 'signed-in' || !memo || document.visibilityState !== 'visible') return;
  if (Date.now() - memo.checkedAt >= EVERY_MS) {
    void checkForGames(false);
  } else if (Date.now() - lastSync > 5 * 60_000) {
    // Coming back to the tab: pick up reviews made in another browser.
    lastSync = Date.now();
    void sync();
  }
}

function startTimer() {
  if (timer) return;
  lastSync = Date.now();
  timer = setInterval(tick, 5 * 60_000);
  document.addEventListener('visibilitychange', tick);
}

function stopTimer() {
  clearInterval(timer);
  timer = undefined;
  document.removeEventListener('visibilitychange', tick);
}
