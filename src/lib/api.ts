/**
 * Calls to the app's Laravel backend, served from the same site under api/.
 *
 * Sign-in uses Laravel's session cookie, which pages cannot read. Changes also carry the
 * XSRF token Laravel keeps in a readable cookie; the first change asks for that cookie.
 */

/** A failed call, with a message that can be shown as is and, for form errors, one per field. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | string[] | undefined>;

function cookie(name: string): string | undefined {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

async function askForToken() {
  await fetch('sanctum/csrf-cookie', { credentials: 'same-origin', headers: { Accept: 'application/json' } }).catch(() => undefined);
}

function url(path: string, query?: Query): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    if (Array.isArray(value)) value.forEach((v) => params.append(`${key}[]`, v));
    else params.set(key, String(value));
  }
  const search = params.toString();
  return `api/${path}${search ? `?${search}` : ''}`;
}

function failure(status: number, body: unknown): ApiError {
  const data = (body ?? {}) as { message?: string; error?: string; errors?: Record<string, string[]> };
  const fields: Record<string, string> = {};
  for (const [key, messages] of Object.entries(data.errors ?? {})) if (messages[0]) fields[key] = messages[0];
  const first = Object.values(fields)[0];
  if (status === 429) return new ApiError(data.error ?? 'That is a lot of tries in a short time. Wait a minute and try again.', status, fields);
  if (status === 401) return new ApiError('You are signed out. Sign in again.', status);
  if (status >= 500 && !data.error) return new ApiError('The server had a problem. Try again in a moment.', status);
  return new ApiError(data.error ?? first ?? data.message ?? `The server answered with an error (${status}).`, status, fields);
}

export async function api<T = unknown>(path: string, opts: { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown; query?: Query } = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  if (method !== 'GET' && !cookie('XSRF-TOKEN')) await askForToken();
  const send = () => {
    const token = cookie('XSRF-TOKEN');
    return fetch(url(path, opts.query), {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { 'X-XSRF-TOKEN': token } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  };

  let response: Response;
  try {
    response = await send();
    // The token ran out with the session: get a new one and try once more.
    if (response.status === 419) {
      await askForToken();
      response = await send();
    }
  } catch {
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0);
  }

  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw failure(response.status, body);
  // A page instead of an answer: there is no backend at this address.
  if (body === null) throw new ApiError('The server sent an answer that could not be read.', response.status);
  return body as T;
}
