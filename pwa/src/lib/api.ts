/**
 * The PWA's one way to call the Worker's `/api`. Same origin, so the session cookie goes along.
 *
 * - `401`: the session is gone; the browser goes to sign in and comes back to the current path. The promise
 *   rejects with an `ApiError` too, so callers stop.
 * - Other errors (and no connection) reject with an `ApiError` whose `message` is for the screen's status area.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiDeps {
  fetch: typeof fetch;
  /** Sends the browser to `url` (sign in). */
  redirect: (url: string) => void;
  /** The current path and query, for `returnTo`. */
  currentPath: () => string;
}

const browserDeps: ApiDeps = {
  fetch: (input, init) => fetch(input, init),
  redirect: (url) => window.location.assign(url),
  currentPath: () => `${window.location.pathname}${window.location.search}`,
};

let deps: ApiDeps = browserDeps;

/** For tests: swap `fetch` and navigation. Returns a function that restores the browser's. */
export function setApiDeps(next: Partial<ApiDeps>): () => void {
  deps = { ...browserDeps, ...next };
  return () => {
    deps = browserDeps;
  };
}

export function loginUrl(returnTo: string): string {
  return `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
}

const MESSAGES: Record<string, string> = {
  not_found: 'Not found. It may have been deleted.',
  too_large: 'That is too large to save.',
};

/** Calls `/api<path>`; JSON in and out. Resolves `undefined` for 204. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  let body: string | undefined;
  if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.body);
  }

  let res: Response;
  try {
    res = await deps.fetch(`/api${path}`, { method: init.method ?? 'GET', headers, body, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'network', 'No connection. Nothing was saved; try again.');
  }

  if (res.status === 401) {
    deps.redirect(loginUrl(deps.currentPath()));
    throw new ApiError(401, 'unauthenticated', 'Signed out. Signing in again…');
  }
  if (res.status === 204) return undefined as T;

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = undefined;
  }
  if (!res.ok) {
    const record = (data && typeof data === 'object' ? data : {}) as { error?: unknown; detail?: unknown };
    const code = typeof record.error === 'string' ? record.error : `http_${res.status}`;
    const detail = typeof record.detail === 'string' ? record.detail : undefined;
    throw new ApiError(res.status, code, detail ?? MESSAGES[code] ?? `Something went wrong (${code}).`);
  }
  return data as T;
}

/** A message for the screen's status area, from anything a store call threw. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong.';
}
