import { openDB, type IDBPDatabase } from 'idb';
import type { GameRecord } from './types';

const DB_NAME = 'chessdebrief';
const STORE = 'games';

let dbPromise: Promise<IDBPDatabase | null> | null = null;
/** Used when the browser refuses IndexedDB (some private windows): games then last for the visit only. */
const memory = new Map<string, GameRecord>();
let persistent = true;

function open(): Promise<IDBPDatabase | null> {
  if (!dbPromise) {
    // Some frames throw as soon as indexedDB is touched, instead of failing the request.
    dbPromise = Promise.resolve()
      .then(() =>
        openDB(DB_NAME, 1, {
          upgrade(db) {
            if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
          },
        }),
      )
      .catch(() => {
        persistent = false;
        return null;
      });
  }
  return dbPromise;
}

export const isPersistent = () => persistent;

export async function loadGames(): Promise<GameRecord[]> {
  const db = await open();
  if (!db) return [...memory.values()];
  try {
    return (await db.getAll(STORE)) as GameRecord[];
  } catch {
    persistent = false;
    return [...memory.values()];
  }
}

export async function saveGames(records: GameRecord[]): Promise<void> {
  for (const r of records) memory.set(r.id, r);
  const db = await open();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    await Promise.all([...records.map((r) => tx.store.put(r)), tx.done]);
  } catch {
    persistent = false;
  }
}

/** Forgets every stored game, as when the person signs out. */
export async function clearGames(): Promise<void> {
  memory.clear();
  const db = await open();
  if (!db) return;
  try {
    await db.clear(STORE);
  } catch {
    persistent = false;
  }
}

export async function deleteGames(ids: string[]): Promise<void> {
  for (const id of ids) memory.delete(id);
  const db = await open();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
  } catch {
    persistent = false;
  }
}
