import { useSyncExternalStore } from 'react';
import { PREVIEW } from '../config';

// Routes normally live in the address bar after "#". A sandboxed preview frame may not
// keep them there, so the preview build holds the route in memory instead.
let memoryRoute = '';
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('hashchange', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('hashchange', listener);
  };
}

const read = () => (PREVIEW ? memoryRoute : window.location.hash);

function setMemoryRoute(hash: string) {
  memoryRoute = hash;
  listeners.forEach((l) => l());
}

if (PREVIEW && typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    const link = (e.target as Element | null)?.closest?.('a[href^="#/"]');
    if (!link) return;
    e.preventDefault();
    setMemoryRoute(link.getAttribute('href')!);
  });
}

/** The current route as path segments: "#/game/abc/12" gives ["game", "abc", "12"]. */
export function useRoute(): string[] {
  const hash = useSyncExternalStore(subscribe, read);
  return hash
    .replace(/^#\/?/, '')
    .split('/')
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
}

export function href(...segments: (string | number)[]): string {
  return `#/${segments.map((s) => encodeURIComponent(String(s))).join('/')}`;
}

export function navigate(...segments: (string | number)[]) {
  const target = href(...segments);
  if (PREVIEW) setMemoryRoute(target);
  else window.location.hash = target.slice(1);
}
