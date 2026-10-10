/** Keeps the last few errors so a bug report can include them. Nothing leaves the browser unless a report is sent. */
const recent: string[] = [];

export function noteError(message: string) {
  recent.push(`${new Date().toISOString()} ${message}`.slice(0, 400));
  if (recent.length > 8) recent.shift();
}

export function watchErrors() {
  window.addEventListener('error', (e) => noteError(`${e.message} (${e.filename?.split('/').pop() ?? '?'}:${e.lineno ?? '?'})`));
  window.addEventListener('unhandledrejection', (e) => noteError(`Unhandled: ${String((e.reason as Error)?.message ?? e.reason)}`));
}

export const recentErrors = () => [...recent];
