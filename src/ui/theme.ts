import { useEffect, useState } from 'react';

export type Theme = 'night' | 'day';
/** Also read in index.html, to apply the theme before the first paint. */
const KEY = 'chessdebrief-theme';

/** The saved colour theme. Night is the default; index.html applies it before the first paint. */
function saved(): Theme {
  try {
    return localStorage.getItem(KEY) === 'day' ? 'day' : 'night';
  } catch {
    return 'night';
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(saved);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'day' ? '#f3efe6' : '#0d1830');
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      // Private windows may refuse storage; the theme still applies for this visit.
    }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'night' ? 'day' : 'night'))] as const;
}
