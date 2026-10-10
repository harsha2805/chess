import { bookKey, type BookLookup } from './analyze';

let loading: Promise<BookLookup> | null = null;

/** Loads the openings book on first use (it is a separate download of about 90 KB). */
export function loadBook(): Promise<BookLookup> {
  if (!loading) {
    loading = import('../data/openings.json').then((mod) => {
      const book = mod.default as Record<string, string>;
      return (fen: string) => book[bookKey(fen)];
    });
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}
